import type { PackageManager } from "../api/types.js";

/** Supported Workstation behavior, not guarantees about remote repository availability. */
export interface PackageCapabilities {
  readonly commands: readonly string[];
  readonly pins: "exact" | "available-version" | "commit" | "none";
  readonly bootstrap: boolean;
  readonly recovery: string;
}

/** Central capability descriptions for every concrete package backend. */
export const packageCapabilities: Readonly<Record<Exclude<PackageManager, "system">, PackageCapabilities>> = {
  mise: { commands: ["mise"], pins: "exact", bootstrap: true, recovery: "Rollback supports existing exactly pinned mise updates when the old version remains installed or downloadable." },
  brew: { commands: ["brew"], pins: "available-version", bootstrap: true, recovery: "Locked version must match available tap metadata; arbitrary downgrade is not supported." },
  "brew-cask": { commands: ["brew"], pins: "available-version", bootstrap: true, recovery: "Version availability and cask artifacts constrain recovery; automatic rollback is not implemented." },
  apt: { commands: ["apt-get", "apt-cache", "dpkg-query", "sudo"], pins: "exact", bootstrap: false, recovery: "Exact versions must still exist in configured repositories; automatic rollback is not implemented." },
  dnf: { commands: ["dnf", "rpm", "sudo"], pins: "exact", bootstrap: false, recovery: "Backend supports downgrade to available RPM versions; automatic snapshot rollback is not implemented." },
  yum: { commands: ["yum", "rpm", "sudo"], pins: "exact", bootstrap: false, recovery: "Backend supports downgrade to available RPM versions; automatic snapshot rollback is not implemented." },
  pacman: { commands: ["pacman", "sudo"], pins: "available-version", bootstrap: false, recovery: "Repository version must match the lock; historical package archive rollback is not implemented." },
  flatpak: { commands: ["flatpak"], pins: "commit", bootstrap: false, recovery: "Locked commit must remain available from the selected remote; automatic rollback is not implemented." },
  mas: { commands: ["mas"], pins: "none", bootstrap: false, recovery: "Follows available App Store updates; requires account access and acquired apps." },
};
