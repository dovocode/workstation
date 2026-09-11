import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join } from "node:path";
import { mapConcurrent } from "./concurrency.js";
import { indexResources, fingerprint } from "./config/identity.js";
import { readState } from "./persistence/state.js";
import { inspectResource } from "./resources/dispatch.js";
import { packageCapabilities } from "./resources/capabilities.js";
import type { ResolvedConfig, ResolvedResource, Runner } from "./api/types.js";

export interface ResourceStatus {
  readonly id: string;
  readonly status: "converged" | "drifted" | "untracked" | "declaration-changed" | "removed-declaration" | "error";
  readonly detail?: string;
}

/** Inspect against recorded pins without resolving new versions or writing any files. */
export async function inspectStatus(config: ResolvedConfig, runner: Runner): Promise<ResourceStatus[]> {
  const state = await readState(config.stateFile, config.context.machine);
  const desired = indexResources(config.resources);
  const results = await mapConcurrent([...desired], async ([id, resource]): Promise<ResourceStatus> => {
    const previous = state.resources[id];
    if (!previous) return { id, status: "untracked" };
    const recorded = declarationResource(previous.resource);
    if (fingerprint(recorded) !== fingerprint(resource)) return { id, status: "declaration-changed" };
    try {
      const inspection = await inspectResource(previous.resource, runner);
      return { id, status: inspection.matches && (previous.resource.kind !== "custom-tool" || inspection.installedHash === previous.installedHash) ? "converged" : "drifted", ...(inspection.conflict ? { detail: inspection.conflict } : {}) };
    } catch (error) {
      return { id, status: "error", detail: error instanceof Error ? error.message : String(error) };
    }
  });
  for (const id of Object.keys(state.resources)) if (!desired.has(id)) results.push({ id, status: "removed-declaration" });
  return results;
}

/** Check required executables and state validity without installing or running package managers. */
export async function diagnose(config: ResolvedConfig, searchPath = process.env.PATH ?? ""): Promise<string[]> {
  const messages: string[] = [];
  await readState(config.stateFile, config.context.machine);
  const managers = new Set(config.resources.flatMap((resource) => resource.kind === "package" ? [resource.manager] : []));
  for (const manager of managers) {
    if (manager === "system") throw new Error("Resolve the system manager before diagnostics");
    const capability = packageCapabilities[manager];
    for (const command of capability.commands) {
      const found = await findExecutable(command, searchPath);
      messages.push(`${found ? "OK" : "MISSING"} ${command} (${manager})`);
    }
    messages.push(`${manager}: pins=${capability.pins}; bootstrap=${capability.bootstrap ? "supported" : "manual"}. ${capability.recovery}`);
  }
  return messages;
}

/** Search executable regular files without swallowing unexpected filesystem errors. */
async function findExecutable(command: string, searchPath: string): Promise<boolean> {
  let found = false;
  for (const directory of searchPath.split(delimiter).filter(Boolean)) {
    try {
      const path = join(directory, command);
      await access(path, constants.X_OK);
      if ((await stat(path)).isFile()) { found = true; break; }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR", "EACCES"].includes(String(error.code)))) throw error;
    }
  }
  return found;
}

/** Normalize applied pins back to source selectors for declaration comparison. */
function declarationResource(resource: ResolvedResource): ResolvedResource {
  const recorded = { ...resource };
  if (recorded.kind === "package") Reflect.deleteProperty(recorded, "lockedVersion");
  if (recorded.kind === "generated-file" && recorded.miseSelectors && typeof recorded.value === "object" && recorded.value !== null && !Array.isArray(recorded.value)) recorded.value = { ...recorded.value, tools: recorded.miseSelectors };
  return recorded;
}
