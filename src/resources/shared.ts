import { chmod, rename, writeFile } from "node:fs/promises";
import type { CommandResult, Runner } from "../api/types.js";

export interface Inspection {
  readonly present: boolean;
  readonly matches: boolean;
  readonly installedVersion?: string;
  readonly installedHash?: string;
  readonly conflict?: string;
  readonly migration?: "mise-cask";
}

/** Write a temporary sibling and rename it into place to avoid partial destination content. */
export async function atomicWrite(path: string, content: string, mode = 0o644): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { mode });
  await chmod(temporary, mode);
  await rename(temporary, path);
}

/** Run a command and return its output; throw with command context on a nonzero exit. */
export async function requireSuccess(
  runner: Runner,
  command: string,
  args: readonly string[],
  options?: Parameters<Runner["run"]>[2],
): Promise<CommandResult> {
  const result = await runner.run(command, args, options);
  if (result.exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.exitCode})${result.stderr ? `: ${result.stderr.trim()}` : ""}`,
    );
  }
  return result;
}

/** Recognize ENOENT without swallowing permission or other filesystem failures. */
export function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
