import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { renderSystemdService } from "../rendering/systemd.js";
import type { SystemdServiceResource, Runner } from "../api/types.js";
import { atomicWrite, isMissingFile, requireSuccess, type Inspection } from "./shared.js";

/** Compare the on-disk unit contents with the rendered declaration. */
export async function inspectSystemdService(resource: SystemdServiceResource, runner?: Runner): Promise<Inspection> {
  const path = systemdServicePath(resource);
  try {
    const current = await readFile(path, "utf8");
    let matches = current === renderSystemdService(resource);
    const contentMatches = matches;
    if (matches && runner) {
      const scope = resource.scope === "user" ? ["--user"] : [];
      const active = await runner.run("systemctl", [...scope, "is-active", "--quiet", resource.name]);
      const enabled = await runner.run("systemctl", [...scope, "is-enabled", resource.name]);
      if (![0, 3, 4].includes(active.exitCode) || ![0, 1, 3, 4].includes(enabled.exitCode)) throw new Error(`Cannot inspect systemd service ${resource.name}`);
      matches = active.exitCode === 0 && enabled.exitCode === 0;
    }
    return {
      present: true,
      matches,
      ...(contentMatches ? {} : { conflict: `${path} exists with different content` }),
    };
  } catch (error) {
    if (isMissingFile(error)) return { present: false, matches: false };
    throw error;
  }
}

/** Write a missing unit, reload systemd, and enable and start the service. */
export async function installSystemdService(resource: SystemdServiceResource, runner: Runner): Promise<void> {
  const inspection = await inspectSystemdService(resource);
  if (inspection.present && !inspection.matches) throw new Error(inspection.conflict);
  if (!inspection.present) await writeSystemdService(resource, runner);
  await systemctl(resource, runner, ["daemon-reload"]);
  await systemctl(resource, runner, ["enable", "--now", resource.name]);
}

/** Disable and stop an unchanged managed unit, remove it, and reload systemd. */
export async function removeSystemdService(resource: SystemdServiceResource, runner: Runner): Promise<void> {
  const inspection = await inspectSystemdService(resource);
  if (!inspection.present) return;
  if (!inspection.matches) {
    throw new Error(`Refusing to remove changed systemd service: ${inspection.conflict}`);
  }
  await systemctl(resource, runner, ["disable", "--now", resource.name]);
  const path = systemdServicePath(resource);
  if (resource.scope === "system") {
    await requireSuccess(runner, "sudo", ["rm", "--", path]);
  } else {
    await unlink(path);
  }
  await systemctl(resource, runner, ["daemon-reload"]);
}

/** Write a user unit atomically or install a system unit with sudo. */
async function writeSystemdService(resource: SystemdServiceResource, runner: Runner): Promise<void> {
  const path = systemdServicePath(resource);
  const content = renderSystemdService(resource);
  if (resource.scope === "user") {
    await mkdir(dirname(path), { recursive: true });
    await atomicWrite(path, content, 0o644);
    return;
  }
  const temporary = resolve(tmpdir(), `workstation-${process.pid}-${resource.name}`);
  await writeFile(temporary, content, { mode: 0o600 });
  try {
    await requireSuccess(runner, "sudo", ["install", "-m", "0644", temporary, path]);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

/** Run systemctl in user scope or through sudo for system scope. */
async function systemctl(
  resource: SystemdServiceResource,
  runner: Runner,
  args: readonly string[],
): Promise<void> {
  if (resource.scope === "system") {
    await requireSuccess(runner, "sudo", ["systemctl", ...args]);
  } else {
    await requireSuccess(runner, "systemctl", ["--user", ...args]);
  }
}

/** Resolve a user or system unit path according to the declared scope. */
function systemdServicePath(resource: SystemdServiceResource): string {
  if (resource.scope === "system") return resolve("/etc/systemd/system", resource.name);
  const home = process.env.HOME;
  if (!home) throw new Error("HOME is required to manage user systemd services");
  return resolve(home, ".config", "systemd", "user", resource.name);
}
