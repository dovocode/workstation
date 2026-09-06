import type { ResolvedPackageResource, Runner } from "../api/types.js";
import { requireSuccess, type Inspection } from "./shared.js";
import { runPackageCommand, type PackageCommand } from "./package-command.js";

/** Parse mas's app table while preserving names containing spaces or parentheses. */
function appRows(output: string): Array<{ id: string; version: string }> {
  return output.trim() === "" ? [] : output.trim().split("\n").map((line) => {
    const match = /^\s*(\d+)\s+.+\s+\(([^()]+)\)\s*$/.exec(line);
    if (!match?.[1] || !match[2]) throw new Error(`mas returned an unrecognized app row: ${line}`);
    return { id: match[1], version: match[2] };
  });
}

/** Inspect an exact App Store ID and follow available updates; historical pins are unsupported. */
export async function inspectMas(resource: ResolvedPackageResource, runner: Runner): Promise<Inspection> {
  if (resource.lockedVersion !== undefined) throw new Error("mas does not support version pins");
  const installed = appRows((await requireSuccess(runner, "mas", ["list"])).stdout).find((app) => app.id === resource.name);
  if (!installed) return { present: false, matches: false };
  const outdated = appRows((await requireSuccess(runner, "mas", ["outdated"])).stdout);
  return { present: true, matches: !outdated.some((app) => app.id === resource.name), installedVersion: installed.version };
}

/** Install previously acquired apps or update an installed app, without purchasing anything. */
export async function installMas(resource: ResolvedPackageResource, runner: Runner): Promise<void> {
  await runPackageCommand(await prepareMas(resource, runner), runner);
}

/** Prepare an explicit list-targeted App Store install or upgrade. */
export async function prepareMas(resource: ResolvedPackageResource, runner: Runner, inspection?: Inspection): Promise<PackageCommand | undefined> {
  const before = inspection ?? await inspectMas(resource, runner);
  if (before.matches) return;
  return { command: "mas", args: [before.present ? "upgrade" : "install"], targets: [resource.name] };
}
