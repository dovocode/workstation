import { dirname, join } from "node:path";
import { unlink } from "node:fs/promises";
import { readState, writeState } from "./state.js";
import { inspectResource } from "../resources/dispatch.js";
import { isMissingFile } from "../resources/shared.js";
import type { ResolvedConfig, Runner, StateEntry } from "../api/types.js";
/** Locate the private pending-action journal beside ownership state. */

const path = (config: ResolvedConfig) => join(dirname(config.stateFile), "pending.json");
/** Save intended ownership before mutation. Existing resource backups are included in the entry. */
export async function journalIntent(config: ResolvedConfig, entries: readonly StateEntry[]): Promise<void> {
  await writeState(path(config), { version: 1, machine: config.context.machine, resources: Object.fromEntries(entries.map(entry => [entry.id, entry])) });
}
/** Remove the journal only after its outcome has been checkpointed. */
export async function clearJournal(config: ResolvedConfig): Promise<void> { await unlink(path(config)).catch(error => { if (!isMissingFile(error)) throw error; }); }
/** Recover verified creations without accidentally adopting something installed by an interrupted run. */
export async function recoverJournal(config: ResolvedConfig, runner: Runner): Promise<void> {
  const pending = await readState(path(config), config.context.machine);
  if (!Object.keys(pending.resources).length) return;
  const current = await readState(config.stateFile, config.context.machine);
  const resources = { ...current.resources };
  for (const entry of Object.values(pending.resources)) {
    const inspection = await inspectResource(entry.resource, runner);
    if (inspection.matches) {
      resources[entry.id] = { ...entry, ...(inspection.installedHash ? { installedHash: inspection.installedHash } : {}), ...(inspection.installedVersion ? { installedVersion: inspection.installedVersion } : {}) };
    } else if (entry.owned && !current.resources[entry.id] && inspection.present) {
      throw new Error(`Interrupted creation of ${entry.id} has ambiguous contents. Pending intent and backups are preserved in ${path(config)}; inspect the target before retrying.`);
    } else if (entry.originalFile && !resources[entry.id]?.originalFile) {
      resources[entry.id] = entry;
    }
  }
  await writeState(config.stateFile, { ...current, resources });
  await clearJournal(config);
}
