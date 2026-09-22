import { firecracker, type FirecrackerVmOptions } from "./firecracker.js";
import { managedMicrosandbox, type MicrosandboxBackendOptions } from "./microsandbox.js";
import type { ConfigFactory } from "./types.js";

/** Common desired resources and guest setup for either microVM implementation. */
export type MicrovmSharedOptions = Pick<FirecrackerVmOptions, "architecture" | "cpus" | "memoryMiB" | "guest">;

/** Firecracker-specific artifacts, networking, and optional macOS execution host. */
export type MicrovmFirecrackerOptions = Omit<FirecrackerVmOptions, keyof MicrovmSharedOptions>;

/** Automatic selection needs both image definitions; explicit selection needs only its backend. */
export type MicrovmOptions = MicrovmSharedOptions & (
  | { readonly backend?: "auto"; readonly microsandbox: MicrosandboxBackendOptions; readonly firecracker: MicrovmFirecrackerOptions }
  | { readonly backend: "microsandbox"; readonly microsandbox: MicrosandboxBackendOptions; readonly firecracker?: never }
  | { readonly backend: "firecracker"; readonly firecracker: MicrovmFirecrackerOptions; readonly microsandbox?: never }
);

/** Platform mapper with stable task names and explicit backend-specific image inputs. */
export const microvm = {
  /** Reconcile using Microsandbox on macOS and Firecracker on Linux, unless explicitly selected.
   * Both backends expose NAME:up, :stop, :status, :provision, :exec, and :destroy.
   * Selection never migrates or deletes a VM belonging to the other backend.
   */
  vm(name: string, options: MicrovmOptions): ConfigFactory {
    if (!["auto", "microsandbox", "firecracker"].includes(options.backend ?? "auto")) throw new Error("Invalid microVM backend");
    return context => {
      const backend = options.backend === undefined || options.backend === "auto"
        ? context.platform === "darwin" ? "microsandbox" : "firecracker"
        : options.backend;
      const shared: MicrovmSharedOptions = {
        architecture: options.architecture,
        guest: options.guest,
        ...(options.cpus === undefined ? {} : { cpus: options.cpus }),
        ...(options.memoryMiB === undefined ? {} : { memoryMiB: options.memoryMiB }),
      };
      if (backend === "microsandbox") {
        if (!options.microsandbox) throw new Error("Selected microVM backend requires microsandbox options");
        return managedMicrosandbox(name, { ...options.microsandbox, ...shared })(context);
      }
      if (!options.firecracker) throw new Error("Selected microVM backend requires firecracker options");
      return firecracker.vm(name, { ...options.firecracker, ...shared })(context);
    };
  },
};
