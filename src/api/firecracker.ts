import { validateVmCapacity } from "../microvm/validation.js";
import { createHash } from "node:crypto";
import { provision } from "./provision.js";
import type { CommandSpec, ConfigFactory, TaskDefinition } from "./types.js";
import { renderMicrovm } from "../firecracker/guest.js";
import { hostCommand, hostResources } from "../firecracker/host.js";

import { ipv4, validateArtifact, type FirecrackerVmOptions } from "../firecracker/options.js";
export type { FirecrackerArtifact, FirecrackerHost, FirecrackerVmOptions } from "../firecracker/options.js";

/** Validate the private network independently of artifacts and compute resources. */
function validateNetwork(subnet: string, dns: string): void {
  const [address, prefix, extra] = subnet.split("/");
  const octets = ipv4(address ?? "");
  const privateAddress = octets[0] === 10 || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) || (octets[0] === 192 && octets[1] === 168);
  if (prefix !== "30" || extra !== undefined || octets[3]! % 4 !== 0 || !privateAddress) throw new Error("Firecracker subnet must be an aligned private IPv4 /30");
  ipv4(dns);
}

/** Validate the full declaration before it becomes serialized provisioning commands. */
function validate(name: string, options: FirecrackerVmOptions): void {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(name)) throw new Error("Invalid Firecracker VM name");
  if (!["x86_64", "aarch64"].includes(options.architecture)) throw new Error("Invalid Firecracker architecture");
  for (const artifact of [options.kernel, options.rootfs, options.binary, options.guest.workstation]) validateArtifact(artifact);
  if (options.rootfs.member !== undefined || options.kernel.member !== undefined) throw new Error("Kernel and rootfs must be uncompressed files");
  validateVmCapacity("Firecracker", [["cpus", options.cpus ?? 2, 32], ["memoryMiB", options.memoryMiB ?? 1024, 1048576]]);
  validateNetwork(options.subnet, options.dns ?? "1.1.1.1");
  if (!options.guest.config.trim() || options.guest.config.includes("\0")) throw new Error("Firecracker guest config is required");
  if (options.macos && (!["lima", "orb"].includes(options.macos.provider) || !/^[a-z][a-z0-9-]{0,39}$/.test(options.macos.name ?? "workstation-firecracker"))) throw new Error("Invalid Firecracker macOS host");
}

/** Managed microVM configuration fragments. No runtime is started while evaluating configuration. */
export const firecracker = {
  /** Provision a persistent VM and expose NAME:up, :stop, :status, :provision, :exec and :destroy tasks.
   * Removing this fragment retains the VM and disk; invoke :destroy explicitly to delete them.
   */
  vm(name: string, options: FirecrackerVmOptions): ConfigFactory {
    validate(name, options);
    return context => {
      const owner = createHash("sha256").update(`${context.configDir}\0${context.machine}\0${name}`).digest("hex");
      const host = context.platform === "darwin" ? options.macos ?? { provider: "lima" as const } : undefined;
      const script = renderMicrovm(name, owner, options);
      /** Wrap one lifecycle action for the chosen execution host. */
      const command = (operation: string): CommandSpec => hostCommand(host, script, operation);
      const prerequisites = hostResources(host);
      const tasks: Record<string, TaskDefinition> = {};
      for (const operation of ["up", "stop", "status", "provision", "exec", "destroy"]) tasks[`${name}:${operation}`] = { ...command(operation), description: `Firecracker ${name}: ${operation}` };
      return {
        resources: [...prerequisites, provision(`firecracker-${name}`, { type: "check", check: command("check"), repair: [command("up")] }, prerequisites.map(resource => `provision:${resource.name}`))],
        tasks,
      };
    };
  },
};
