import { mkdir, readFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { renderLaunchAgent } from "../rendering/plist.js";
import type { LaunchAgentResource, Runner } from "../api/types.js";
import { atomicWrite, isMissingFile, requireSuccess, type Inspection } from "./shared.js";

/** Compare the on-disk LaunchAgent plist with the rendered declaration. */
export async function inspectLaunchAgent(resource: LaunchAgentResource, runner?: Runner): Promise<Inspection> {
  const path = launchAgentPath(resource);
  try {
    const current = await readFile(path, "utf8");
    let matches = current === renderLaunchAgent(resource);
    const contentMatches = matches;
    if (matches && runner) {
      const loaded = await runner.run("launchctl", ["print", `gui/${process.getuid?.() ?? 0}/${resource.label}`]);
      matches = loaded.exitCode === 0 && (resource.keepAlive !== true || /state = running/.test(loaded.stdout));
    }
    return {
      present: true,
      matches,
      ...(contentMatches ? {} : { conflict: `${path} exists with different content` }),
    };
  } catch (error) {
    if (isMissingFile(error)) return { present: false, matches: false };
    throw error;
  }
}

/** Write a missing plist, bootstrap an unloaded agent, and request launchd to start it. */
export async function installLaunchAgent(resource: LaunchAgentResource, runner: Runner): Promise<void> {
  const inspection = await inspectLaunchAgent(resource);
  if (inspection.present && !inspection.matches) throw new Error(inspection.conflict);
  if (!inspection.present) {
    const path = launchAgentPath(resource);
    await mkdir(dirname(path), { recursive: true });
    await atomicWrite(path, renderLaunchAgent(resource));
  }
  const domain = `gui/${process.getuid?.() ?? 0}`;
  const loaded = await runner.run("launchctl", ["print", `${domain}/${resource.label}`]);
  if (loaded.exitCode !== 0) {
    await requireSuccess(runner, "launchctl", ["bootstrap", domain, launchAgentPath(resource)]);
  }
  await requireSuccess(runner, "launchctl", ["kickstart", `${domain}/${resource.label}`]);
}

/** Unload and remove a LaunchAgent only when its plist still matches the managed declaration. */
export async function removeLaunchAgent(resource: LaunchAgentResource, runner: Runner): Promise<void> {
  const inspection = await inspectLaunchAgent(resource);
  if (!inspection.present) return;
  if (!inspection.matches) throw new Error(`Refusing to remove changed LaunchAgent: ${inspection.conflict}`);
  const domain = `gui/${process.getuid?.() ?? 0}`;
  const loaded = await runner.run("launchctl", ["print", `${domain}/${resource.label}`]);
  if (loaded.exitCode === 0) {
    await requireSuccess(runner, "launchctl", ["bootout", `${domain}/${resource.label}`]);
  }
  await unlink(launchAgentPath(resource));
}

/** Resolve the current user's LaunchAgents plist path and require HOME. */
function launchAgentPath(resource: LaunchAgentResource): string {
  const home = process.env.HOME;
  if (!home) throw new Error("HOME is required to manage LaunchAgents");
  return resolve(home, "Library", "LaunchAgents", `${resource.label}.plist`);
}
