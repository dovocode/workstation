import { refreshPackageMetadata } from "../resources/package-metadata.js";
import { readState } from "../persistence/state.js";
import { claimResources, releaseUnusedClaims } from "../persistence/claims.js";
import { withRunLock } from "../persistence/guard.js";
import { lockConfig } from "../persistence/lock.js";
import { manifestPath, writeManifest, readManifest } from "../persistence/manifest.js";
import { ensurePrerequisites } from "../bootstrap.js";
import { isRepositoryResource } from "../resources/provision.js";
import { runAfterApply } from "../resources/hooks.js";
import { resourceId } from "../config/identity.js";
import { orderDependencies } from "./plan.js";
import { applyPlan } from "./apply.js";
import type { Action, ResolvedConfig, Runner } from "../api/types.js";

export interface BuildOptions {
  readonly frozen?: boolean;
  readonly noRemove?: boolean;
  readonly refresh?: true | readonly string[];
  readonly onAction?: (action: Action) => void;
  readonly onProgress?: (message: string) => void;
}
/** One orchestration path for CLI and embedded builds and upgrades. */
export async function buildConfiguration(configPath: string, config: ResolvedConfig, runner: Runner, options: BuildOptions = {}): Promise<Action[]> {
  orderDependencies([], config.resources); // Reject unknown/cyclic dependencies before mutation.
  if (Array.isArray(options.refresh)) {
    const packages = new Set(config.resources.filter(r => r.kind === "package").map(resourceId));
    for (const id of options.refresh) if (!packages.has(id)) throw new Error(`Unknown package resource selected for lock refresh: ${id}`);
  }
  return withRunLock(config, async () => {
    if (options.noRemove) {
      const state = await readState(config.stateFile, config.context.machine);
      const desired = new Set(config.resources.map(resourceId));
      if (Object.values(state.resources).some(entry => !desired.has(entry.id) && entry.resource.kind !== "provision" && (entry.owned || entry.originalFile))) throw new Error("Plan contains removals; --no-remove forbids applying it");
    }
    await claimResources(config);
    await ensurePrerequisites(config, runner);
    const repositories = new Set(config.resources.filter(isRepositoryResource).map(resourceId));
    const prepared = repositories.size ? await applyPlan(config, runner, options.onAction, options.onProgress, { onlyIds: repositories }) : [];
    if (options.refresh) await refreshPackageMetadata(config.resources, options.refresh, runner);
    const locked = await lockConfig(configPath, config, runner, {
      ...(options.frozen !== undefined && !options.refresh ? { frozen: options.frozen } : {}),
      ...(options.refresh !== undefined ? { refresh: options.refresh } : {}),
    });
    await writeManifest(manifestPath(config), locked.config);
    const resolved = await readManifest(manifestPath(config));
    const actions = await applyPlan(resolved, runner, options.onAction, options.onProgress, { ...(options.noRemove !== undefined ? { noRemove: options.noRemove } : {}) });
    await runAfterApply(resolved, runner, options.onProgress);
    const state = await readState(config.stateFile, config.context.machine);
    await releaseUnusedClaims(config, new Set([...config.resources.map(resourceId), ...Object.keys(state.resources)]));
    return [...prepared, ...actions];
  });
}
