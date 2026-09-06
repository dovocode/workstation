import type { Action, ResolvedPackageResource, Runner } from "../api/types.js";
import { inspectPackage, preparePackageInstallation, preparePackageRemoval, reconcilePackage } from "../resources/package.js";
import { packageCommandKey, runPackageCommand, type PackageCommand } from "../resources/package-command.js";
import type { Inspection } from "../resources/shared.js";

export type PackageAction = Action & { readonly resource: ResolvedPackageResource };
interface PreparedAction {
  readonly action: PackageAction;
  readonly before: Inspection;
  readonly mutation?: PackageCommand;
}

/** Only package mutations can participate; adoptions and dependent resources stay ordered. */
export function isPackageMutation(action: Action): action is PackageAction {
  return action.resource.kind === "package" && ["create", "update", "remove"].includes(action.type);
}

/** Preflight a package phase, execute native batches, and checkpoint each observed outcome. */
export async function applyPackageBatch(
  actions: readonly PackageAction[],
  runner: Runner,
  checkpoint: (action: PackageAction, before: Inspection, after: Inspection) => Promise<void>,
  onAction?: (action: Action) => void,
  onProgress?: (message: string) => void,
): Promise<void> {
  const groups: PreparedAction[][] = [];
  const byCommand = new Map<string, PreparedAction[]>();
  for (const action of actions) {
    const before = await inspectPackage(action.resource, runner);
    if (before.conflict) throw new Error(`Cannot manage ${action.id}: ${before.conflict}`);
    const mutation = action.type === "remove"
      ? before.present ? preparePackageRemoval(action.resource, action.previous?.installedVersion) : undefined
      : before.migration ? undefined : await preparePackageInstallation(action.resource, runner, before);
    const prepared: PreparedAction = { action, before, ...(mutation ? { mutation } : {}) };
    const key = mutation ? packageCommandKey(mutation) : undefined;
    const group = key === undefined ? undefined : byCommand.get(key);
    if (group) group.push(prepared);
    else {
      const next = [prepared];
      groups.push(next);
      if (key !== undefined) byCommand.set(key, next);
    }
  }

  for (const group of groups) {
    const first = group[0];
    if (!first) continue;
    for (const item of group) onAction?.(item.action);
    onProgress?.(`  ${group.length > 1 ? "Batch" : "Package"}: ${first.action.resource.manager} ${first.mutation?.args.join(" ") ?? first.action.type} (${group.length} package(s))`);
    const errors: unknown[] = [];
    try {
      if (first.before.migration && first.action.type !== "remove") {
        await reconcilePackage(first.action.resource, runner);
      } else if (first.mutation) {
        await runPackageCommand({ ...first.mutation, targets: group.flatMap((item) => item.mutation?.targets ?? []) }, runner);
      }
    } catch (error) {
      errors.push(error);
    }
    // A native transaction may partially succeed. Inspect every target even after a nonzero exit.
    for (const { action, before } of group) {
      try {
        const after = await inspectPackage(action.resource, runner);
        const converged = action.type === "remove" ? !after.present : after.matches;
        // Preserve removal ownership for partially installed packages; never claim a migration succeeded.
        if (converged || (action.type !== "remove" && after.present && !after.conflict && !after.migration)) {
          await checkpoint(action, before, after);
          onProgress?.(`  ${converged ? "Done" : "Partial"}: ${action.type} ${action.id} (state saved)`);
        }
        if (!converged) errors.push(new Error(`${action.id} did not converge: expected ${action.type === "remove" ? "absent" : action.resource.lockedVersion ?? "no available upgrades"}; installed ${after.installedVersion ?? (after.present ? "version unknown" : "not present")}${after.conflict ? `; ${after.conflict}` : ""}`));
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `Package batch failed; verified results were saved. ${errors.map((error) => error instanceof Error ? error.message : String(error)).join("; ")}`);
    }
  }
}
