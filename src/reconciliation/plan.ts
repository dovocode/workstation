import type { Inspection } from "../resources/shared.js";
import { lstat } from "node:fs/promises";
import { mapConcurrent } from "../concurrency.js";
import { fingerprint, indexResources } from "../config/identity.js";
import { inspectResource } from "../resources/dispatch.js";
import { readState } from "../persistence/state.js";
import type { Action, ResolvedConfig, ResolvedResource, Runner, StateEntry } from "../api/types.js";

/** Compare declarations, stored ownership, and live inspections to produce ordered actions. */
export async function createPlan(config: ResolvedConfig, runner: Runner, onProgress?: (message: string) => void): Promise<Action[]> {
  const state = await readState(config.stateFile, config.context.machine);
  const desired = indexResources(config.resources);
  const actions: Action[] = [];
  let inspected = 0;
  const inspections = new Map(await mapConcurrent([...desired], async ([id, resource]) => {
    const inspection = await inspectResource(resource, runner);
    inspected += 1;
    if (inspected % 10 === 0 || inspected === desired.size) onProgress?.(`Checked ${inspected}/${desired.size} resources`);
    return [id, inspection] as const;
  }));

  for (const [id, resource] of desired) {
    onProgress?.(`  Inspect: ${id}`);
    const action = await planDesired(id, resource, state.resources[id], inspections.get(id)!);
    if (action) actions.push(action);
  }
  for (const [id, previous] of Object.entries(state.resources)) {
    if (desired.has(id)) continue;
    onProgress?.(`  Inspect removed declaration: ${id}`);
    actions.push(await planRemoval(id, previous, runner));
  }

  return actions.sort(
    (left, right) => actionOrder(left) - actionOrder(right) || left.id.localeCompare(right.id),
  );
}

/** Identify resource policies that permit updating adopted resources without taking removal ownership. */
function canUpdateAdoptedInPlace(resource: ResolvedConfig["resources"][number]): boolean {
  return (
    (resource.kind === "package" && ["brew-cask", "flatpak", "mas", "pacman"].includes(resource.manager)) ||
    (resource.kind === "generated-file" && ["overwrite", "inject", "merge"].includes(resource.ifExists)) ||
    resource.kind === "custom-tool" || resource.kind === "symlink"
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
