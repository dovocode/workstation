import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse, stringify, type TomlTableWithoutBigInt } from "smol-toml";
import { fingerprint, resourceId } from "../config/identity.js";
import { resolvePackageVersion } from "../resources/package-version.js";
import type {
  Platform,
  ResolvedConfig,
  ResolvedResource,
  Runner,
} from "../api/types.js";

const LOCK_VERSION = 1;

interface LockEntry {
  readonly id: string;
  readonly fingerprint: string;
  readonly lockedVersion?: string;
}

interface LockTarget {
  readonly machine: string;
  readonly platform: Platform;
  readonly resources: readonly LockEntry[];
}

interface WorkstationLock {
  readonly version: 1;
  readonly targets: readonly LockTarget[];
}

export interface LockedConfigResult {
  readonly config: ResolvedConfig;
  readonly path: string;
  readonly changed: boolean;
}

/** Return the workstation.lock path beside the TypeScript entry point. */
export function lockPath(configPath: string): string {
  return resolve(dirname(configPath), "workstation.lock");
}

/** Resolve package pins and update the current machine's lock target; does not install resources. */
export async function lockConfig(
  configPath: string,
  config: ResolvedConfig,
  runner: Runner,
): Promise<LockedConfigResult> {
  const path = lockPath(configPath);
  const previousText = await readOptional(path);
  const previous = previousText === undefined ? emptyLock() : parseLock(previousText, path);
  const target = previous.targets.find(({ machine }) => machine === config.context.machine);
  const existing = new Map(target?.resources.map((entry) => [entry.id, entry]));
  const resources: ResolvedResource[] = [];
  const entries: LockEntry[] = [];

  for (const resource of config.resources) {
    const id = resourceId(resource);
    const declarationFingerprint = fingerprint(resource);
    const prior = existing.get(id);
    const refreshesOnRun =
      resource.kind === "package" &&
      resource.manager === "brew-cask" &&
      resource.upgrade?.greedy === true;
    const canReuse =
      !refreshesOnRun &&
      prior?.fingerprint === declarationFingerprint &&
      (resource.kind !== "package" || prior.lockedVersion !== undefined);
    const lockedVersion =
      canReuse
        ? prior.lockedVersion
        : await resolvePackageVersion(resource, runner);
    resources.push(withLockedVersion(resource, lockedVersion));
    entries.push({
      id,
      fingerprint: declarationFingerprint,
      ...(lockedVersion ? { lockedVersion } : {}),
    });
  }

  const nextTarget: LockTarget = {
    machine: config.context.machine,
    platform: config.context.platform,
    resources: entries.sort((left, right) => left.id.localeCompare(right.id)),
  };
  const next: WorkstationLock = {
    version: LOCK_VERSION,
    targets: [
      ...previous.targets.filter(({ machine }) => machine !== config.context.machine),
      nextTarget,
    ].sort((left, right) => left.machine.localeCompare(right.machine)),
  };
  const nextText = stringifyLock(next);
  const changed = previousText !== nextText;
  if (changed) await atomicWrite(path, nextText);

  return { config: { ...config, resources }, path, changed };
}

/** Attach a resolved package pin without changing non-package resources. */
function withLockedVersion(
  resource: ResolvedResource,
  lockedVersion: string | undefined,
): ResolvedResource {
  if (resource.kind !== "package" || lockedVersion === undefined) return resource;
  return { ...resource, lockedVersion };
}

/** Create an empty lock document using the current schema version. */
function emptyLock(): WorkstationLock {
  return { version: LOCK_VERSION, targets: [] };
}

/** Serialize machine targets and package pins to the committed TOML format. */
function stringifyLock(lock: WorkstationLock): string {
  return stringify({
    version: lock.version,
    targets: lock.targets.map((target) => ({
      machine: target.machine,
      platform: target.platform,
      resources: target.resources.map((entry) => ({
        id: entry.id,
        fingerprint: entry.fingerprint,
        ...(entry.lockedVersion ? { locked_version: entry.lockedVersion } : {}),
      })),
    })),
  });
}

/** Validate lock schema, platform names, and duplicate machine/resource identities. */
function parseLock(text: string, path: string): WorkstationLock {
  const document = parse(text);
  if (document.version !== LOCK_VERSION) {
    throw new Error(`Unsupported workstation lock version in ${path}`);
  }
  if (!Array.isArray(document.targets)) throw new Error(`Lock targets must be an array in ${path}`);
  const machines = new Set<string>();
  const targets = document.targets.map((value, targetIndex): LockTarget => {
    const target = requireTable(value, `targets[${targetIndex}]`);
    const machine = requireString(target.machine, `targets[${targetIndex}].machine`);
    if (machines.has(machine)) throw new Error(`Duplicate machine ${machine} in ${path}`);
    machines.add(machine);
    const platform = requireString(target.platform, `targets[${targetIndex}].platform`);
    if (platform !== "darwin" && platform !== "linux") {
      throw new Error(`Invalid platform for ${machine} in ${path}`);
    }
    if (!Array.isArray(target.resources)) {
      throw new Error(`Lock resources for ${machine} must be an array in ${path}`);
    }
    const ids = new Set<string>();
    const resources = target.resources.map((value, resourceIndex): LockEntry => {
      const entry = requireTable(value, `targets[${targetIndex}].resources[${resourceIndex}]`);
      const id = requireString(entry.id, "lock resource id");
      if (ids.has(id)) throw new Error(`Duplicate resource ${id} for ${machine} in ${path}`);
      ids.add(id);
      return {
        id,
        fingerprint: requireString(entry.fingerprint, `lock fingerprint for ${id}`),
        ...(entry.locked_version === undefined
          ? {}
          : { lockedVersion: requireString(entry.locked_version, `locked version for ${id}`) }),
      };
    });
    return { machine, platform, resources };
  });
  return { version: LOCK_VERSION, targets };
}

/** Require an object-shaped TOML table and identify the invalid field on failure. */
function requireTable(value: unknown, field: string): TomlTableWithoutBigInt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be a table`);
  }
  return value as TomlTableWithoutBigInt;
}

/** Require a non-empty string at a serialized-data boundary. */
function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} must be a string`);
  return value;
}

/** Read a lock file, treating only a missing path as an absent lock. */
async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/** Write a temporary sibling and rename it into place to avoid partial destination content. */
async function atomicWrite(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o644 });
  await rename(temporary, path);
}
