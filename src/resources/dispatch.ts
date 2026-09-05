import type { OriginalFile, ResolvedResource, Runner } from "../api/types.js";
import type { Inspection } from "./shared.js";
export type { Inspection } from "./shared.js";
export { backupResource } from "./generated-file.js";
import { inspectPackage, reconcilePackage, removePackage } from "./package.js";
import { inspectSymlink, installSymlink, removeSymlink } from "./symlink.js";
import { inspectLaunchAgent, installLaunchAgent, removeLaunchAgent } from "./launch-agent.js";
import { inspectGeneratedFile, installGeneratedFile, removeGeneratedFile } from "./generated-file.js";
import { inspectSystemdService, installSystemdService, removeSystemdService } from "./systemd-service.js";
import { inspectCustomTool, installCustomTool, removeCustomTool } from "./custom-tool.js";

/** Delegate live inspection to the backend for the resource kind. */
export async function inspectResource(
  resource: ResolvedResource,
  runner: Runner,
): Promise<Inspection> {
  switch (resource.kind) {
    case "package":
      return await inspectPackage(resource, runner);
    case "symlink":
      return await inspectSymlink(resource);
    case "launch-agent":
      return await inspectLaunchAgent(resource);
    case "generated-file":
      return await inspectGeneratedFile(resource);
    case "systemd-service":
      return await inspectSystemdService(resource);
    case "custom-tool":
      return await inspectCustomTool(resource);
  }
}

/** Install or update a resource through its backend and return the resulting inspection. */
export async function installResource(
  resource: ResolvedResource,
  runner: Runner,
  options: { readonly managedFile?: boolean } = {},
): Promise<Inspection> {
  switch (resource.kind) {
    case "package":
      return await reconcilePackage(resource, runner);
    case "symlink":
      await installSymlink(resource);
      return { present: true, matches: true };
    case "launch-agent":
      await installLaunchAgent(resource, runner);
      return { present: true, matches: true };
    case "generated-file":
      await installGeneratedFile(resource, options.managedFile);
      return { present: true, matches: true };
    case "systemd-service":
      await installSystemdService(resource, runner);
      return { present: true, matches: true };
    case "custom-tool":
      await installCustomTool(resource, runner);
      return await inspectCustomTool(resource);
  }
}

/** Activate adopted services; other matching resources require no installation. */
export async function adoptResource(resource: ResolvedResource, runner: Runner): Promise<void> {
  if (resource.kind === "launch-agent") {
    await installLaunchAgent(resource, runner);
  } else if (resource.kind === "systemd-service") {
    await installSystemdService(resource, runner);
  }
}

/** Delegate removal or original-file restoration using the recorded ownership metadata. */
export async function removeResource(
  resource: ResolvedResource,
  runner: Runner,
  installedVersion?: string,
  originalFile?: OriginalFile,
  installedHash?: string,
): Promise<void> {
  switch (resource.kind) {
    case "package":
      await removePackage(resource, runner, installedVersion);
      return;
    case "symlink":
      await removeSymlink(resource);
      return;
    case "launch-agent":
      await removeLaunchAgent(resource, runner);
      return;
    case "generated-file":
      await removeGeneratedFile(resource, originalFile);
      return;
    case "systemd-service":
      await removeSystemdService(resource, runner);
      return;
    case "custom-tool":
      await removeCustomTool(resource, installedHash);
  }
}
