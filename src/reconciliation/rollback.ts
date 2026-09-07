import { dirname, join, resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { readState } from "../persistence/state.js";
import { readManifest } from "../persistence/manifest.js";
import { inspectGeneratedFile } from "../resources/generated-file.js";
import { inspectResource } from "../resources/dispatch.js";
import { resolvePackageVersion } from "../resources/package-version.js";
import { createPlan } from "./plan.js";
import { applyPlan } from "./apply.js";
import type { Action, ResolvedConfig, ResolvedPackageResource, ResolvedResource, Runner, StateEntry } from "../api/types.js";

/** List snapshot identifiers within the selected configuration's state namespace. */
export async function listHistory(config: ResolvedConfig): Promise<string[]> {
  try {
    const entries = await readdir(join(dirname(config.stateFile), "history"), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && /^\d+-\d+$/.test(entry.name)).map((entry) => entry.name).sort().reverse();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

/** Preview or apply conservative rollback of previously managed generated-file updates. */
export async function rollback(config: ResolvedConfig, snapshot: string, runner: Runner, apply = false): Promise<Action[]> {
  if (!/^\d+-\d+$/.test(snapshot)) throw new Error("Invalid history identifier");
  const root = join(dirname(config.stateFile), "history", snapshot);
  const manifest = await readManifest(join(root, "desired.toml"));
  if (resolve(manifest.stateFile) !== resolve(config.stateFile) || manifest.context.machine !== config.context.machine) {
    throw new Error("Snapshot belongs to another configuration or machine");
  }
  const previous = await readState(join(root, "state.json"), config.context.machine);
  const current = await readState(config.stateFile, config.context.machine);
  const ids = new Set([...Object.keys(previous.resources), ...Object.keys(current.resources)]);
  const changed = new Set<string>();
  for (const id of ids) {
    const before = previous.resources[id];
    const after = current.resources[id];
    if (before?.fingerprint === after?.fingerprint) continue;
    changed.add(id);
    await validateResourceRollback(id, before, after, runner);
  }
  const target = { ...config, resources: Object.values(previous.resources).map((entry) => entry.resource) };
  /** Recheck state and file preconditions inside the apply guard before mutation. */
  const validate = async (actions: readonly Action[]): Promise<void> => {
    const latest = await readState(config.stateFile, config.context.machine);
    if (JSON.stringify(latest) !== JSON.stringify(current)) throw new Error("State changed during rollback planning; retry");
    for (const action of actions) {
      if (!changed.has(action.id) || action.type !== "update" || (action.resource.kind !== "generated-file" && !(action.resource.kind === "package" && action.resource.manager === "mise"))) throw new Error(`Rollback would affect unrelated or unsupported resource: ${action.id}`);
      const resource = current.resources[action.id]?.resource;
      if (!resource || !(await inspectResource(resource, runner)).matches) throw new Error(`Resource changed during rollback planning: ${action.id}`);
    }
  };
  if (apply) return applyPlan(target, runner, undefined, undefined, { noRemove: true, validate });
  const actions = await createPlan(target, runner);
  await validate(actions);
  return actions;
}

/** Validate the recovery policy for one changed resource before planning a rollback. */
async function validateResourceRollback(id: string, before: StateEntry | undefined, after: StateEntry | undefined, runner: Runner): Promise<void> {
  if (isMiseResource(before?.resource) && isMiseResource(after?.resource)) {
    await validatePackageRollback(id, before.resource, after.resource, runner);
    return;
  }
  if (!before || !after || before.resource.kind !== "generated-file" || after.resource.kind !== "generated-file") {
    throw new Error(`Rollback supports existing generated-file and exactly pinned mise updates; cannot roll back ${id}`);
  }
  if (before.resource.ifExists !== after.resource.ifExists) throw new Error(`Cannot roll back a file policy change: ${id}`);
  if (after.resource.ifExists === "inject" && JSON.stringify(before.resource.value) !== JSON.stringify(after.resource.value)) {
    throw new Error(`Injection rollback requires section-aware recovery, not yet supported: ${id}`);
  }
  if (!(await inspectGeneratedFile(after.resource)).matches) throw new Error(`Refusing to overwrite externally edited file: ${id}`);
}

/** Require exact available pins and reject external changes before package recovery. */
async function validatePackageRollback(id: string, before: ResolvedPackageResource, after: ResolvedPackageResource, runner: Runner): Promise<void> {
  if (!before.lockedVersion || !after.lockedVersion) throw new Error(`Package rollback requires exact recorded pins: ${id}`);
  if (!(await inspectResource(after, runner)).matches) throw new Error(`Package changed outside Workstation: ${id}`);
  if (!(await inspectResource(before, runner)).matches) {
    const available = await resolvePackageVersion({ ...before, version: before.lockedVersion }, runner);
    if (available !== before.lockedVersion) throw new Error(`Prior package pin is unavailable: ${id}@${before.lockedVersion}`);
  }
}

/** Recognize the only package backend supported by compensating rollback. */
function isMiseResource(resource: ResolvedResource | undefined): resource is ResolvedPackageResource {
  return resource?.kind === "package" && resource.manager === "mise";
}
