import type { CommandSpec } from "./types.js";

/** Native setup operations. Removed declarations are retained on the machine, never implicitly uninstalled. */
export type ProvisionOperation =
  | { readonly type: "brew-tap"; readonly tap: string; readonly url?: string; readonly trust?: boolean }
  | { readonly type: "apt-repository"; readonly name: string; readonly uri: string; readonly suite: string; readonly components: readonly string[]; readonly architecture: string; readonly keyUrl: string; readonly keySha256: string; readonly conflicts?: readonly string[] }
  | { readonly type: "copy-file"; readonly source: string; readonly target: string; readonly mode?: number; readonly seed?: boolean; readonly migrateSymlink?: boolean; readonly privileged?: boolean; readonly content?: string }
  | { readonly type: "macos-default"; readonly domain: string; readonly key: string; readonly value: boolean | string | number }
  | { readonly type: "macos-installer"; readonly url: string; readonly teamId: string; readonly installedPath: string; readonly version?: string; readonly sha256?: string }
  | { readonly type: "linger"; readonly user: string }
  | { readonly type: "group-member"; readonly user: string; readonly group: string }
  | { readonly type: "service"; readonly manager: "systemd" | "launchd"; readonly scope: "user" | "system"; readonly name: string; readonly plist?: string; readonly optionalSession?: boolean }
  | { readonly type: "check"; readonly check: CommandSpec; readonly repair: readonly CommandSpec[]; readonly requiresFile?: string; readonly restartOnChange?: boolean };

/** A verified, retained setup resource. Checks run on every reconciliation; repair runs only when needed. */
export interface ProvisionResource {
  readonly kind: "provision";
  readonly name: string;
  readonly operation: ProvisionOperation;
  /** Resource IDs that must converge before this operation. */
  readonly dependsOn?: readonly string[];
}

/** Declare a native setup operation; commands are always passed as literal argument vectors. */
export function provision(name: string, operation: ProvisionOperation, dependsOn: readonly string[] = []): ProvisionResource {
  return { kind: "provision", name, operation, ...(dependsOn.length ? { dependsOn } : {}) };
}
