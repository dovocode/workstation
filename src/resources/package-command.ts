import type { Runner, RunOptions } from "../api/types.js";
import { requireSuccess } from "./shared.js";

/** A validated native package mutation, with targets separate from shared flags. */
export interface PackageCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly targets: readonly string[];
  readonly options?: RunOptions;
  /** Some commands (Flatpak commit updates) accept only one target. */
  readonly single?: boolean;
}

/** Execute a prepared mutation without changing its validated options or targets. */
export async function runPackageCommand(mutation: PackageCommand | undefined, runner: Runner): Promise<void> {
  if (!mutation) return;
  await requireSuccess(runner, mutation.command, [...mutation.args, ...mutation.targets], { ...mutation.options, streamOutput: true });
}

/** Identify commands that can share a single native transaction. */
export function packageCommandKey(mutation: PackageCommand): string | undefined {
  return mutation.single ? undefined : JSON.stringify([mutation.command, mutation.args, mutation.options]);
}
