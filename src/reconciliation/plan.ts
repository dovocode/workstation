import { lstat } from "node:fs/promises";
import { fingerprint, resourceId } from "../config/identity.js";
import { inspectResource } from "../resources/dispatch.js";
import { readState } from "../persistence/state.js";
import type { Action, ResolvedConfig, Runner, StateEntry } from "../api/types.js";

/** Compare declarations, stored ownership, and live inspections to produce ordered actions. */
export async function createPlan(config: ResolvedConfig, runner: Runner, onProgress?: (message: string) => void): Promise<Action[]> {
  const state = await readState(config.stateFile, config.context.machine);
  const desired = new Map(config.resources.map((resource) => [resourceId(resource), resource]));
  const actions: Action[] = [];

  for (const [id, resource] of desired) {
    onProgress?.(`  Inspect: ${id}`);
    const previous = state.resources[id];
    const inspection = await inspectResource(resource, runner);
    if (
      resource.kind === "custom-tool" && inspection.present &&
      previous?.installedHash !== undefined && inspection.installedHash !== previous.installedHash
    ) {
      throw new Error(`Managed custom tool ${id} was changed outside Workstation`);
    }
    if (resource.kind === "symlink" && !inspection.matches) await lstat(resource.source);
    if (!previous) {
      if (inspection.matches) {
        actions.push({ type: "adopt", id, resource, reason: "already present" });
      } else if (inspection.conflict) {
        throw new Error(`Cannot manage ${id}: ${inspection.conflict}`);
      } else if (inspection.present) {
        actions.push({ type: "update", id, resource, reason: inspection.migration ? "migrate from mise to Homebrew" : "upgrade available" });
      } else {
        actions.push({ type: "create", id, resource, reason: "not present" });
      }
      continue;
    }

    if (previous.fingerprint !== fingerprint(resource)) {
      if (previous.originalFile && previous.resource.kind !== resource.kind) {
        throw new Error(`Cannot change the resource kind for ${id} while it holds an original-file backup; remove it first to restore the original`);
      }
      if (!inspection.matches && !previous.owned && inspection.present && !canUpdateAdoptedInPlace(resource)) {
        throw new Error(`Cannot update adopted resource ${id}; remove or take ownership manually`);
      }
      actions.push({ type: "update", id, resource, previous, reason: "configuration changed" });
    } else if (!inspection.matches) {
      if (inspection.conflict && !canRepairManagedFile(resource, previous)) {
        throw new Error(`Managed resource ${id} drifted: ${inspection.conflict}`);
      }
      actions.push({
        type: inspection.present ? "update" : "create",
        id,
        resource,
        previous,
        reason: inspection.migration ? "migrate from mise to Homebrew" : inspection.present ? "upgrade available" : "managed resource is missing",
      });
    }
  }

  for (const [id, previous] of Object.entries(state.resources)) {
    if (desired.has(id)) continue;
    onProgress?.(`  Inspect removed declaration: ${id}`);
    const removable = previous.owned || previous.originalFile !== undefined;
    if (!removable) {
      actions.push({
        type: "forget", id, resource: previous.resource, previous,
        reason: "adopted resource removed from configuration",
      });
      continue;
    }
    const inspection = await inspectResource(previous.resource, runner);
    const restoreOriginal = previous.originalFile !== undefined;
    if (inspection.present && !restoreOriginal) {
      if (
        inspection.conflict ||
        (previous.resource.kind === "generated-file" && !inspection.matches) ||
        (previous.resource.kind === "custom-tool" &&
          inspection.installedHash !== previous.installedHash)
      ) {
        throw new Error(`Refusing to remove changed resource ${id}`);
      }
    }
    actions.push({
      type: restoreOriginal || inspection.present ? "remove" : "forget",
      id,
      resource: previous.resource,
      previous,
      reason:
        restoreOriginal
          ? "removed from configuration; restore original file"
          : inspection.present
            ? "removed from configuration"
            : "owned resource is already absent",
    });
  }

  return actions.sort(
    (left, right) => actionOrder(left) - actionOrder(right) || left.id.localeCompare(right.id),
  );
}

/** Identify resource policies that permit updating adopted resources without taking removal ownership. */
function canUpdateAdoptedInPlace(resource: ResolvedConfig["resources"][number]): boolean {
  return (
    (resource.kind === "package" && ["brew-cask", "flatpak", "mas", "pacman"].includes(resource.manager)) ||
    (resource.kind === "generated-file" && resource.ifExists === "overwrite") ||
    resource.kind === "custom-tool"
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
