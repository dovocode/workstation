import type { FlatpakOptions } from "../api/types.js";

/** Validate Flatpak installation options at configuration, manifest and state boundaries. */
export function isFlatpakOptions(value: unknown): value is FlatpakOptions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const options = value as Record<string, unknown>;
  return Object.keys(options).every((key) => ["scope", "remote", "branch"].includes(key)) &&
    (options.scope === undefined || options.scope === "user" || options.scope === "system") &&
    [options.remote, options.branch].every((field) => field === undefined ||
      (typeof field === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(field)));
}

/** Require exact app/package identifiers for backends which must not perform fuzzy matching. */
export function isPackageName(manager: unknown, name: unknown): name is string {
  if (typeof name !== "string" || name.length === 0) return false;
  if (manager === "mas") return /^[1-9]\d*$/.test(name);
  if (manager === "flatpak") return /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*){2,}$/.test(name);
  if (manager === "pacman") return /^[A-Za-z0-9@_+][A-Za-z0-9@._+-]*$/.test(name);
  return true;
}
