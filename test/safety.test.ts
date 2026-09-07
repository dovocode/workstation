import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { lockConfig } from "../src/persistence/lock.js";
import { applyPlan } from "../src/reconciliation/apply.js";
import type { Runner, ResolvedConfig } from "../src/api/types.js";

const runner: Runner = { async run() { throw new Error("Unexpected external command"); } };

it("isolates default ownership state by configuration and machine", async () => {
  const root = await mkdtemp(join(tmpdir(), "workstation-scope-"));
  for (const name of ["one.ts", "two.ts"]) await writeFile(join(root, name), "export default { resources: [] };");
  const first = await loadConfig(join(root, "one.ts"), "one");
  expect(first.stateFile).not.toBe((await loadConfig(join(root, "two.ts"), "one")).stateFile);
  expect(first.stateFile).not.toBe((await loadConfig(join(root, "one.ts"), "two")).stateFile);
});

it("keeps preview read-only, enforces frozen locks, and blocks removals with snapshots retained", async () => {
  const root = await mkdtemp(join(tmpdir(), "workstation-safety-"));
  const config: ResolvedConfig = { context: { home: root, configDir: root, machine: "test", hostname: "test", platform: "linux" }, stateFile: join(root, "state.json"), resources: [{ kind: "generated-file", target: join(root, "example"), format: "bash", value: "hello", ifExists: "overwrite" }] };
  const entry = join(root, "config.ts");
  await lockConfig(entry, config, runner, { write: false });
  await expect(readFile(join(root, "workstation.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lockConfig(entry, config, runner, { frozen: true })).rejects.toThrow("Frozen lock");
  await lockConfig(entry, config, runner);
  await lockConfig(entry, config, runner, { frozen: true });
  await applyPlan(config, runner);
  expect((await readdir(join(root, "history"))).length).toBe(1);
  await expect(applyPlan({ ...config, resources: [] }, runner, undefined, undefined, { noRemove: true })).rejects.toThrow("--no-remove");
  expect(await readFile(join(root, "example"), "utf8")).toBe("hello\n");
});
