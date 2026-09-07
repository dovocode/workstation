import { hostname as readHostname, homedir, platform as readPlatform } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resourceId } from "./identity.js";
export { resourceId, fingerprint } from "./identity.js";
import { hashSource } from "./source-hash.js";
import { validateResource } from "./validation.js";
import { createJiti } from "jiti/static";
import { resolveTasks } from "./tasks.js";
import { detectLinuxManager } from "./system-manager.js";
import { isPackageName } from "./package-options.js";
import type {
  ConfigDefinition,
  ConfigInput,
  Context,
  PackageManager,
  ResolvedConfig,
  ResolvedResource,
  Resource,
  ResourceInput,
} from "../api/types.js";

const DEFAULT_CONFIG_FILE = "workstation.config.ts";

/** Resolve an explicit entry path, or find workstation.config.ts in the current directory. */
export async function findConfig(explicit?: string): Promise<string> {
  if (explicit) return resolve(explicit);
  const path = resolve(DEFAULT_CONFIG_FILE);
  try {
    await access(path);
    return path;
  } catch {
    throw new Error(`No configuration found (${DEFAULT_CONFIG_FILE})`);
  }
}

/** Load an absolute TypeScript entry path, evaluate fragments, and resolve paths without applying resources. */
export async function loadConfig(
  configPath: string,
  machineOverride?: string,
): Promise<ResolvedConfig> {
  const nativePlatform = readPlatform();
  if (nativePlatform !== "darwin" && nativePlatform !== "linux") {
    throw new Error(`Unsupported platform: ${nativePlatform}`);
  }

  const context: Context = {
    machine: machineOverride ?? readHostname().split(".")[0] ?? readHostname(),
    hostname: readHostname(),
    platform: nativePlatform,
    home: homedir(),
    configDir: dirname(configPath),
  };
  const jiti = createJiti(configPath);
  const imported: unknown = await jiti.import(configPath, { default: true });
  return resolveConfig(imported as ConfigInput, context, configPath);
}

/** Resolve an in-memory definition using an explicit context and persistence identity. Does not apply resources. */
export async function resolveConfig(input: ConfigInput, context: Context, configPath = resolve(context.configDir, DEFAULT_CONFIG_FILE)): Promise<ResolvedConfig> {
  const definitions = collectDefinitions(input, context);
  if (definitions.length === 0) {
    throw new Error(`${configPath} did not produce any configuration`);
  }
  const definition = mergeDefinitions(definitions);
  const inputs = definitions.flatMap((fragment) => [
    fragment.resources,
    fragment.machines?.[context.machine],
  ]);
  const resolved = await Promise.all(
    flatten(inputs).map((resource) => resolveResource(resource, definition, context)),
  );
  const resources = [...new Map(resolved.map((resource) => [resourceId(resource), resource])).values()];

  return {
    context,
    ...resolveTasks(definition, context),
    resources,
    stateFile: expandPath(
      definition.stateFile ?? `~/.local/state/workstation/configs/${createHash("sha256").update(resolve(configPath)).update("\0").update(context.machine).digest("hex").slice(0, 24)}/state.json`,
      context,
      false,
    ),
  };
}

/** Resolve platform managers and paths, and fingerprint custom-tool source trees. */
async function resolveResource(
  resource: Resource,
  definition: ConfigDefinition,
  context: Context,
): Promise<ResolvedResource> {
  if (resource.kind === "package") { return resolvePackage(resource, definition, context); }
  if (resource.kind === "symlink") {
    return {
      ...resource,
      source: expandPath(resource.source, context, true),
      target: expandPath(resource.target, context, false),
    };
  }
  if (resource.kind === "generated-file") {
    return { ...resource, target: expandPath(resource.target, context, false) };
  }
  if (resource.kind === "systemd-service") { return resolveSystemdService(resource, context); }
  if (resource.kind === "custom-tool") { return resolveCustomTool(resource, context); }
  if (context.platform !== "darwin") {
    throw new Error(`LaunchAgent ${resource.label} is only supported on macOS`);
  }
  return {
    ...resource,
    program: expandPath(resource.program, context, true),
    ...(resource.stdoutPath
      ? { stdoutPath: expandPath(resource.stdoutPath, context, false) }
      : {}),
    ...(resource.stderrPath
      ? { stderrPath: expandPath(resource.stderrPath, context, false) }
      : {}),
  };
}

/** Replace the system manager alias with the configured platform backend. */
async function resolveManager(
  manager: PackageManager,
  definition: ConfigDefinition,
  context: Context,
): Promise<Exclude<PackageManager, "system">> {
  if (manager !== "system") return manager;
  const configured = definition.managers?.[context.platform];
  if (configured !== undefined) return configured;
  return context.platform === "darwin" ? "brew" : await detectLinuxManager();
}

