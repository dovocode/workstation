import { fingerprint } from "../config/identity.js";
import { createPlan } from "./plan.js";
import { applyPackageBatch, isPackageMutation, type PackageAction } from "./package-batch.js";
export { createPlan } from "./plan.js";
import { mkdir, rmdir } from "node:fs/promises";
import { dirname } from "node:path";
import { writeManifest } from "../persistence/manifest.js";
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
} from "../api/types.js";

/** Execution controls evaluated before resource mutation while holding the state guard. */
export interface ApplyOptions {
  /** Reject the entire plan if it contains a remove action; forget actions only update ownership. */
  readonly noRemove?: boolean;
  /** Optional additional preconditions, used by rollback to reject stale state and unrelated drift. */
  readonly validate?: (actions: readonly Action[]) => Promise<void>;
}

/** Acquire the state guard, calculate actions, execute them, and release the guard on completion or failure. */
export async function applyPlan(
  config: ResolvedConfig,
  runner: Runner,
  onAction?: (action: Action) => void,
  onProgress?: (message: string) => void,
  options: ApplyOptions = {},
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
    return await reconcile(config, runner, onAction, onProgress, options);
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
  options: ApplyOptions = {},
): Promise<Action[]> {
  onProgress?.("Inspecting resources...");
  const actions = await createPlan(config, runner, onProgress);
  await options.validate?.(actions);
  onProgress?.(`Plan: ${actions.length} action(s).`);
  let state = await readState(config.stateFile, config.context.machine);
  if (options.noRemove && actions.some((action) => action.type === "remove")) {
    throw new Error("Plan contains removals; --no-remove forbids applying it");
  }
  if (actions.length > 0) {
    const snapshot = `${dirname(config.stateFile)}/history/${Date.now()}-${process.pid}`;
    await writeState(`${snapshot}/state.json`, state);
    await writeManifest(`${snapshot}/desired.toml`, config);
    onProgress?.(`Recovery snapshot: ${snapshot}`);
  }

  for (let index = 0; index < actions.length; index++) {
    const action = actions[index];
    if (!action) continue;
    if (isPackageMutation(action)) {
      const batch = collectBatch(actions, index, action);
      index += batch.length - 1;
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
    await applyAction(action);
  }

  /** Apply one non-batched action, preserving checkpoint-before-mutation ordering. */
  async function applyAction(action: Action): Promise<void> {
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
        await updateAction();
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
    /** Keep an original backup durable before replacing any generated content. */
    async function updateAction(): Promise<void> {
      const before = await inspectResource(action.resource, runner);
      if (before.matches && action.resource.kind !== "custom-tool") {
        await removeReplacedMiseVersion(action, runner);
        resources[action.id] = entry(
          action,
          { owned: action.previous?.owned ?? false, inspection: before, originalFile: action.previous?.originalFile },
        );
        return;
      }
      const originalFile = await originalForUpdate(action, before);
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

/** Reuse saved originals and capture only unowned files covered by a replacement policy. */
async function originalForUpdate(action: Action, before: Inspection): Promise<StateEntry["originalFile"]> {
  if (action.previous?.originalFile) return action.previous.originalFile;
  if (action.resource.kind !== "generated-file" || action.previous?.owned === true || !before.present) return;
  if (!["overwrite", "inject", "merge"].includes(action.resource.ifExists)) return;
  return backupResource(action.resource);
}

/** Collect adjacent package actions without crossing a removal or dependent-resource boundary. */
function collectBatch(actions: readonly Action[], index: number, first: PackageAction): PackageAction[] {
  const batch = [first];
  for (let nextIndex = index + 1; nextIndex < actions.length; nextIndex += 1) {
    const next = actions[nextIndex];
    if (!next || !isPackageMutation(next) || (next.type === "remove") !== (first.type === "remove")) break;
    batch.push(next);
  }
  return batch;
}
