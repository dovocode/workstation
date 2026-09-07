import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse, stringify } from "smol-toml";
import { requireTable, requireString } from "./validation.js";
import { fingerprint, resourceId } from "../config/identity.js";
import { resolvePackageVersion } from "../resources/package-version.js";
import { mapConcurrent } from "../concurrency.js";
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

/** Control lock resolution independently from persistence and installation. */
export interface LockOptions {
  /** Reject missing or changed pins; never resolve replacements. Incompatible with refresh. */
  readonly frozen?: boolean;
  /** Set false for read-only planning; resolution may still issue package-manager queries. */
  readonly write?: boolean;
  /** Refresh all packages or selected resource IDs. Unknown selections fail before queries. */
  readonly refresh?: true | readonly string[];
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
  options: LockOptions = {},
): Promise<LockedConfigResult> {
  if (options.frozen && options.refresh) throw new Error("Cannot refresh a frozen lock");
  if (Array.isArray(options.refresh)) {
    const ids = new Set(config.resources.filter((resource) => resource.kind === "package").map(resourceId));
    for (const id of options.refresh) if (!ids.has(id)) throw new Error(`Unknown package resource selected for lock refresh: ${id}`);
  }
  const path = lockPath(configPath);
  const previousText = await readOptional(path);
  const previous = previousText === undefined ? emptyLock() : parseLock(previousText, path);
  const target = previous.targets.find(({ machine }) => machine === config.context.machine);
  const existing = new Map(target?.resources.map((entry) => [entry.id, entry]));
  const resolved = await mapConcurrent(config.resources, async (resource) => {
    const id = resourceId(resource);
    const declarationFingerprint = fingerprint(resource);
    const prior = existing.get(id);
    const canReuse = canReusePin(resource, prior, declarationFingerprint, options);
    const lockedVersion =
      canReuse
        ? prior.lockedVersion
        : options.frozen
          ? (() => { throw new Error(`Frozen lock cannot resolve ${id}; refresh the lock first`); })()
          : await resolvePackageVersion(resource, runner);
    return {
      resource: withLockedVersion(resource, lockedVersion), entry: {
        id,
        fingerprint: declarationFingerprint,
        ...(lockedVersion ? { lockedVersion } : {}),
      }
    };
  });
  const resources = resolved.map(({ resource }) => resource);
  const entries = resolved.map(({ entry }) => entry);

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
  if (changed && options.frozen) throw new Error("Frozen lock differs from the configuration");
  if (changed && options.write !== false) await atomicWrite(path, nextText);

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

/** Decide pin reuse separately from resolution so frozen and selective-refresh policies stay explicit. */
function canReusePin(resource: ResolvedResource, prior: LockEntry | undefined, declarationFingerprint: string, options: LockOptions): prior is LockEntry {
  if (prior?.fingerprint !== declarationFingerprint) return false;
  if (resource.kind !== "package") return true;
  if (options.refresh === true) return false;
  if (Array.isArray(options.refresh) && options.refresh.includes(resourceId(resource))) return false;
  if (resource.manager !== "mas" && prior.lockedVersion === undefined) return false;
  const refreshesOnRun = resource.manager === "brew-cask" && resource.upgrade?.greedy === true;
  return !refreshesOnRun || options.frozen === true || options.refresh !== undefined;
}
