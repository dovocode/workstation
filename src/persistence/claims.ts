import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resourceId } from "../config/identity.js";
import { atomicWrite, isMissingFile } from "../resources/shared.js";
import type { ResolvedConfig } from "../api/types.js";

/** Prevent two registered configurations from asserting ownership of the same resource. Called under the machine guard. */
export async function claimResources(config: ResolvedConfig): Promise<void> {
  const path = join(config.context.home, ".local/state/workstation/claims.json");
  let data: unknown;
  try { data = JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (!isMissingFile(error)) throw error; data = {}; }
  if (typeof data !== "object" || data === null || Array.isArray(data) || !Object.values(data).every(value => typeof value === "string")) throw new Error(`Invalid ownership registry: ${path}`);
  const claims = new Map<string, string>();
  for (const [id, owner] of Object.entries(data)) { if (typeof owner === "string") claims.set(id, owner); }
  for (const resource of config.resources) {
    const id = resourceId(resource);
    const owner = claims.get(id);
    if (owner && owner !== config.stateFile) throw new Error(`${id} is already registered to ${owner}; migrate ownership explicitly`);
    claims.set(id, config.stateFile);
  }
  // Reserve old claims until their removals are verified; failed builds cannot surrender ownership.
  await atomicWrite(path, JSON.stringify(Object.fromEntries(claims), null, 2), 0o600);
}

/** Release only claims whose resources were successfully removed/forgotten from state. */
export async function releaseUnusedClaims(config: ResolvedConfig, retainedIds: ReadonlySet<string>): Promise<void> {
  const path = join(config.context.home, ".local/state/workstation/claims.json");
  const data: unknown = JSON.parse(await readFile(path, "utf8"));
  if (typeof data !== "object" || data === null || Array.isArray(data) || !Object.values(data).every(value => typeof value === "string")) throw new Error(`Invalid ownership registry: ${path}`);
  await atomicWrite(path, JSON.stringify(Object.fromEntries(Object.entries(data).filter(([id, owner]) => owner !== config.stateFile || retainedIds.has(id))), null, 2), 0o600);
}
