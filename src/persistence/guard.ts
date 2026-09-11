import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ResolvedConfig } from "../api/types.js";

const held = new AsyncLocalStorage<ReadonlySet<string>>();
/** Serialize local mutation, including different configurations sharing package managers. */
export async function withRunLock<T>(config: ResolvedConfig, fn: () => Promise<T>): Promise<T> {
  return withDirectoryLock(join(config.context.home, ".local/state/workstation/mutation.lock"), () =>
    withDirectoryLock(`${config.stateFile}.lock`, fn));
}
/** Reentrant only within the owning async call chain. A second client invocation still fails. */
export async function withDirectoryLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  if (held.getStore()?.has(path)) return fn();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") throw new Error(`Another Workstation run holds ${path}. Inspect owner.json; after confirming that process stopped, remove the stale directory and rerun. Pending actions will be re-inspected.`, { cause: error });
    throw error;
  }
  const token = randomUUID();
  try {
    await writeFile(join(path, "owner.json"), JSON.stringify({ pid: process.pid, token, started: new Date().toISOString() }), { mode: 0o600 });
    return await held.run(new Set([...(held.getStore() ?? []), path]), fn);
  } finally {
    const owner = await readFile(join(path, "owner.json"), "utf8").catch(() => "");
    if (owner.includes(token)) { await rm(join(path, "owner.json")); await rmdir(path); }
  }
}
