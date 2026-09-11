import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ProvisionResource, ProvisionOperation } from "../api/provision.js";
import type { CommandSpec, Runner } from "../api/types.js";
import { isMissingFile, requireSuccess, type Inspection } from "./shared.js";

type Op<T extends ProvisionOperation["type"]> = Extract<ProvisionOperation, { type: T }>;
/** Construct presence and convergence information separately. */
const observed = (matches: boolean, present = matches): Inspection => ({ matches, present });
/** Execute a check using its declared directory and environment. */
const run = (runner: Runner, spec: CommandSpec) => runner.run(spec.command, spec.args ?? [], commandOptions(spec));

/** Inspect actual setup state. Read failures are errors, never silently treated as successful setup. */
export async function inspectProvision(resource: ProvisionResource, runner: Runner): Promise<Inspection> {
  const op = resource.operation.type === "apt-repository" ? await resolveAptRepository(resource.operation, runner) : resource.operation;
  switch (op.type) {
    case "copy-file": return inspectCopy(op);
    case "brew-tap": return inspectTap(op, runner);
    case "apt-repository": return inspectAptRepository(op, runner);
    case "macos-default": return inspectPreference(op, runner);
    case "macos-installer": return inspectMacPackage(op, runner);
    case "linger": return observed((await requireSuccess(runner, "loginctl", ["show-user", op.user, "--property=Linger", "--value"])).stdout.trim() === "yes", true);
    case "group-member": return observed((await requireSuccess(runner, "id", ["-nG", op.user])).stdout.trim().split(/\s+/).includes(op.group), true);
    case "service": return inspectExistingService(op, runner);
    case "check": return inspectCheck(op, runner);
  }
}

/** Apply one operation and require a fresh successful inspection before checkpointing. */
export async function installProvision(resource: ProvisionResource, runner: Runner): Promise<Inspection> {
  const op = resource.operation.type === "apt-repository" ? await resolveAptRepository(resource.operation, runner) : resource.operation;
  switch (op.type) {
    case "copy-file": await installCopy(op, runner); break;
    case "brew-tap": await installTap(op, runner); break;
    case "apt-repository": await installAptRepository(op, runner); break;
    case "macos-default": await installPreference(op, runner); break;
    case "macos-installer": await installMacPackage(op, runner); break;
    case "linger": await requireSuccess(runner, "sudo", ["loginctl", "enable-linger", op.user], { streamOutput: true }); break;
    case "group-member": await requireSuccess(runner, "sudo", ["usermod", "-aG", op.group, op.user], { streamOutput: true }); runner.report?.(`New group membership takes effect at the next login (${op.user})`); break;
    case "service": await startExistingService(op, runner); break;
    case "check": await repairCheck(op, runner); break;
  }
  const after = await inspectProvision(resource, runner);
  if (!after.matches) throw new Error(`Setup verification failed: ${resource.name}`);
  return after;
}

/** Repository setup must finish before querying package versions. */
export function isRepositoryResource(resource: { kind: string }): resource is ProvisionResource {
  return resource.kind === "provision" && "operation" in resource && typeof resource.operation === "object" && resource.operation !== null && "type" in resource.operation && ["brew-tap", "apt-repository"].includes(String(resource.operation.type));
}
/** Treat only missing files as absent prerequisites. */

