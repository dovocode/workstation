import type { Inspection } from "../resources/shared.js";
import { lstat } from "node:fs/promises";
import { mapConcurrent } from "../concurrency.js";
import { fingerprint, indexResources, resourceId } from "../config/identity.js";
import { inspectResource } from "../resources/dispatch.js";
import { readState } from "../persistence/state.js";
import type { Action, ResolvedConfig, ResolvedResource, Runner, StateEntry } from "../api/types.js";

/** Compare declarations, stored ownership, and live inspections to produce ordered actions. */
export async function createPlan(config: ResolvedConfig, runner: Runner, onProgress?: (message: string) => void, onlyIds?: ReadonlySet<string>): Promise<Action[]> {
  const state = await readState(config.stateFile, config.context.machine);
  const desired = indexResources(onlyIds ? config.resources.filter(resource => onlyIds.has(resourceId(resource))) : config.resources);
  const actions: Action[] = [];
  const inspections = await inspectDesired(config, desired, state, runner, onProgress);

  for (const [id, resource] of desired) {
    onProgress?.(`  Inspect: ${id}`);
    const action = await planDesired(id, resource, state.resources[id], inspections.get(id)!);
    if (action) actions.push(action);
  }
  addDependentActions(actions, desired, state, config.resources);
  for (const [id, previous] of Object.entries(state.resources)) {
    if (onlyIds || desired.has(id)) continue;
    onProgress?.(`  Inspect removed declaration: ${id}`);
    actions.push(await planRemoval(id, previous, runner));
  }

  return orderDependencies(actions.sort(
    (left, right) => actionOrder(left) - actionOrder(right) || left.id.localeCompare(right.id),
  ), config.resources);
}

/** Identify resource policies that permit updating adopted resources without taking removal ownership. */
function canUpdateAdoptedInPlace(resource: ResolvedConfig["resources"][number]): boolean {
  return (
    (resource.kind === "package" && ["brew-cask", "flatpak", "mas", "pacman"].includes(resource.manager)) ||
    (resource.kind === "generated-file" && ["overwrite", "inject", "merge"].includes(resource.ifExists)) ||
    resource.kind === "provision" || resource.kind === "custom-tool" || resource.kind === "symlink"
  );
}

/** Allow managed generated-file repairs when ownership or an overwrite backup permits them. */
function canRepairManagedFile(
  resource: ResolvedConfig["resources"][number],
  previous: StateEntry,
): boolean {
  return (
    resource.kind === "generated-file" &&
    (previous.owned ||
      (previous.originalFile !== undefined && resource.ifExists === "overwrite"))
  );
}

/** Order service removals before dependencies and installations before dependent files and services. */
function actionOrder(action: Action): number {
  const removing = action.type === "remove" || action.type === "forget";
  if (removing) {
    if (action.resource.kind === "launch-agent" || action.resource.kind === "systemd-service") return 0;
    if (action.resource.kind === "symlink" || action.resource.kind === "generated-file") return 1;
    return 2;
  }
  if (action.resource.kind === "package") return 3;
  if (action.resource.kind === "custom-tool") return 4;
  if (action.resource.kind === "symlink" || action.resource.kind === "generated-file") return 5;
  return 6;
}

/** Inspect source safety before selecting an action for a desired resource. */
async function planDesired(id: string, resource: ResolvedResource, previous: StateEntry | undefined, inspection: Inspection): Promise<Action | undefined> {
  if (resource.kind === "custom-tool" && inspection.present && previous?.installedHash !== undefined && inspection.installedHash !== previous.installedHash) {
    throw new Error(`Managed custom tool ${id} was changed outside Workstation`);
  }
  if (resource.kind === "symlink" && !inspection.matches) await lstat(resource.source);
  if (!previous) return planUntracked(id, resource, inspection);
  if (previous.fingerprint !== fingerprint(resource)) return planChanged(id, resource, previous, inspection);
  if (inspection.matches) return;
  if (inspection.conflict && !canRepairManagedFile(resource, previous)) throw new Error(`Managed resource ${id} drifted: ${inspection.conflict}`);
  return { type: inspection.present ? "update" : "create", id, resource, previous, reason: driftReason(inspection, resource) };
}

/** Explain live drift consistently for new and already-managed resources. */
function driftReason(inspection: Inspection, resource: ResolvedResource): string {
  if (inspection.migration) return "migrate from mise to Homebrew";
  if (inspection.present && resource.kind === "symlink") return "symlink points to a different source";
  return inspection.present ? "upgrade available" : "managed resource is missing";
}

/** Choose adoption, creation, or an in-place upgrade for an untracked declaration. */
function planUntracked(id: string, resource: ResolvedResource, inspection: Inspection): Action {
  if (inspection.matches) return { type: "adopt", id, resource, reason: "already present" };
  if (inspection.conflict) throw new Error(`Cannot manage ${id}: ${inspection.conflict}`);
  if (inspection.present) return { type: "update", id, resource, reason: driftReason(inspection, resource) };
  return { type: "create", id, resource, reason: "not present" };
}

/** Reject unsafe ownership transitions before updating a changed declaration. */
function planChanged(id: string, resource: ResolvedResource, previous: StateEntry, inspection: Inspection): Action {
  if (previous.originalFile && previous.resource.kind !== resource.kind) throw new Error(`Cannot change the resource kind for ${id} while it holds an original-file backup; remove it first to restore the original`);
  if (!inspection.matches && !previous.owned && inspection.present && !canUpdateAdoptedInPlace(resource)) throw new Error(`Cannot update adopted resource ${id}; remove or take ownership manually`);
  return { type: "update", id, resource, previous, reason: "configuration changed" };
}

