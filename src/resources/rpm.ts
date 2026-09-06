import type { ResolvedPackageResource, Runner } from "../api/types.js";
import { requireSuccess, type Inspection } from "./shared.js";
import { runPackageCommand, type PackageCommand } from "./package-command.js";

const environment = { LC_ALL: "C" };
const versionPattern = /^\d+:[A-Za-z0-9._+~^]+-[A-Za-z0-9._+~^]+\.[A-Za-z0-9_]+$/;

/** Resolve the backend's latest listed package for the requested or native architecture. */
export async function resolveRpmVersion(resource: ResolvedPackageResource, runner: Runner): Promise<string> {
  const architecture = (await requireSuccess(runner, "rpm", ["--eval", "%{_arch}"], { environment })).stdout.trim();
  if (!/^[A-Za-z0-9_]+$/.test(architecture)) throw new Error("RPM did not report a valid native architecture");
  const result = await requireSuccess(runner, resource.manager, ["--quiet", "--color=never", "list", resource.name], { environment });
  const candidates: Array<{ version: string; native: boolean; available: boolean }> = [];
  let available = false;
  // Both YUM and DNF list their newest available versions unless --showduplicates is requested.
  // Long names may wrap onto a separate line; collapse only that continuation.
  const lines = result.stdout.replace(/^(\S+\.\S+)\n[ \t]+(?=\S+\s+\S+)/gm, "$1 ").split("\n");
  for (const line of lines) {
    if (/^Available packages\s*$/i.test(line.trim())) { available = true; continue; }
    if (/^Installed packages\s*$/i.test(line.trim())) { available = false; continue; }
    const [nameArch, evr, repository] = line.trim().split(/\s+/);
    if (!nameArch || !evr || !repository) continue;
    const dot = nameArch.lastIndexOf(".");
    const name = nameArch.slice(0, dot);
    const arch = nameArch.slice(dot + 1);
    if (nameArch !== resource.name && (name !== resource.name || (arch !== architecture && arch !== "noarch"))) continue;
    const version = `${evr.includes(":") ? evr : `0:${evr}`}.${arch}`;
    if (!versionPattern.test(version)) throw new Error(`${resource.manager} reported an invalid RPM version for ${resource.name}: ${version}`);
    candidates.push({ version, native: arch === architecture, available });
  }
  candidates.sort((left, right) => Number(right.available) - Number(left.available) || Number(right.native) - Number(left.native));
  const candidate = candidates[0];
  if (!candidate) throw new Error(`${resource.manager} has no installation candidate for ${resource.name}`);
  return candidate.version;
}

/** Read exact epoch/version/release/architecture tuples from RPM's installed database. */
export async function inspectRpmPackage(resource: ResolvedPackageResource, runner: Runner): Promise<Inspection> {
  const result = await runner.run("rpm", ["-q", "--qf", "%{EPOCHNUM}:%{VERSION}-%{RELEASE}.%{ARCH}\n", resource.name], { environment });
  if (result.exitCode !== 0) {
    if (result.exitCode === 1 && result.stdout.trim() === `package ${resource.name} is not installed` && !result.stderr.trim()) {
      return { present: false, matches: false };
    }
    throw new Error(`rpm query failed for ${resource.name} (${result.exitCode}): ${(result.stderr || result.stdout).trim()}`);
  }
  const versions = result.stdout.trim().split("\n");
  if (!versions.every((version) => versionPattern.test(version))) throw new Error(`RPM returned invalid installed versions for ${resource.name}`);
  const requestedArch = resource.lockedVersion?.slice(resource.lockedVersion.lastIndexOf(".") + 1);
  const installedVersion = versions.find((version) => version === resource.lockedVersion) ??
    versions.find((version) => requestedArch !== undefined && version.endsWith(`.${requestedArch}`)) ?? versions[0];
  if (!installedVersion) throw new Error(`RPM reported no installed version for ${resource.name}`);
  return { present: true, matches: resource.lockedVersion === undefined || installedVersion === resource.lockedVersion, installedVersion };
}

/** Install, upgrade or downgrade an exact RPM pin using RPM's own version comparison. */
export async function installRpmPackage(resource: ResolvedPackageResource, runner: Runner): Promise<void> {
  await runPackageCommand(await prepareRpmPackage(resource, runner), runner);
}

/** Validate an RPM mutation and keep its package spec separate for native batching. */
export async function prepareRpmPackage(resource: ResolvedPackageResource, runner: Runner, inspection?: Inspection): Promise<PackageCommand | undefined> {
  const before = inspection ?? await inspectRpmPackage(resource, runner);
  if (before.matches) return;
  let operation = "install";
  let spec = resource.name;
  if (resource.lockedVersion !== undefined) {
    const desired = resource.lockedVersion;
    if (!versionPattern.test(desired)) throw new Error(`Invalid RPM lock version for ${resource.name}: ${desired}`);
    const arch = desired.slice(desired.lastIndexOf(".") + 1);
    const name = resource.name.endsWith(`.${arch}`) ? resource.name.slice(0, -arch.length - 1) : resource.name;
    spec = `${name}-${desired}`;
    if (before.installedVersion?.endsWith(`.${arch}`)) {
      const current = before.installedVersion.slice(0, before.installedVersion.lastIndexOf("."));
      const target = desired.slice(0, desired.lastIndexOf("."));
      // Values are validated above as RPM version tokens, with no Lua metacharacters.
      const comparison = (await requireSuccess(runner, "rpm", ["--eval", `%{lua:print(rpm.vercmp("${current}", "${target}"))}`], { environment })).stdout.trim();
      if (!["-1", "0", "1"].includes(comparison)) throw new Error(`RPM could not compare versions for ${resource.name}`);
      if (comparison === "1") operation = "downgrade";
    }
  }
  return { command: "sudo", args: [resource.manager, operation, "-y"], targets: [spec] };
}
