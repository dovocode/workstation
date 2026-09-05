import { readInstalledBrewVersion, readAvailableBrewVersion } from "./brew-info.js";
import type { ResolvedPackageResource, Runner } from "../api/types.js";
import { requireSuccess, type Inspection } from "./shared.js";

/** Install or upgrade a package as needed, then verify its requested version. */
export async function reconcilePackage(resource: ResolvedPackageResource, runner: Runner): Promise<Inspection> {
  if (
    (resource.manager === "brew" || resource.manager === "brew-cask") &&
    resource.lockedVersion !== undefined
  ) {
    const before = await inspectPackage(resource, runner);
    if (!before.present) {
      await installPackage(resource, runner);
    } else if (!before.matches) {
      await upgradeLockedBrewPackage(resource, runner);
    }
  } else if (resource.manager === "brew-cask" && resource.upgrade !== undefined) {
    const before = await inspectPackage(resource, runner);
    if (before.present && !before.matches) {
      await upgradePackage(resource, runner);
    } else if (!before.present) {
      await installPackage(resource, runner);
    }
  } else {
    await installPackage(resource, runner);
  }
  const inspection = await inspectPackage(resource, runner);
  if (!inspection.matches) {
    throw new Error(
      inspection.conflict ??
        `${resource.manager} reported success but ${resource.name} does not match the requested version`,
    );
  }
  return inspection;
}

/** Query the backend for presence and compare installed versions or cask upgrade status. */
export async function inspectPackage(resource: ResolvedPackageResource, runner: Runner): Promise<Inspection> {
  switch (resource.manager) {
    case "mise": {
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
    case "brew":
    case "brew-cask": {
      const flag = resource.manager === "brew-cask" ? "--cask" : "--formula";
      const result = await runner.run("brew", ["list", flag, resource.name]);
      const installed = result.exitCode === 0;
      if (installed && resource.lockedVersion !== undefined) {
        const installedVersion = await readInstalledBrewVersion(resource, runner);
        return {
          present: true,
          matches: installedVersion === resource.lockedVersion,
          ...(installedVersion ? { installedVersion } : {}),
        };
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
    case "apt": {
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
    case "system":
      throw new Error("System package manager must be resolved before inspection");
  }
}

/** Upgrade a cask using its configured greedy and force policy. */
async function upgradePackage(resource: ResolvedPackageResource, runner: Runner): Promise<void> {
  if (resource.manager !== "brew-cask" || resource.upgrade === undefined) {
    throw new Error(`Upgrade policy is not configured for ${resource.name}`);
  }
  await assertBrewVersionAvailable(resource, runner);
  const args = ["upgrade", "--cask", "--no-ask"];
  if (resource.upgrade.greedy) args.push("--greedy");
  if (resource.upgrade.force) args.push("--force");
  args.push(resource.name);
  await requireSuccess(runner, "brew", args);
}

/** Upgrade a formula or cask after verifying that the locked version is available. */
async function upgradeLockedBrewPackage(
  resource: ResolvedPackageResource,
  runner: Runner,
): Promise<void> {
  if (resource.manager !== "brew" && resource.manager !== "brew-cask") {
    throw new Error(`Cannot upgrade non-Homebrew package ${resource.name}`);
  }
  await assertBrewVersionAvailable(resource, runner);
  const args = ["upgrade"];
  if (resource.manager === "brew-cask") {
    args.push("--cask", "--no-ask");
    if (resource.upgrade?.greedy) args.push("--greedy");
    if (resource.upgrade?.force) args.push("--force");
  }
  args.push(resource.name);
  await requireSuccess(runner, "brew", args);
}

/** Run the backend's install command using an exact pin where supported. */
async function installPackage(resource: ResolvedPackageResource, runner: Runner): Promise<void> {
  let command: string;
  let args: string[];
  switch (resource.manager) {
    case "mise":
      command = "mise";
      args = ["install", `${resource.name}@${resource.lockedVersion ?? resource.version ?? "latest"}`];
      break;
    case "brew":
      await assertBrewVersionAvailable(resource, runner);
      command = "brew";
      args = ["install", resource.name];
      break;
    case "brew-cask":
      await assertBrewVersionAvailable(resource, runner);
      command = "brew";
      args = ["install", "--cask", resource.name];
      break;
    case "apt":
      command = "sudo";
      args = [
        "apt-get",
        "install",
        "-y",
        ...(resource.lockedVersion ? ["--allow-downgrades"] : []),
        resource.lockedVersion ? `${resource.name}=${resource.lockedVersion}` : resource.name,
      ];
      break;
    case "system":
      throw new Error("System package manager must be resolved before installation");
  }
  await requireSuccess(runner, command, args);
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
  let command: string;
  let args: string[];
  switch (resource.manager) {
    case "mise":
      command = "mise";
      args = [
        "uninstall",
        "--yes",
        `${resource.name}@${installedVersion ?? resource.lockedVersion ?? resource.version ?? "latest"}`,
      ];
      break;
    case "brew":
      command = "brew";
      args = ["uninstall", resource.name];
      break;
    case "brew-cask":
      command = "brew";
      args = ["uninstall", "--cask", resource.name];
      break;
    case "apt":
      command = "sudo";
      args = ["apt-get", "remove", "-y", resource.name];
      break;
    case "system":
      throw new Error("System package manager must be resolved before removal");
  }
  await requireSuccess(runner, command, args);
}