/** Preserve adopted resources and validate live content before owned removal. */
async function planRemoval(id: string, previous: StateEntry, runner: Runner): Promise<Action> {
  const base = { id, resource: previous.resource, previous };
  if (previous.resource.kind === "provision") return { ...base, type: "forget", reason: "setup retained after declaration removal" };
  if (!previous.owned && previous.originalFile === undefined) return { ...base, type: "forget", reason: "adopted resource removed from configuration" };
  const inspection = await inspectResource(previous.resource, runner);
  if (previous.originalFile !== undefined) return { ...base, type: "remove", reason: "removed from configuration; restore original file" };
  if (!inspection.present) return { ...base, type: "forget", reason: "owned resource is already absent" };
  if (changedBeforeRemoval(previous, inspection)) throw new Error(`Refusing to remove changed resource ${id}`);
  return { ...base, type: "remove", reason: "removed from configuration" };
}

/** Detect live changes that forbid deletion when no original backup will be restored. */
function changedBeforeRemoval(previous: StateEntry, inspection: Inspection): boolean {
  if (inspection.conflict) return true;
  if (previous.resource.kind === "generated-file" || previous.resource.kind === "symlink") return !inspection.matches;
  return previous.resource.kind === "custom-tool" && inspection.installedHash !== previous.installedHash;
}

/** Dependency edges supplement the existing resource phase ordering. */
export function orderDependencies(actions: readonly Action[], resources: readonly ResolvedResource[]): Action[] {
  const known = new Map(resources.map(resource => [resourceId(resource), resource]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  /** Reject cycles and missing references using a depth-first traversal. */
  const validate = (id: string) => {
    if (visiting.has(id)) throw new Error(`Resource dependency cycle: ${id}`);
    if (visited.has(id)) return;
    const resource = known.get(id);
    if (!resource) throw new Error(`Unknown resource dependency: ${id}`);
    visiting.add(id);
    for (const dependency of resource.dependsOn ?? []) validate(dependency);
    visiting.delete(id); visited.add(id);
  };
  for (const id of known.keys()) validate(id);
  const pending = new Map(actions.map(action => [action.id, action]));
  const result: Action[] = [];
  /** Emit prerequisites first, reversing dependency edges for removals. */
  const emit = (action: Action) => {
    if (!pending.delete(action.id)) return;
    if (action.type === "remove" || action.type === "forget") {
      for (const other of [...pending.values()]) if ((other.type === "remove" || other.type === "forget") && other.resource.dependsOn?.includes(action.id)) emit(other);
    }
    for (const dependency of action.resource.dependsOn ?? []) {
      const next = pending.get(dependency);
      if (next && next.type !== "remove" && next.type !== "forget") emit(next);
    }
    result.push(action);
  };
  for (const action of actions) emit(action);
  return result;
}

/** Inspect independent resources concurrently and defer checks whose prerequisites will change. */
async function inspectDesired(config: ResolvedConfig, desired: Map<string, ResolvedResource>, state: Awaited<ReturnType<typeof readState>>, runner: Runner, onProgress?: (message: string) => void): Promise<Map<string, Inspection>> {
  let inspected = 0;
  const checks = new Set([...desired].filter(([, resource]) => resource.kind === "provision" && resource.operation.type === "check" && resource.dependsOn?.length).map(([id]) => id));
  const inspections = new Map(await mapConcurrent([...desired].filter(([id]) => !checks.has(id)), async ([id, resource]) => {
    const inspection = await inspectResource(resource, runner);
    inspected += 1;
    if (inspected % 10 === 0 || inspected === desired.size) onProgress?.(`Checked ${inspected}/${desired.size} resources`);
    return [id, inspection] as const;
  }));
  const checkOrder = orderDependencies([...desired].map(([id, resource]) => ({ type: "adopt", id, resource, reason: "inspection ordering" })), config.resources);
  for (const { id, resource } of checkOrder) {
    if (!checks.has(id)) continue;
    const waiting = resource.dependsOn?.some(dependency => {
      const desiredDependency = desired.get(dependency);
      return !inspections.get(dependency)?.matches || (desiredDependency && state.resources[dependency]?.fingerprint !== fingerprint(desiredDependency));
    });
    inspections.set(id, waiting ? { present: true, matches: false } : await inspectResource(resource, runner));
  }
  return inspections;
}

/** Propagate changed inputs through service and health dependencies. */
function addDependentActions(actions: Action[], desired: Map<string, ResolvedResource>, state: Awaited<ReturnType<typeof readState>>, resources: readonly ResolvedResource[]): void {
  const changed = new Set(actions.filter(action => action.type !== "adopt").map(action => action.id));
  const ordered = orderDependencies([...desired].map(([id, resource]) => ({ type: "adopt", id, resource, reason: "dependency ordering" })), resources);
  for (const { id, resource } of ordered) {
    if (!isReactiveResource(resource) || !resource.dependsOn?.some(dependency => changed.has(dependency))) continue;
    const existing = actions.findIndex(action => action.id === id);
    if (existing >= 0 && actions[existing]?.type === "create") continue;
    const previous = state.resources[id];
    const action: Action = { type: "update", id, resource, ...(previous ? { previous } : {}), reason: "service dependency changed" };
    if (existing >= 0) actions[existing] = action; else actions.push(action);
    changed.add(id);
  }
}

/** Services and health checks react to changes in their declared inputs. */
function isReactiveResource(resource: ResolvedResource): boolean {
  return resource.kind === "launch-agent" || resource.kind === "systemd-service" || (resource.kind === "provision" && ["check", "service"].includes(resource.operation.type));
}
