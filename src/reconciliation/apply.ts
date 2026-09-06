import { fingerprint } from "../config/identity.js";
import { createPlan } from "./plan.js";
import { applyPackageBatch, isPackageMutation, type PackageAction } from "./package-batch.js";
export { createPlan } from "./plan.js";
import { mkdir, rmdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  adoptResource,
  backupResource,
  inspectResource,
  installResource,
  removeResource,
  type Inspection,
} from "../resources/dispatch.js";
import { readState, writeState } from "../persistence/state.js";
import type {
  Action,
  ResolvedConfig,
  Runner,
  StateEntry,
  WorkstationState,
} from "../api/types.js";

/** Acquire the state guard, calculate actions, execute them, and release the guard on completion or failure. */
export async function applyPlan(
  config: ResolvedConfig,
  runner: Runner,
  onAction?: (action: Action) => void,
  onProgress?: (message: string) => void,
): Promise<Action[]> {
  await mkdir(dirname(config.stateFile), { recursive: true, mode: 0o700 });
  const guard = `${config.stateFile}.lock`;
  try {
    await mkdir(guard, { mode: 0o700 });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(`Another Workstation run holds ${guard}. If a previous run crashed, remove that directory after confirming it has stopped.`, { cause: error });
    }
    throw error;
  }
  try {
    return await reconcile(config, runner, onAction, onProgress);
  } finally {
    await rmdir(guard);
  }
}

/** Apply calculated actions in order and checkpoint ownership and backups between mutations. */
async function reconcile(
  config: ResolvedConfig,
  runner: Runner,
  onAction?: (action: Action) => void,
  onProgress?: (message: string) => void,
): Promise<Action[]> {
  onProgress?.("Inspecting resources...");
  const actions = await createPlan(config, runner, onProgress);
  onProgress?.(`Plan: ${actions.length} action(s).`);
  let state = await readState(config.stateFile, config.context.machine);

  for (let index = 0; index < actions.length; index++) {
    const action = actions[index];
    if (!action) continue;
    if (isPackageMutation(action)) {
      const batch: PackageAction[] = [action];
      while (index + 1 < actions.length) {
        const next = actions[index + 1];
        if (!next || !isPackageMutation(next) || (next.type === "remove") !== (action.type === "remove")) break;
        batch.push(next);
        index++;
      }
      await applyPackageBatch(batch, runner, async (completed, before, after) => {
        // Keep the prior version in state until cleanup succeeds, allowing a failed cleanup to retry.
        if (completed.type === "update" && after.matches) await removeReplacedMiseVersion(completed, runner);
        const resources = { ...state.resources };
        if (completed.type === "remove") delete resources[completed.id];
        else {
          resources[completed.id] = entry(completed, {
            owned: completed.previous?.owned === true || !before.present,
            inspection: after,
          });
        }
        state = { ...state, resources };
        await writeState(config.stateFile, state);
      }, onAction, onProgress);
      continue;
    }
    onAction?.(action);
    const resources = { ...state.resources };
    switch (action.type) {
      case "adopt": {
        const inspection = await inspectResource(action.resource, runner);
        await adoptResource(action.resource, runner);
        resources[action.id] = entry(
          action,
          { owned: false, inspection, originalFile: action.previous?.originalFile },
        );
        break;
      }
      case "create": {
        const inspection = await installResource(action.resource, runner);
        resources[action.id] = entry(
          action,
          { owned: true, inspection, originalFile: action.previous?.originalFile },
        );
        break;
      }
      case "update": {
        const before = await inspectResource(action.resource, runner);
        if (before.matches && action.resource.kind !== "custom-tool") {
          await removeReplacedMiseVersion(action, runner);
          resources[action.id] = entry(
            action,
            { owned: action.previous?.owned ?? false, inspection: before, originalFile: action.previous?.originalFile },
          );
          break;
        }
        const originalFile =
          action.previous?.originalFile ??
          (action.resource.kind === "generated-file" &&
          action.resource.ifExists === "overwrite" &&
          action.previous?.owned !== true &&
          before.present
            ? await backupResource(action.resource)
            : undefined);
        if (originalFile && action.previous?.originalFile === undefined) {
          resources[action.id] = entry(action, { owned: false, originalFile });
          state = { ...state, resources };
          await writeState(config.stateFile, state);
        }
        if (action.previous && shouldRemoveBeforeUpdate(action)) {
          await removeResource(
            action.previous.resource,
            runner,
            action.previous.installedVersion,
          );
          delete resources[action.id];
          state = { ...state, resources };
          await writeState(config.stateFile, state);
        }
        const inspection = await installResource(action.resource, runner, {
          managedFile: action.previous?.owned === true || action.previous?.originalFile !== undefined,
        });
        await removeReplacedMiseVersion(action, runner);
        resources[action.id] = entry(
          action,
          { owned: action.previous?.owned === true || !before.present, inspection, originalFile },
        );
        break;
      }
      case "remove":
        await removeResource(
          action.resource,
          runner,
          action.previous?.installedVersion,
          action.previous?.originalFile,
          action.previous?.installedHash,
        );
        delete resources[action.id];
        break;
      case "forget":
        delete resources[action.id];
        break;
    }
    state = { ...state, resources };
    await writeState(config.stateFile, state);
    onProgress?.(`  Done: ${action.type} ${action.id} (state saved)`);
  }

  return actions;
}

/** Decide whether a replacement requires removing the previously owned resource first. */
function shouldRemoveBeforeUpdate(action: Action): boolean {
  if (!action.previous?.owned) return false;
  if (action.previous.resource.kind === "generated-file") {
    return action.resource.kind !== "generated-file";
  }
  return action.previous.resource.kind !== "custom-tool" && action.previous.resource.kind !== "package";
}

/** Remove an owned prior mise version only after its replacement has been verified. */
async function removeReplacedMiseVersion(action: Action, runner: Runner): Promise<void> {
  const previous = action.previous;
  if (
    !previous?.owned || previous.resource.kind !== "package" ||
    previous.resource.manager !== "mise" || action.resource.kind !== "package" ||
    action.resource.manager !== "mise"
  ) return;
  const oldVersion = previous.installedVersion ?? previous.resource.lockedVersion;
  const newVersion = action.resource.lockedVersion ?? action.resource.version;
  if (oldVersion && newVersion && oldVersion !== newVersion) {
    await removeResource(previous.resource, runner, oldVersion);
  }
}

/** Read ownership state and calculate pending actions without applying resources. */
export async function status(
  config: ResolvedConfig,
  runner: Runner,
): Promise<{ readonly state: WorkstationState; readonly actions: readonly Action[] }> {
  return {
    state: await readState(config.stateFile, config.context.machine),
    actions: await createPlan(config, runner),
  };
}

/** Build a state entry from an action, ownership decision, inspection, and optional original backup. */
function entry(
  action: Action,
  options: {
    readonly owned: boolean;
    readonly inspection?: Inspection;
    readonly originalFile?: StateEntry["originalFile"];
  },
): StateEntry {
  const { owned, originalFile, inspection } = options;
  const { installedVersion, installedHash } = inspection ?? {};
  return {
    id: action.id,
    fingerprint: fingerprint(action.resource),
    owned,
    resource: action.resource,
    ...(installedVersion ? { installedVersion } : {}),
    ...(originalFile ? { originalFile } : {}),
    ...(installedHash ? { installedHash } : {}),
  };
}
