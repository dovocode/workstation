import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fingerprint, resourceId } from "../config/identity.js";
import { isFlatpakOptions, isPackageName } from "../config/package-options.js";
import type { ResolvedResource, StateEntry, WorkstationState } from "../api/types.js";

/** Load validated ownership state; return empty state for a missing file and reject machine mismatches. */
export async function readState(path: string, machine: string): Promise<WorkstationState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isState(parsed)) {
      throw new Error(`Unsupported or invalid state file: ${path}`);
    }
    if (parsed.machine !== machine) {
      throw new Error(
        `State belongs to machine ${parsed.machine}, but configuration selected ${machine}`,
      );
    }
    return parsed;
  } catch (error) {
    if (isMissingFile(error)) {
      return { version: 1, machine, resources: {} };
    }
    throw error;
  }
}

/** Checkpoint ownership and backups atomically after a successful reconciliation step. */
export async function writeState(path: string, state: WorkstationState): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

/** Recognize ENOENT without swallowing permission or other filesystem failures. */
function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Validate the state schema and each resource's identity and fingerprint. */
function isState(value: unknown): value is WorkstationState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    typeof candidate.machine !== "string" ||
    typeof candidate.resources !== "object" ||
    candidate.resources === null ||
    Array.isArray(candidate.resources)
  ) {
    return false;
  }
  return Object.entries(candidate.resources).every(([id, entry]) => isStateEntry(id, entry));
}

/** Check ownership metadata and verify that the resource matches its stored ID and fingerprint. */
function isStateEntry(key: string, value: unknown): value is StateEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.id !== key ||
    typeof candidate.fingerprint !== "string" ||
    typeof candidate.owned !== "boolean" ||
    (candidate.installedVersion !== undefined && typeof candidate.installedVersion !== "string") ||
    (candidate.installedHash !== undefined && typeof candidate.installedHash !== "string") ||
    (candidate.originalFile !== undefined && !isOriginalFile(candidate.originalFile)) ||
    !isResolvedResource(candidate.resource)
  ) {
    return false;
  }
  return resourceId(candidate.resource) === key && fingerprint(candidate.resource) === candidate.fingerprint;
}

/** Validate the resource payload stored in local ownership state. */
function isResolvedResource(value: unknown): value is ResolvedResource {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  switch (candidate.kind) {
    case "package":
      return (
        ["mise", "brew", "brew-cask", "apt", "dnf", "yum", "pacman", "flatpak", "mas"].includes(String(candidate.manager)) &&
        isPackageName(candidate.manager, candidate.name) &&
        (candidate.flatpak === undefined || (candidate.manager === "flatpak" && isFlatpakOptions(candidate.flatpak))) &&
        (candidate.manager !== "mas" || candidate.lockedVersion === undefined) &&
        (candidate.version === undefined || typeof candidate.version === "string") &&
        (candidate.lockedVersion === undefined || typeof candidate.lockedVersion === "string") &&
        (candidate.upgrade === undefined ||
          (candidate.manager === "brew-cask" && isBrewCaskUpgradeOptions(candidate.upgrade)))
      );
    case "symlink":
      return typeof candidate.source === "string" && typeof candidate.target === "string";
    case "launch-agent":
      return (
        typeof candidate.label === "string" &&
        typeof candidate.program === "string" &&
        (candidate.args === undefined ||
          (Array.isArray(candidate.args) &&
            candidate.args.every((argument) => typeof argument === "string")))
      );
    case "generated-file":
      return (
        typeof candidate.target === "string" &&
        ["toml", "yaml", "json", "jsonc", "zsh", "bash"].includes(String(candidate.format)) &&
        ["update", "overwrite", "ignore"].includes(String(candidate.ifExists)) &&
        isConfigValue(candidate.value) &&
        (candidate.renderedContent === undefined ||
          (candidate.format === "jsonc" && typeof candidate.renderedContent === "string")) &&
        (candidate.mode === undefined ||
          (typeof candidate.mode === "number" &&
            Number.isInteger(candidate.mode) &&
            candidate.mode >= 0 &&
            candidate.mode <= 0o777))
      );
    case "custom-tool":
      return (
        typeof candidate.name === "string" &&
        typeof candidate.source === "string" &&
        typeof candidate.sourceHash === "string" &&
        typeof candidate.target === "string" &&
        isCommandSpec(candidate.build)
      );
    case "systemd-service":
      return (
        typeof candidate.name === "string" &&
        typeof candidate.program === "string" &&
        ["user", "system"].includes(String(candidate.scope)) &&
        (candidate.args === undefined ||
          (Array.isArray(candidate.args) &&
            candidate.args.every((argument) => typeof argument === "string"))) &&
        (candidate.environment === undefined || isStringRecord(candidate.environment))
      );
    default:
      return false;
  }
}

/** Validate a saved regular-file or symlink backup before restoration. */
function isOriginalFile(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "symlink") return typeof candidate.target === "string";
  return candidate.kind === "file" &&
    typeof candidate.content === "string" &&
    typeof candidate.mode === "number" &&
    Number.isInteger(candidate.mode) &&
    candidate.mode >= 0 &&
    candidate.mode <= 0o777;
}

/** Check that a value consists only of supported finite JSON-like data. */
function isConfigValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isConfigValue);
  return typeof value === "object" && value !== null && Object.values(value).every(isConfigValue);
}

/** Check that an object contains only string values. */
function isStringRecord(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

/** Validate a direct command declaration, arguments, working directory, and environment. */
function isCommandSpec(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.command === "string" &&
    (candidate.args === undefined ||
      (Array.isArray(candidate.args) && candidate.args.every((item) => typeof item === "string"))) &&
    (candidate.cwd === undefined || typeof candidate.cwd === "string") &&
    (candidate.environment === undefined || isStringRecord(candidate.environment))
  );
}

/** Validate the supported Homebrew upgrade option fields. */
function isBrewCaskUpgradeOptions(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const options = value as Record<string, unknown>;
  return (
    Object.keys(options).every((key) => key === "greedy" || key === "force") &&
    (options.greedy === undefined || typeof options.greedy === "boolean") &&
    (options.force === undefined || typeof options.force === "boolean")
  );
}
