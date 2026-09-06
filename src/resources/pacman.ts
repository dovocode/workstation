import type { ResolvedPackageResource, Runner } from "../api/types.js";
import { requireSuccess, type Inspection } from "./shared.js";
import { runPackageCommand, type PackageCommand } from "./package-command.js";

const environment = { LC_ALL: "C" };

/** Resolve the named package from pacman's existing sync database, without refreshing it. */
export async function resolvePacmanVersion(resource: ResolvedPackageResource, runner: Runner): Promise<string> {
  const result = await requireSuccess(runner, "pacman", ["-Sp", "--print-format", "%n\t%v", resource.name], { environment });
  const versions = result.stdout.trim().split("\n").flatMap((line) => {
    const [name, version, extra] = line.trim().split(/\s+/);
    return name === resource.name && version && !extra ? [version] : [];
  });
  if (versions.length !== 1 || !versions[0]) throw new Error(`pacman did not report a unique version for ${resource.name}`);
  return versions[0];
}

/** Query one exact installed package; distinguish absence from database or permission failures. */
export async function inspectPacman(resource: ResolvedPackageResource, runner: Runner): Promise<Inspection> {
  const result = await runner.run("pacman", ["-Q", resource.name], { environment });
  if (result.exitCode !== 0) {
    if (result.exitCode === 1 && !result.stdout.trim() && result.stderr.trim() === `error: package '${resource.name}' was not found`) {
      return { present: false, matches: false };
    }
    throw new Error(`pacman query failed for ${resource.name} (${result.exitCode}): ${(result.stderr || result.stdout).trim()}`);
  }
  const [name, installedVersion, extra] = result.stdout.trim().split(/\s+/);
  if (name !== resource.name || !installedVersion || extra) throw new Error(`pacman returned invalid installed information for ${resource.name}`);
  return { present: true, matches: resource.lockedVersion === undefined || resource.lockedVersion === installedVersion, installedVersion };
}

/** Install only the named package after checking that the sync database can satisfy its pin. */
export async function installPacman(resource: ResolvedPackageResource, runner: Runner): Promise<void> {
  await runPackageCommand(await preparePacman(resource, runner), runner);
}

/** Check a sync-database pin before preparing a batchable pacman transaction. */
export async function preparePacman(resource: ResolvedPackageResource, runner: Runner, inspection?: Inspection): Promise<PackageCommand | undefined> {
  if ((inspection ?? await inspectPacman(resource, runner)).matches) return;
  const available = await resolvePacmanVersion(resource, runner);
  if (resource.lockedVersion !== undefined && available !== resource.lockedVersion) {
    throw new Error(`pacman offers ${resource.name} ${available}, but workstation.lock pins ${resource.lockedVersion}. Refresh the pin after your normal full system upgrade; Workstation does not fetch archived packages.`);
  }
  return { command: "sudo", args: ["pacman", "-S", "--needed", "--noconfirm"], targets: [resource.name] };
}