async function exists(path: string): Promise<boolean> { try { await lstat(path); return true; } catch (error) { if (isMissingFile(error)) return false; throw error; } }
/** Read file bytes while preserving permission and other filesystem errors. */
async function optionalRead(path: string): Promise<Buffer | undefined> { try { return await readFile(path); } catch (error) { if (isMissingFile(error)) return; throw error; } }
/** Calculate the SHA-256 digest used by repository and installer verification. */
function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
/** Decode the source bytes captured during configuration resolution. */
function copyBytes(op: Op<"copy-file">): Buffer { if (op.content === undefined) throw new Error("Copy source must be resolved before applying"); return Buffer.from(op.content, "base64"); }
/** Seed or replace a file while preserving mutable contents and rejecting unsafe targets. */
async function installCopy(op: Op<"copy-file">, runner: Runner): Promise<void> {
  const stats = await lstat(op.target).catch(error => { if (isMissingFile(error)) return undefined; throw error; });
  if (stats?.isFile() && op.seed) return;
  if (stats && !stats.isFile() && !(stats.isSymbolicLink() && op.migrateSymlink)) throw new Error(`Refusing non-regular copy target: ${op.target}`);
  if (stats?.isSymbolicLink() && op.privileged) throw new Error(`Privileged symlink migration requires explicit manual migration: ${op.target}`);
  let bytes = copyBytes(op);
  if (stats?.isSymbolicLink() && op.migrateSymlink && op.seed) bytes = await optionalRead(op.target) ?? bytes;
  await withTemporary(async root => {
    const temporary = join(root, "file");
    await writeFile(temporary, bytes, { mode: op.mode ?? 0o644 });
    if (op.privileged) {
      await requireSuccess(runner, "sudo", ["install", "-d", "-m", "0755", dirname(op.target)]);
      await requireSuccess(runner, "sudo", ["install", "-m", (op.mode ?? 0o644).toString(8), temporary, op.target]);
    } else {
      await mkdir(dirname(op.target), { recursive: true, mode: 0o700 });
      const sibling = `${op.target}.${process.pid}.copy.tmp`;
      try { await writeFile(sibling, bytes, { mode: op.mode ?? 0o644, flag: "wx" }); await chmod(sibling, op.mode ?? 0o644); await rename(sibling, op.target); }
      finally { await rm(sibling, { force: true }); }
    }
  });
}
/** Render a deterministic deb822 source with an isolated signing key. */
function aptSource(op: Op<"apt-repository">): string {
  return `Types: deb\nURIs: ${op.uri}\nSuites: ${op.suite}\nComponents: ${op.components.join(" ")}\nArchitectures: ${op.architecture}\nSigned-By: /etc/apt/keyrings/${op.name}.asc\n`;
}
/** Reject existing conflicting runtime packages without uninstalling them. */
async function checkConflicts(op: Op<"apt-repository">, runner: Runner): Promise<void> {
  for (const name of op.conflicts ?? []) {
    const result = await runner.run("dpkg-query", ["-W", "-f=${Status}", name]);
    if (result.exitCode === 0 && result.stdout.trim() === "install ok installed") throw new Error(`${name} conflicts with repository ${op.name}; migrate it explicitly first`);
    if (result.exitCode !== 0 && result.exitCode !== 1) throw new Error(`Could not inspect conflicting package ${name}: ${result.stderr}`);
  }
}
/** Verify the downloaded key before installing repository files and refreshing metadata. */
async function installAptRepository(op: Op<"apt-repository">, runner: Runner): Promise<void> {
  await checkConflicts(op, runner);
  await withTemporary(async root => {
    const key = join(root, "key.asc");
    await download(op.keyUrl, key, runner);
    if (digest(await readFile(key)) !== op.keySha256.toLowerCase()) throw new Error(`Repository key digest mismatch: ${op.name}`);
    const source = join(root, "repository.sources");
    await writeFile(source, aptSource(op), { mode: 0o600 });
    await requireSuccess(runner, "sudo", ["install", "-d", "-m", "0755", "/etc/apt/keyrings", "/etc/apt/sources.list.d"]);
    await requireSuccess(runner, "sudo", ["install", "-m", "0644", key, `/etc/apt/keyrings/${op.name}.asc`]);
    await requireSuccess(runner, "sudo", ["install", "-m", "0644", source, `/etc/apt/sources.list.d/${op.name}.sources`]);
    await requireSuccess(runner, "sudo", ["apt-get", "update"], { streamOutput: true });
  });
}
/** Verify the declared signer and platform assessment before invoking the installer. */
async function installMacPackage(op: Op<"macos-installer">, runner: Runner): Promise<void> {
  await withTemporary(async root => {
    const pkg = join(root, "installer.pkg");
    await download(op.url, pkg, runner);
    if (op.sha256 && digest(await readFile(pkg)) !== op.sha256.toLowerCase()) throw new Error("Installer digest mismatch");
    const signature = await requireSuccess(runner, "pkgutil", ["--check-signature", pkg]);
    if (!new RegExp(`^\\s*1\\. Developer ID Installer: .+ \\(${op.teamId}\\)$`, "m").test(signature.stdout)) throw new Error("Installer signer mismatch");
    await requireSuccess(runner, "spctl", ["--assess", "--type", "install", pkg]);
    await requireSuccess(runner, "sudo", ["installer", "-pkg", pkg, "-target", "/"], { streamOutput: true });
  });
}
/** Download over HTTPS with bounded connection and total execution time. */
async function download(url: string, path: string, runner: Runner): Promise<void> { await requireSuccess(runner, "curl", ["--fail", "--location", "--proto", "=https", "--proto-redir", "=https", "--connect-timeout", "20", "--max-time", "600", url, "--output", path], { streamOutput: true }); }
/** Remove the private download workspace on success or failure. */
async function withTemporary(fn: (root: string) => Promise<void>): Promise<void> { const root = await mkdtemp(join(tmpdir(), "workstation-setup-")); try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); } }
/** Resolve the launchd domain for a user or system service. */
function domain(op: Op<"service">): string { return op.scope === "system" ? "system" : `gui/${process.getuid?.() ?? 0}`; }
/** Check runtime activation and enablement, respecting optional GUI sessions. */
async function inspectExistingService(op: Op<"service">, runner: Runner): Promise<Inspection> {
  if (op.manager === "systemd") {
    const args = op.scope === "user" ? ["--user"] : [];
    const active = await runner.run("systemctl", [...args, "is-active", "--quiet", op.name]);
    const enabled = await runner.run("systemctl", [...args, "is-enabled", op.name]);
    if (![0, 3, 4].includes(active.exitCode) || ![0, 1, 3, 4].includes(enabled.exitCode)) throw new Error(`Cannot inspect service ${op.name}`);
    return observed(active.exitCode === 0 && enabled.exitCode === 0, true);
  }
  if (op.optionalSession && (await runner.run("launchctl", ["print", domain(op)])).exitCode !== 0) return observed(true);
  if (op.optionalSession && op.plist && !await exists(op.plist)) return observed(true);
  const result = await runner.run("launchctl", ["print", `${domain(op)}/${op.name}`]);
  return observed(result.exitCode === 0 && /state = running/.test(result.stdout), result.exitCode === 0);
}
/** Activate or restart a declared existing service. */
async function startExistingService(op: Op<"service">, runner: Runner): Promise<void> {
  if (op.manager === "systemd") {
    await requireSuccess(runner, op.scope === "system" ? "sudo" : "systemctl", op.scope === "system" ? ["systemctl", "enable", "--now", op.name] : ["--user", "enable", "--now", op.name]);
    await requireSuccess(runner, op.scope === "system" ? "sudo" : "systemctl", op.scope === "system" ? ["systemctl", "restart", op.name] : ["--user", "restart", op.name]);
    return;
  }
  const loaded = await runner.run("launchctl", ["print", `${domain(op)}/${op.name}`]);
  const args = loaded.exitCode === 0 ? ["kickstart", "-k", `${domain(op)}/${op.name}`] : ["bootstrap", domain(op), op.plist!];
  await requireSuccess(runner, op.scope === "system" ? "sudo" : "launchctl", op.scope === "system" ? ["launchctl", ...args] : args);
}
/** Preserve optional direct-command execution settings. */

