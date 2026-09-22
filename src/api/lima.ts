import { validateVmCapacity } from "../microvm/validation.js";
import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { provision } from "./provision.js";
import { task } from "./tasks.js";
import type { ConfigFactory, TaskDefinition } from "./types.js";
import { limaManager } from "../lima/manager.js";
import { renderStorage, storageLayout, validateStorage, type LimaStorageOptions } from "../lima/storage.js";

/** A dedicated macOS VZ VM with one persistent, externally located raw data disk. */
export interface LimaVmOptions {
  readonly image: { readonly url: string; readonly sha256: string; readonly architecture: "aarch64" | "x86_64" };
  readonly cpus?: number;
  readonly memoryGiB?: number;
  readonly bootDiskGiB?: number;
  readonly dataDisk: { readonly path: string; readonly sizeGiB: number; readonly storage?: LimaStorageOptions };
  /** Root Bash script called with check|setup, /dev/vdb, and data disk bytes.
   * Check must be read-only. Setup must preserve existing data and be idempotent.
   */
  readonly guestScript?: string;
  /** Host resources that must converge before VM creation. */
  readonly dependsOn?: readonly string[];
  readonly cli?: string;
  readonly python?: string;
}

/** Reject invalid image, capacity and guest setup declarations before constructing tasks. */
function validate(name: string, options: LimaVmOptions): void {
  if (!/^[a-z][a-z0-9-]{0,29}$/.test(name)) throw new Error("Invalid Lima VM name");
  const url = new URL(options.image.url);
  if (url.protocol !== "https:" || url.username || url.password || !/^[a-f0-9]{64}$/.test(options.image.sha256)) throw new Error("Lima image requires HTTPS and SHA-256");
  if (!["aarch64", "x86_64"].includes(options.image.architecture)) throw new Error("Invalid Lima architecture");
  validateVmCapacity("Lima", [["cpus", options.cpus ?? 4, 64], ["memoryGiB", options.memoryGiB ?? 8, 1024], ["bootDiskGiB", options.bootDiskGiB ?? 32, 65536], ["dataDisk.sizeGiB", options.dataDisk.sizeGiB, 65536]]);
  if (!isAbsolute(options.dataDisk.path) || /[\0\r\n]/.test(options.dataDisk.path)) throw new Error("Lima data disk needs an absolute path");
  if (options.guestScript !== undefined && (!options.guestScript.trim() || options.guestScript.includes("\0"))) throw new Error("Invalid Lima guest script");
  if (!options.dataDisk.storage && !options.guestScript) throw new Error("Lima requires storage settings or a guest script");
  if (options.dataDisk.storage) validateStorage(options.dataDisk.storage, options.dataDisk.sizeGiB);
}

/** Managed Lima virtual machines. Requires Lima 2+, Python 3 and macOS. */
export const lima = {
  /** VM, boot disk and data disk are retained when removed from configuration.
   * Image/hardware changes are rejected; stop and migrate explicitly instead.
   */
  vm(name: string, options: LimaVmOptions): ConfigFactory {
    validate(name, options);
    const scripts = [options.dataDisk.storage ? renderStorage(options.dataDisk.storage, options.dataDisk.sizeGiB) : undefined, options.guestScript].filter((script): script is string => script !== undefined);
    const guest = scripts.length === 1 ? scripts[0]! : "set -e\n" + scripts.map(script => `(\n${script}\n)`).join("\n");
    return context => {
      if (context.platform !== "darwin") throw new Error("Lima VZ requires macOS");
      const diskName = `ws-${name}`;
      const config = {
        vmType: "vz", plain: true, arch: options.image.architecture, cpus: options.cpus ?? 4,
        memory: `${options.memoryGiB ?? 8}GiB`, disk: `${options.bootDiskGiB ?? 32}GiB`,
        images: [{ location: options.image.url, arch: options.image.architecture, digest: `sha256:${options.image.sha256}` }],
        mounts: [], containerd: { user: false, system: false },
        additionalDisks: [{ name: diskName, format: false }],
      };
      const owner = createHash("sha256").update(`${context.configDir}\0${context.machine}\0${name}`).digest("hex");
      const payload = JSON.stringify({ name, diskName, config, owner, path: options.dataDisk.path,
        bytes: options.dataDisk.sizeGiB * 1024 ** 3, guest, storage: storageLayout(options.dataDisk.storage, options.dataDisk.sizeGiB),
        cli: options.cli ?? "limactl", limaHome: join(context.home, ".lima"),
        state: join(context.home, ".local/state/workstation/lima", name) });
      const tasks: Record<string, TaskDefinition> = {};
      for (const action of ["up", "stop", "status", "exec", "provision"]) {
        tasks[`${name}:${action}`] = task(options.python ?? "python3", ["-c", limaManager, payload, action], { description: `Lima ${name}: ${action}` });
      }
      return { resources: [provision(`lima-${name}`, { type: "check",
        check: task(options.python ?? "python3", ["-c", limaManager, payload, "check"]),
        repair: [tasks[`${name}:up`]!],
      }, options.dependsOn)], tasks };
    };
  },
};
