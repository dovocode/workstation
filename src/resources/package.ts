import { readInstalledBrewVersion, readAvailableBrewVersion } from "./brew-info.js";
import type { ResolvedPackageResource, Runner, RunOptions } from "../api/types.js";
import type { Inspection } from "./shared.js";
import { inspectMiseCask, migrateMiseCask } from "./mise-cask.js";
import { inspectRpmPackage, prepareRpmPackage } from "./rpm.js";
import { inspectPacman, preparePacman } from "./pacman.js";
import { inspectFlatpak, prepareFlatpak, prepareFlatpakRemoval } from "./flatpak.js";
import { inspectMas, prepareMas } from "./mas.js";
import { runPackageCommand, type PackageCommand } from "./package-command.js";

/** Install or upgrade a package as needed, then verify its requested version. */
export async function reconcilePackage(resource: ResolvedPackageResource, runner: Runner): Promise<Inspection> {
  const before = await inspectPackage(resource, runner);
  if (before.conflict) throw new Error(before.conflict);
  if (before.migration === "mise-cask") {
    await assertBrewVersionAvailable(resource, runner);
    const mise = await inspectMiseCask(resource, runner);
    if (!mise) throw new Error(`Mise installation changed during inspection: ${resource.name}`);
    await migrateMiseCask(resource, mise, runner);
  } else {
    await runPackageCommand(await preparePackageInstallation(resource, runner, before), runner);
  }
  const inspection = await inspectPackage(resource, runner);
  if (!inspection.matches) {
    throw new Error(
      inspection.conflict ??
      `${resource.manager} reported success but ${resource.name} did not converge: expected ${resource.lockedVersion ?? resource.version ?? "no available upgrades"}; installed ${inspection.installedVersion ?? (inspection.present ? "version unknown" : "not present")}. Check the package manager output above for skipped upgrades or warnings.`,
    );
  }
  return inspection;
}

/** Query the backend for presence and compare installed versions or cask upgrade status. */
export async function inspectPackage(resource: ResolvedPackageResource, runner: Runner): Promise<Inspection> {
  switch (resource.manager) {
    case "mise":
      return inspectMise(resource, runner);
    case "brew":
    case "brew-cask":
      return inspectBrewCask(resource, runner);
    case "apt":
      return inspectApt(resource, runner);
    case "dnf":
    case "yum":
      return await inspectRpmPackage(resource, runner);
    case "pacman":
      return await inspectPacman(resource, runner);
    case "flatpak":
      return await inspectFlatpak(resource, runner);
    case "mas":
      return await inspectMas(resource, runner);
    case "system":
      throw new Error("System package manager must be resolved before inspection");
  }
}

/** Validate an install/upgrade and expose compatible flags for native batching. */
export async function preparePackageInstallation(resource: ResolvedPackageResource, runner: Runner, before: Inspection): Promise<PackageCommand | undefined> {
  if (before.conflict) throw new Error(before.conflict);
  if (before.migration) throw new Error(`Cask migration must run separately: ${resource.name}`);
  if (before.matches) return;
  let command: string;
  let args: string[];
  let spec = resource.name;
  switch (resource.manager) {
    case "mise":
      command = "mise";
      args = ["install"];
      spec = `${resource.name}@${resource.lockedVersion ?? resource.version ?? "latest"}`;
      break;
    case "dnf":
    case "yum":
      return await prepareRpmPackage(resource, runner, before);
    case "pacman":
      return await preparePacman(resource, runner, before);
    case "flatpak":
      return await prepareFlatpak(resource, runner, before);
    case "mas":
      return await prepareMas(resource, runner, before);
    case "brew":
    case "brew-cask":
      return prepareBrewInstallation(resource, runner, before);
    case "apt":
      command = "sudo";
      args = [
        "apt-get",
        "install",
        "-y",
        ...(resource.lockedVersion ? ["--allow-downgrades"] : []),
      ];
      spec = resource.lockedVersion ? `${resource.name}=${resource.lockedVersion}` : resource.name;
      break;
    case "system":
      throw new Error("System package manager must be resolved before installation");
  }
  return { command, args, targets: [spec], options: brewMutationOptions(resource) };
}

/** Keep Homebrew's validated version stable between the availability check and mutation. */
function brewMutationOptions(resource: ResolvedPackageResource): RunOptions {
  return {
    streamOutput: true,
    ...((resource.manager === "brew" || resource.manager === "brew-cask") && resource.lockedVersion
      ? { environment: { HOMEBREW_NO_AUTO_UPDATE: "1" } }
      : {}),
  };
}

/** Reject a Homebrew mutation when the configured taps cannot provide the locked version. */
async function assertBrewVersionAvailable(
  resource: ResolvedPackageResource,
  runner: Runner,
): Promise<void> {
  if (!resource.lockedVersion) return;
  const available = await readAvailableBrewVersion(resource, runner);
  if (available !== resource.lockedVersion) {
    throw new Error(
      `Homebrew currently offers ${resource.name} ${available}, but workstation.lock pins ${resource.lockedVersion}. Change its declaration to refresh the lock pin.`,
    );
  }
}

/** Uninstall the named package, using the recorded exact version for mise. */
export async function removePackage(
  resource: ResolvedPackageResource,
  runner: Runner,
  installedVersion?: string,
): Promise<void> {
  await runPackageCommand(preparePackageRemoval(resource, installedVersion), runner);
}

