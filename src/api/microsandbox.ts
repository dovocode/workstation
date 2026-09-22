import { validateVmCapacity } from "../microvm/validation.js";
import { createHash } from "node:crypto";
import { join, isAbsolute } from "node:path";
import { validateArtifact, type FirecrackerVmOptions } from "../firecracker/options.js";
import { provision } from "./provision.js";
import { task } from "./tasks.js";
import type { ConfigFactory, TaskDefinition } from "./types.js";
import { microsandboxManager } from "../microvm/microsandbox.js";

/** OCI input and local tool paths for managed Microsandbox 0.7.1. */
export interface MicrosandboxBackendOptions {
  /** Fully qualified OCI image pinned with @sha256:DIGEST. */
  readonly image: string;
  /** Microsandbox executable; defaults to msb on PATH. */
  readonly cli?: string;
  /** Python 3 interpreter used for the lifecycle adapter (standard library only). */
  readonly python?: string;
}

/** Persistent Microsandbox declaration sharing Firecracker's guest provisioning contract. */
export type MicrosandboxVmOptions = MicrosandboxBackendOptions & Pick<FirecrackerVmOptions, "architecture" | "cpus" | "memoryMiB" | "guest">;

/** Reject executable arguments that could be interpreted as flags or multiline input. */
function validateExecutables(executables: readonly string[]): void {
  for (const executable of executables) {
    if (!executable || executable.startsWith("-") || /[\0\r\n]/.test(executable)) throw new Error("Invalid Microsandbox executable");
  }
}

/** Validate shared limits and guest artifacts before constructing local runtime commands. */
function validate(name: string, options: MicrosandboxVmOptions): void {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(name)) throw new Error("Invalid microVM name");
  if (!["x86_64", "aarch64"].includes(options.architecture)) throw new Error("Invalid microVM architecture");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*\/[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}$/.test(options.image)) throw new Error("Managed Microsandbox requires a fully qualified, digest-pinned OCI image");
  validateVmCapacity("microVM", [["cpus", options.cpus ?? 2, 32], ["memoryMiB", options.memoryMiB ?? 1024, 1048576]]);
  validateExecutables([options.cli ?? "msb", options.python ?? "python3"]);
  validateArtifact(options.guest.workstation);
  if (!options.guest.config.trim() || options.guest.config.includes("\0")) throw new Error("MicroVM guest config is required");
}

/** Compose retained provisioning and matching lifecycle tasks for a local Microsandbox VM. */
export function managedMicrosandbox(name: string, options: MicrosandboxVmOptions): ConfigFactory {
  validate(name, options);
  return context => {
    const owner = createHash("sha256").update(`${context.configDir}\0${context.machine}\0${name}`).digest("hex");
    /** Resolve explicit tool paths against the configuration; bare executable names use PATH. */
    const executable = (value: string) => value.startsWith("~/") ? join(context.home, value.slice(2)) : value.includes("/") && !isAbsolute(value) ? join(context.configDir, value) : value;
    const desired = { name, owner, image: options.image, architecture: options.architecture, cpus: options.cpus ?? 2, memoryMiB: options.memoryMiB ?? 1024, guest: options.guest };
    const fingerprint = createHash("sha256").update(JSON.stringify(desired)).update(microsandboxManager).digest("hex");
    const payload = JSON.stringify({ ...desired, fingerprint, cli: executable(options.cli ?? "msb"), lock: join(context.home, ".local/state/workstation/microvm-locks", `microsandbox-${name}.lock`) });
    /** Build one operation without starting a runtime while evaluating the config. */
    const operation = (action: string) => task(executable(options.python ?? "python3"), ["-c", microsandboxManager, payload, action], { description: `Microsandbox ${name}: ${action}` });
    const tasks: Record<string, TaskDefinition> = {};
    for (const action of ["up", "stop", "status", "provision", "exec", "destroy"]) tasks[`${name}:${action}`] = operation(action);
    return { resources: [provision(`microsandbox-${name}`, { type: "check", check: operation("check"), repair: [operation("up")] })], tasks };
  };
}
