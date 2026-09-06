import type { ResolvedPackageResource, Runner } from "../api/types.js";
import { requireSuccess, type Inspection } from "./shared.js";
import { runPackageCommand, type PackageCommand } from "./package-command.js";

/** Resolve defaults in one place for all Flatpak queries and mutations. */
function target(resource: ResolvedPackageResource) {
  const scope = resource.flatpak?.scope ?? "user";
  const branch = resource.flatpak?.branch ?? "stable";
  return { scope, branch, flag: `--${scope}`, remote: resource.flatpak?.remote ?? "flathub", ref: `app/${resource.name}//${branch}` };
}

/** Require a full OSTree commit rather than an ambiguous short hash or display version. */
function commit(value: string): string {
  const hash = value.trim();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Flatpak did not report a full commit ID: ${hash}`);
  return hash;
}

/** Lock the app commit from the configured remote and branch in the chosen installation. */
export async function resolveFlatpakVersion(resource: ResolvedPackageResource, runner: Runner): Promise<string> {
  const { flag, remote, ref } = target(resource);
  return commit((await requireSuccess(runner, "flatpak", ["remote-info", flag, "--show-commit", remote, ref])).stdout);
}

/** Inspect the exact app/branch and reject a different origin instead of changing remotes silently. */
export async function inspectFlatpak(resource: ResolvedPackageResource, runner: Runner): Promise<Inspection> {
  const { flag, remote, ref, branch } = target(resource);
  const result = await requireSuccess(runner, "flatpak", ["list", flag, "--app", "--columns=application,branch,origin"]);
  const rows = result.stdout.trim() === "" ? [] : result.stdout.trim().split("\n").map((line) => line.split("\t"));
  if (rows.some((row) => row.length !== 3 || row.some((value) => value === ""))) throw new Error("Flatpak returned an invalid application list");
  const installed = rows.find(([id, installedBranch]) => id === resource.name && installedBranch === branch);
  if (!installed) return { present: false, matches: false };
  if (installed[2] !== remote) return { present: true, matches: false, conflict: `${resource.name} is installed from ${installed[2]}, but the configuration requests ${remote}. Migrate its remote explicitly.` };
  const installedVersion = commit((await requireSuccess(runner, "flatpak", ["info", flag, "--show-commit", ref])).stdout);
  return { present: true, matches: resource.lockedVersion === undefined || installedVersion === resource.lockedVersion, installedVersion };
}

/** Install the current remote commit or update an existing deployment to its pinned commit. */
export async function installFlatpak(resource: ResolvedPackageResource, runner: Runner): Promise<void> {
  await runPackageCommand(await prepareFlatpak(resource, runner), runner);
}

/** Prepare a scope/remote-specific mutation; commit updates must remain single-target. */
export async function prepareFlatpak(resource: ResolvedPackageResource, runner: Runner, inspection?: Inspection): Promise<PackageCommand | undefined> {
  const before = inspection ?? await inspectFlatpak(resource, runner);
  if (before.conflict) throw new Error(before.conflict);
  if (before.matches) return;
  const { flag, scope, remote, ref } = target(resource);
  if (resource.lockedVersion !== undefined) commit(resource.lockedVersion);
  if (!before.present && resource.lockedVersion !== undefined && await resolveFlatpakVersion(resource, runner) !== resource.lockedVersion) {
    throw new Error(`Flatpak's current ${resource.name} commit differs from workstation.lock. Refresh its pin before a fresh install; existing installations can update to retained historical commits.`);
  }
  const args = before.present
    ? ["update", flag, "--noninteractive", "--assumeyes", ...(resource.lockedVersion ? [`--commit=${resource.lockedVersion}`] : [])]
    : ["install", flag, "--noninteractive", "--assumeyes", "--app", remote];
  return { command: scope === "system" ? "sudo" : "flatpak", args: scope === "system" ? ["flatpak", ...args] : args,
    targets: [ref], ...(before.present && resource.lockedVersion ? { single: true } : {}) };
}

/** Remove only the declared app/branch, retaining app data and unrelated runtimes. */
export async function removeFlatpak(resource: ResolvedPackageResource, runner: Runner): Promise<void> {
  await runPackageCommand(prepareFlatpakRemoval(resource), runner);
}

/** Prepare removal of declared refs only, grouped by installation scope. */
export function prepareFlatpakRemoval(resource: ResolvedPackageResource): PackageCommand {
  const { flag, scope, ref } = target(resource);
  const args = ["uninstall", flag, "--noninteractive", "--assumeyes", "--app"];
  return { command: scope === "system" ? "sudo" : "flatpak", args: scope === "system" ? ["flatpak", ...args] : args, targets: [ref] };
}