/** Prepare a native uninstall without broad cleanup or unrelated targets. */
export function preparePackageRemoval(resource: ResolvedPackageResource, installedVersion?: string): PackageCommand {
  let command: string;
  let args: string[];
  let spec = resource.name;
  switch (resource.manager) {
    case "mise":
      command = "mise";
      args = [
        "uninstall",
        "--yes",
      ];
      spec = `${resource.name}@${installedVersion ?? resource.lockedVersion ?? resource.version ?? "latest"}`;
      break;
    case "brew":
      command = "brew";
      args = ["uninstall"];
      break;
    case "brew-cask":
      command = "brew";
      args = ["uninstall", "--cask"];
      break;
    case "apt":
      command = "sudo";
      args = ["apt-get", "remove", "-y"];
      break;
    case "dnf":
    case "yum":
      command = "sudo";
      args = [resource.manager, "remove", "-y"];
      break;
    case "pacman":
      command = "sudo";
      args = ["pacman", "-R", "--noconfirm"];
      break;
    case "flatpak":
      return prepareFlatpakRemoval(resource);
    case "mas":
      command = "mas";
      args = ["uninstall"];
      break;
    case "system":
      throw new Error("System package manager must be resolved before removal");
  }
  return { command, args, targets: [spec] };
}

/** Inspect the mise backend payload. */
async function inspectMise(resource: ResolvedPackageResource, runner: Runner): Promise<Inspection> {
  const spec = `${resource.name}@${resource.lockedVersion ?? resource.version ?? "latest"}`;
  const result = await runner.run("mise", ["where", spec]);
  if (result.exitCode !== 0) return { present: false, matches: false };
  const path = result.stdout.trim();
  const installedVersion = path.split("/").at(-1);
  return {
    present: true,
    matches: true,
    ...(installedVersion ? { installedVersion } : {}),
  };
}

/** Inspect the brew-cask backend payload. */
async function inspectBrewCask(resource: ResolvedPackageResource, runner: Runner): Promise<Inspection> {
  const flag = resource.manager === "brew-cask" ? "--cask" : "--formula";
  const result = await runner.run("brew", ["list", flag, resource.name]);
  const installed = result.exitCode === 0;
  if (installed && resource.lockedVersion !== undefined) {
    return inspectPinnedBrew(resource, runner, flag);
  }
  if (!installed || resource.manager !== "brew-cask" || resource.upgrade === undefined) {
    return { present: installed, matches: installed };
  }
  const args = ["outdated", "--quiet", "--cask"];
  if (resource.upgrade.greedy) args.push("--greedy");
  args.push(resource.name);
  const outdated = await runner.run("brew", args);
  if (outdated.exitCode !== 0) {
    throw new Error(
      `brew ${args.join(" ")} failed (${outdated.exitCode})${outdated.stderr ? `: ${outdated.stderr.trim()}` : ""}`,
    );
  }
  return { present: true, matches: outdated.stdout.trim().length === 0 };
}

/** Inspect the apt backend payload. */
async function inspectApt(resource: ResolvedPackageResource, runner: Runner): Promise<Inspection> {
  const format = resource.lockedVersion ? "-f=${Status}\t${Version}" : "-f=${Status}";
  const result = await runner.run("dpkg-query", ["-W", format, resource.name]);
  const [status, installedVersion] = result.stdout.trim().split("\t");
  const installed = result.exitCode === 0 && status === "install ok installed";
  return {
    present: installed,
    matches:
      installed &&
      (resource.lockedVersion === undefined || installedVersion === resource.lockedVersion),
    ...(installedVersion ? { installedVersion } : {}),
  };
}

/** Prepare Homebrew-specific adoption and upgrade flags after verifying availability. */
async function prepareBrewInstallation(resource: ResolvedPackageResource, runner: Runner, before: Inspection): Promise<PackageCommand> {
  await assertBrewVersionAvailable(resource, runner);
  const args = [before.present ? "upgrade" : "install"];
  if (resource.manager === "brew-cask") {
    args.push("--cask");
    if (before.present) {
      args.push("--no-ask");
      if (resource.lockedVersion || resource.upgrade?.greedy) args.push("--greedy");
      if (resource.upgrade?.force) args.push("--force");
    }
  }
  return { command: "brew", args, targets: [resource.name], options: brewMutationOptions(resource) };
}

/** Compare Homebrew receipts with an exact pin and recognize supported mise migrations. */
async function inspectPinnedBrew(resource: ResolvedPackageResource, runner: Runner, flag: string): Promise<Inspection> {
  const installedVersion = await readInstalledBrewVersion(resource, runner);
  if (installedVersion === undefined && resource.manager === "brew-cask") {
    const mise = await inspectMiseCask(resource, runner);
    if (mise) return { present: true, matches: false, installedVersion: mise.version, migration: "mise-cask" };
  }
  return {
    present: true,
    matches: installedVersion === resource.lockedVersion,
    ...(installedVersion ? { installedVersion } : {}),
    ...(installedVersion === undefined ? {
      conflict: `Homebrew lists ${resource.name} but reports no installed version. Its installation metadata may be incomplete; inspect brew info --json=v2 ${flag} ${resource.name} and repair the Homebrew installation before retrying.`,
    } : {}),
  };
}