/** Expand home shorthand and resolve relative paths against home or the entry directory. */
function expandPath(path: string, context: Context, relativeToConfig: boolean): string {
  const expanded = path === "~" ? context.home : path.replace(/^~\//, `${context.home}/`);
  if (isAbsolute(expanded)) return resolve(expanded);
  return resolve(relativeToConfig ? context.configDir : context.home, expanded);
}

/** Flatten nested declarations while omitting disabled or absent entries. */
function flatten(input: ResourceInput): Resource[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.flatMap((item) => flatten(item));
  validateResource(input);
  return [input];
}

/** Require a non-array configuration object at the loading boundary. */
function validateDefinition(value: unknown): asserts value is ConfigDefinition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Configuration must resolve to an object");
  }
}

/** Evaluate and flatten configuration fragments in declaration order. */
function collectDefinitions(value: unknown, context: Context): ConfigDefinition[] {
  if (value === null || value === undefined || value === false) return [];
  if (typeof value === "function") {
    return collectDefinitions((value as (context: Context) => ConfigInput)(context), context);
  }
  if (Array.isArray(value)) {
    return value.flatMap((fragment) => collectDefinitions(fragment, context));
  }
  validateDefinition(value);
  return [value];
}

/** Merge manager and state-path settings; later declarations override earlier settings. */
function mergeDefinitions(definitions: readonly ConfigDefinition[]): ConfigDefinition {
  return definitions.reduce<ConfigDefinition>(
    (merged, fragment) => ({
      managers: { ...merged.managers, ...fragment.managers },
      tasks: { ...merged.tasks, ...fragment.tasks },
      aliases: { ...merged.aliases, ...fragment.aliases },
      ...(fragment.stateFile !== undefined
        ? { stateFile: fragment.stateFile }
        : merged.stateFile !== undefined
          ? { stateFile: merged.stateFile }
          : {}),
    }),
    {},
  );
}

/** Resolve package declarations with their platform and path constraints. */
async function resolvePackage(resource: Extract<Resource, { kind: "package" }>, definition: ConfigDefinition, context: Context): Promise<ResolvedResource> {
  const manager = await resolveManager(resource.manager, definition, context);
  validatePackageCompatibility(resource, manager, context);
  if (manager === "mise") {
    return { ...resource, manager, version: resource.version ?? "latest" };
  }
  if (resource.version !== undefined) {
    throw new Error(`${manager} package ${resource.name} cannot declare a version`);
  }
  return {
    ...resource, manager, ...(manager === "flatpak" ? {
      flatpak: {
        scope: resource.flatpak?.scope ?? "user", remote: resource.flatpak?.remote ?? "flathub", branch: resource.flatpak?.branch ?? "stable",
      }
    } : {})
  };
}

/** Resolve systemd-service declarations with their platform and path constraints. */
async function resolveSystemdService(resource: Extract<Resource, { kind: "systemd-service" }>, context: Context): Promise<ResolvedResource> {
  if (context.platform !== "linux") {
    throw new Error(`systemd service ${resource.name} is only supported on Linux`);
  }
  return {
    ...resource,
    name: resource.name.endsWith(".service") ? resource.name : `${resource.name}.service`,
    program: expandPath(resource.program, context, true),
  };
}

/** Resolve custom-tool declarations with their platform and path constraints. */
async function resolveCustomTool(resource: Extract<Resource, { kind: "custom-tool" }>, context: Context): Promise<ResolvedResource> {
  const source = expandPath(resource.source, context, true);
  const target = expandPath(resource.target, context, false);
  return {
    ...resource,
    source,
    target,
    sourceHash: await hashSource(source),
    build: {
      ...resource.build,
      ...(resource.build.cwd && !resource.build.cwd.includes("{")
        ? { cwd: expandPath(resource.build.cwd, context, true) }
        : {}),
    },
  };
}

/** Check backend-specific options and OS support before resolving a package declaration. */
function validatePackageCompatibility(resource: Extract<Resource, { kind: "package" }>, manager: PackageManager, context: Context): void {
  if (!isPackageName(manager, resource.name)) throw new Error(`Invalid ${manager} package ID: ${resource.name}`);
  if ((manager === "pacman" || manager === "flatpak") && context.platform !== "linux") throw new Error(`${manager} requires Linux`);
  if (manager === "mas" && context.platform !== "darwin") throw new Error("mas requires macOS");
  if (resource.flatpak !== undefined && manager !== "flatpak") throw new Error(`Flatpak options require the flatpak backend (${resource.name})`);
  if (resource.upgrade !== undefined && manager !== "brew-cask") {
    throw new Error(`Upgrade options are only supported for Homebrew casks (${resource.name})`);
  }
}