function commandOptions(spec: CommandSpec) { return { ...(spec.cwd ? { cwd: spec.cwd } : {}), ...(spec.environment ? { environment: spec.environment } : {}) }; }
/** Detect supported distribution metadata without sourcing executable shell code. */

async function resolveAptRepository(op: Op<"apt-repository">, runner: Runner): Promise<Op<"apt-repository">> {
  if (op.suite !== "auto" && op.architecture !== "auto" && !op.uri.includes("{distribution}")) return op;
  const release = (await requireSuccess(runner, "cat", ["/etc/os-release"])).stdout;
  const fields = new Map([...release.matchAll(/^([A-Z_]+)=["']?([a-z0-9._-]+)["']?$/gm)].map(match => [match[1], match[2]]));
  const distribution = fields.get("ID");
  const suite = fields.get("UBUNTU_CODENAME") ?? fields.get("VERSION_CODENAME");
  if (!distribution || !["ubuntu", "debian"].includes(distribution) || !suite || !/^[a-z][a-z0-9-]*$/.test(suite)) throw new Error("Automatic APT repository setup requires Ubuntu or Debian with a valid codename");
  const architecture = op.architecture === "auto" ? (await requireSuccess(runner, "dpkg", ["--print-architecture"])).stdout.trim() : op.architecture;
  if (!/^[a-z0-9]+$/.test(architecture)) throw new Error("Invalid APT architecture");
  return { ...op, uri: op.uri.replace("{distribution}", distribution), keyUrl: op.keyUrl.replace("{distribution}", distribution), suite: op.suite === "auto" ? suite : op.suite, architecture };
}

/** Inspect the copy-file backend without mutation. */
async function inspectCopy(op: Op<"copy-file">): Promise<Inspection> {
      const stats = await lstat(op.target).catch(error => { if (isMissingFile(error)) return undefined; throw error; });
      if (!stats) return observed(false);
      if (stats.isSymbolicLink() && op.migrateSymlink) return observed(false, true);
      if (!stats.isFile()) throw new Error(`Refusing non-regular copy target: ${op.target}`);
      return observed(op.seed === true || ((await readFile(op.target)).equals(copyBytes(op)) && (stats.mode & 0o777) === (op.mode ?? 0o644)), true);
}

/** Inspect the brew-tap backend without mutation. */
async function inspectTap(op: Op<"brew-tap">, runner: Runner): Promise<Inspection> {
      const taps = await requireSuccess(runner, "brew", ["tap"]);
      const present = taps.stdout.split(/\s+/).includes(op.tap);
      if (!present) return observed(false);
      if (op.url) {
        const result = await requireSuccess(runner, "brew", ["--repository", op.tap]);
        const remote = await requireSuccess(runner, "git", ["-C", result.stdout.trim(), "remote", "get-url", "origin"]);
        if (remote.stdout.trim().replace(/\.git$/, "") !== op.url.replace(/\.git$/, "")) throw new Error(`Tap ${op.tap} has an unexpected origin`);
      }
      if (!op.trust) return observed(true);
      const result = await requireSuccess(runner, "brew", ["tap-info", "--json", op.tap]);
      const info: unknown = JSON.parse(result.stdout);
      const entry: unknown = Array.isArray(info) && info.length === 1 ? info[0] : undefined;
      if (typeof entry !== "object" || entry === null || !("name" in entry) || entry.name !== op.tap || !("trusted" in entry) || typeof entry.trusted !== "boolean") {
        throw new Error(`Homebrew did not report trust status for ${op.tap}`);
      }
      return observed(entry.trusted, true);
}

/** Inspect the apt-repository backend without mutation. */
async function inspectAptRepository(op: Op<"apt-repository">, runner: Runner): Promise<Inspection> {
      await checkConflicts(op, runner);
      const source = await optionalRead(`/etc/apt/sources.list.d/${op.name}.sources`);
      const key = await optionalRead(`/etc/apt/keyrings/${op.name}.asc`);
      return observed(source?.toString() === aptSource(op) && key !== undefined && digest(key) === op.keySha256.toLowerCase(), source !== undefined);
}

/** Inspect the macos-default backend without mutation. */
async function inspectPreference(op: Op<"macos-default">, runner: Runner): Promise<Inspection> {
      const result = await runner.run("defaults", ["read", op.domain, op.key]);
      if (result.exitCode !== 0) {
        if (!/does not exist|not found/i.test(result.stderr)) throw new Error(`Cannot read preference: ${result.stderr}`);
        return observed(false);
      }
      return observed(result.stdout.trim() === String(typeof op.value === "boolean" ? Number(op.value) : op.value), true);
}

/** Inspect the macos-installer backend without mutation. */
async function inspectMacPackage(op: Op<"macos-installer">, runner: Runner): Promise<Inspection> {
      if (!await exists(op.installedPath)) return observed(false);
      if (!op.version) return observed(true);
      const result = await requireSuccess(runner, "defaults", ["read", join(op.installedPath, "Contents/Info"), "CFBundleShortVersionString"]);
      return { ...observed(result.stdout.trim() === op.version, true), installedVersion: result.stdout.trim() };
}

/** Inspect the check backend without mutation. */
async function inspectCheck(op: Op<"check">, runner: Runner): Promise<Inspection> {
      if (op.requiresFile && !await exists(op.requiresFile)) return { ...observed(true), installedVersion: "prerequisite absent" };
      return observed((await run(runner, op.check)).exitCode === 0, true);
}

/** Install the declared tap and its explicit trust setting. */
async function installTap(op: Op<"brew-tap">, runner: Runner): Promise<void> {
  await requireSuccess(runner, "brew", ["tap", op.tap, ...(op.url ? [op.url] : [])], { streamOutput: true });
  if (op.trust) await requireSuccess(runner, "brew", ["trust", op.tap], { streamOutput: true });
}
/** Write the correct native preference type. */
async function installPreference(op: Op<"macos-default">, runner: Runner): Promise<void> {
  const type = typeof op.value === "boolean" ? "-bool" : typeof op.value === "number" ? "-int" : "-string";
  await requireSuccess(runner, "defaults", ["write", op.domain, op.key, type, String(op.value)]);
}
/** Run the declared repair only after its initialization prerequisite exists. */
async function repairCheck(op: Op<"check">, runner: Runner): Promise<void> {
  if (op.requiresFile && !await exists(op.requiresFile)) return;
  for (const spec of op.repair) await requireSuccess(runner, spec.command, spec.args ?? [], { ...commandOptions(spec), streamOutput: true });
}
