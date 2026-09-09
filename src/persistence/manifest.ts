import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isConfigValue } from "../config/value-validation.js";
import { resolveAfterApply } from "../config/hooks.js";
import { dirname, resolve } from "node:path";
import { parse, stringify, type TomlTableWithoutBigInt } from "smol-toml";
import { requireTable, requireString } from "./validation.js";
import { isFlatpakOptions, isPackageName } from "../config/package-options.js";
import type {
  Context,
  CustomToolResource,
  GeneratedFileResource,
  LaunchAgentResource,
  PackageResource,
  ResolvedPackageResource,
  ResolvedConfig,
  ResolvedResource,
  SymlinkResource,
  SystemdServiceResource,
} from "../api/types.js";

const MANIFEST_VERSION = 1;

/** Return the resolved config.toml path beside the private ownership state. */
export function manifestPath(config: ResolvedConfig): string {
  return resolve(dirname(config.stateFile), "config.toml");
}

/** Write resolved declarations atomically as a private TOML manifest. */
export async function writeManifest(path: string, config: ResolvedConfig): Promise<void> {
  const document = {
    version: MANIFEST_VERSION,
    state_file: config.stateFile,
    context: {
      machine: config.context.machine,
      hostname: config.context.hostname,
      platform: config.context.platform,
      home: config.context.home,
      config_dir: config.context.configDir,
    },
    resources: config.resources.map(toTomlResource),
    ...(config.afterApply?.length ? { after_apply: config.afterApply.map((command) => ({ ...command })) } : {}),
  };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, stringify(document), { mode: 0o600 });
  await rename(temporary, path);
}

/** Read and validate a resolved manifest; reject unsupported schema versions. */
export async function readManifest(path: string): Promise<ResolvedConfig> {
  const document = parse(await readFile(path, "utf8"));
  if (document.version !== MANIFEST_VERSION) {
    throw new Error(`Unsupported workstation manifest version in ${path}`);
  }
  const stateFile = requireString(document.state_file, "state_file");
  const context = parseContext(requireTable(document.context, "context"));
  if (!Array.isArray(document.resources)) throw new Error("Manifest resources must be an array");
  const resources = document.resources.map((resource, index) =>
    parseResource(requireTable(resource, `resources[${index}]`)),
  );
  const afterApply = resolveAfterApply(document.after_apply, context);
  return { context, resources, stateFile, ...(afterApply.length ? { afterApply } : {}) };
}

/** Encode a resolved resource using the manifest's field names and JSON value payload. */
function toTomlResource(resource: ResolvedResource): TomlTableWithoutBigInt {
  switch (resource.kind) {
    case "package":
      return encodePackage(resource);
    case "symlink":
      return encodeSymlink(resource);
    case "launch-agent":
      return encodeLaunchAgent(resource);
    case "generated-file":
      return encodeGeneratedFile(resource);
    case "systemd-service":
      return encodeSystemdService(resource);
    case "custom-tool":
      return encodeCustomTool(resource);
  }
}

/** Validate and decode the machine and path context from a manifest. */
function parseContext(value: TomlTableWithoutBigInt): Context {
  const platform = requireString(value.platform, "context.platform");
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error(`Invalid manifest platform: ${platform}`);
  }
  return {
    machine: requireString(value.machine, "context.machine"),
    hostname: requireString(value.hostname, "context.hostname"),
    platform,
    home: requireString(value.home, "context.home"),
    configDir: requireString(value.config_dir, "context.config_dir"),
  };
}

/** Dispatch manifest decoding by resource kind and reject unknown kinds. */
function parseResource(value: TomlTableWithoutBigInt): ResolvedResource {
  const kind = requireString(value.kind, "resource.kind");
  if (kind === "package") return parsePackage(value);
  if (kind === "symlink") return parseSymlink(value);
  if (kind === "launch-agent") return parseLaunchAgent(value);
  if (kind === "generated-file") return parseGeneratedFile(value);
  if (kind === "systemd-service") return parseSystemdService(value);
  if (kind === "custom-tool") return parseCustomTool(value);
  throw new Error(`Unknown manifest resource kind: ${kind}`);
}

/** Validate and decode a generated file, including permissions and rendered JSONC content. */
function parseGeneratedFile(value: TomlTableWithoutBigInt): GeneratedFileResource {
  const format = requireString(value.format, "generated-file.format");
  if (value.rendered_content !== undefined && format !== "jsonc") {
    throw new Error("Pre-rendered content requires JSONC format");
  }
  const ifExists = requireString(value.if_exists, "generated-file.if_exists");
  if (!isGeneratedFormat(format)) throw new Error(`Invalid generated file format: ${format}`);
  if ((ifExists === "merge" && format !== "dotenv") || !["update", "overwrite", "ignore", "inject", "merge"].includes(ifExists)) {
    throw new Error(`Invalid generated file policy: ${ifExists}`);
  }
  const configValue: unknown = JSON.parse(requireString(value.value_json, "generated-file.value_json"));
  if (!isConfigValue(configValue)) throw new Error("Invalid generated file value");
  const mode = value.mode;
  if (
    mode !== undefined &&
    (typeof mode !== "number" || !Number.isInteger(mode) || mode < 0 || mode > 0o777)
  ) {
    throw new Error("generated-file.mode must be between 0 and 0777");
  }
  return {
    kind: "generated-file",
    target: requireString(value.target, "generated-file.target"),
    format,
    ifExists: ifExists as GeneratedFileResource["ifExists"],
    value: configValue,
    ...(value.rendered_content !== undefined
      ? { renderedContent: requireString(value.rendered_content, "generated-file.rendered_content") }
      : {}),
    ...(mode !== undefined ? { mode } : {}),
  };
}

/** Decode a custom tool and its resolved build command from the manifest. */
function parseCustomTool(value: TomlTableWithoutBigInt): CustomToolResource {
  const build = requireTable(value.build, "custom-tool.build");
  return {
    kind: "custom-tool",
    name: requireString(value.name, "custom-tool.name"),
    source: requireString(value.source, "custom-tool.source"),
    sourceHash: requireString(value.source_hash, "custom-tool.source_hash"),
    target: requireString(value.target, "custom-tool.target"),
    build: {
      command: requireString(build.command, "custom-tool.build.command"),
      ...(build.args !== undefined
        ? { args: requireStringArray(build.args, "custom-tool.build.args") }
        : {}),
      ...(build.cwd !== undefined
        ? { cwd: requireString(build.cwd, "custom-tool.build.cwd") }
        : {}),
      ...(build.environment !== undefined
        ? { environment: requireStringTable(build.environment, "custom-tool.build.environment") }
        : {}),
    },
  };
}

/** Validate scope and restart policy while decoding a systemd unit declaration. */
function parseSystemdService(value: TomlTableWithoutBigInt): SystemdServiceResource {
  const scope = requireString(value.scope, "systemd-service.scope");
  if (scope !== "user" && scope !== "system") throw new Error(`Invalid systemd scope: ${scope}`);
  const restart =
    value.restart === undefined ? undefined : requireString(value.restart, "systemd-service.restart");
  if (restart !== undefined && restart !== "no" && restart !== "on-failure" && restart !== "always") {
    throw new Error(`Invalid systemd restart policy: ${restart}`);
  }
  return {
    kind: "systemd-service",
    name: requireString(value.name, "systemd-service.name"),
    scope,
    program: requireString(value.program, "systemd-service.program"),
    ...(value.description !== undefined
      ? { description: requireString(value.description, "systemd-service.description") }
      : {}),
    ...(value.args !== undefined
      ? { args: requireStringArray(value.args, "systemd-service.args") }
      : {}),
    ...(value.environment !== undefined
      ? { environment: requireStringTable(value.environment, "systemd-service.environment") }
      : {}),
    ...(restart ? { restart } : {}),
    ...(value.wanted_by !== undefined
      ? { wantedBy: requireString(value.wanted_by, "systemd-service.wanted_by") }
      : {}),
  };
}

/** Validate the resolved package backend, selectors, pins, and cask upgrade options. */
function parsePackage(value: TomlTableWithoutBigInt): ResolvedPackageResource {
  const manager = requireString(value.manager, "package.manager");
  if (!isPackageManager(manager)) {
    throw new Error(`Invalid manifest package manager: ${manager}`);
  }
  if (!isPackageName(manager, value.name)) throw new Error(`Invalid ${manager} package ID`);
  if (value.flatpak !== undefined && (manager !== "flatpak" || !isFlatpakOptions(value.flatpak))) throw new Error("Invalid Flatpak options");
  if (manager === "mas" && value.locked_version !== undefined) throw new Error("mas does not support version pins");
  const upgrade = value.upgrade === undefined ? undefined : requireTable(value.upgrade, "package.upgrade");
  if (value.version !== undefined && manager !== "mise") {
    throw new Error(`Manifest ${manager} package cannot declare a version`);
  }
  if (upgrade !== undefined && manager !== "brew-cask") {
    throw new Error(`Manifest upgrade options require a Homebrew cask`);
  }
  return {
    kind: "package",
    manager,
    name: requireString(value.name, "package.name"),
    ...(isFlatpakOptions(value.flatpak) ? { flatpak: value.flatpak } : {}),
    ...(value.version !== undefined
      ? { version: requireString(value.version, "package.version") }
      : {}),
    ...(value.locked_version !== undefined
      ? { lockedVersion: requireString(value.locked_version, "package.locked_version") }
      : {}),
    ...parseUpgrade(upgrade),
  };
}

/** Decode a symlink's resolved source and destination. */
function parseSymlink(value: TomlTableWithoutBigInt): SymlinkResource {
  return {
    kind: "symlink",
    source: requireString(value.source, "symlink.source"),
    target: requireString(value.target, "symlink.target"),
  };
}

/** Decode a launchd label, executable, environment, and lifecycle options. */
function parseLaunchAgent(value: TomlTableWithoutBigInt): LaunchAgentResource {
  const args = value.args === undefined ? undefined : requireStringArray(value.args, "launch-agent.args");
  const environment =
    value.environment === undefined
      ? undefined
      : requireStringTable(value.environment, "launch-agent.environment");
  return {
    kind: "launch-agent",
    label: requireString(value.label, "launch-agent.label"),
    program: requireString(value.program, "launch-agent.program"),
    ...(args ? { args } : {}),
    ...(environment ? { environment } : {}),
    ...(value.run_at_load !== undefined
      ? { runAtLoad: requireBoolean(value.run_at_load, "launch-agent.run_at_load") }
      : {}),
    ...(value.keep_alive !== undefined
      ? { keepAlive: requireBoolean(value.keep_alive, "launch-agent.keep_alive") }
      : {}),
    ...(value.stdout_path !== undefined
      ? { stdoutPath: requireString(value.stdout_path, "launch-agent.stdout_path") }
      : {}),
    ...(value.stderr_path !== undefined
      ? { stderrPath: requireString(value.stderr_path, "launch-agent.stderr_path") }
      : {}),
  };
}

/** Require a boolean manifest field without coercion. */
function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  return value;
}

/** Require an array containing only strings. */
function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value;
}

/** Validate a TOML table of string-valued environment entries. */
function requireStringTable(value: unknown, field: string): Record<string, string> {
  const table = requireTable(value, field);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(table)) {
    if (typeof item !== "string") throw new Error(`${field} must contain strings`);
    result[key] = item;
  }
  return result;
}

/** Recognize concrete package backends accepted by a resolved manifest. */
function isPackageManager(value: string): value is PackageResource["manager"] {
  return value === "mise" || value === "brew" || value === "brew-cask" || value === "apt" || value === "dnf" || value === "yum" || value === "pacman" || value === "flatpak" || value === "mas";
}

/** Encode the package backend payload. */
function encodePackage(resource: Extract<ResolvedResource, { kind: "package" }>): TomlTableWithoutBigInt {
  return {
    kind: resource.kind,
    manager: resource.manager,
    name: resource.name,
    ...(resource.version ? { version: resource.version } : {}),
    ...(resource.lockedVersion ? { locked_version: resource.lockedVersion } : {}),
    ...(resource.flatpak ? {
      flatpak: {
        ...(resource.flatpak.scope ? { scope: resource.flatpak.scope } : {}),
        ...(resource.flatpak.remote ? { remote: resource.flatpak.remote } : {}),
        ...(resource.flatpak.branch ? { branch: resource.flatpak.branch } : {}),
      }
    } : {}),
    ...(resource.upgrade
      ? {
        upgrade: {
          ...(resource.upgrade.greedy !== undefined
            ? { greedy: resource.upgrade.greedy }
            : {}),
          ...(resource.upgrade.force !== undefined ? { force: resource.upgrade.force } : {}),
        },
      }
      : {}),
  };
}

/** Encode the symlink backend payload. */
function encodeSymlink(resource: Extract<ResolvedResource, { kind: "symlink" }>): TomlTableWithoutBigInt {
  return { kind: resource.kind, source: resource.source, target: resource.target };
}

/** Encode the launch-agent backend payload. */
function encodeLaunchAgent(resource: Extract<ResolvedResource, { kind: "launch-agent" }>): TomlTableWithoutBigInt {
  return {
    kind: resource.kind,
    label: resource.label,
    program: resource.program,
    ...(resource.args ? { args: [...resource.args] } : {}),
    ...(resource.environment ? { environment: { ...resource.environment } } : {}),
    ...(resource.runAtLoad !== undefined ? { run_at_load: resource.runAtLoad } : {}),
    ...(resource.keepAlive !== undefined ? { keep_alive: resource.keepAlive } : {}),
    ...(resource.stdoutPath ? { stdout_path: resource.stdoutPath } : {}),
    ...(resource.stderrPath ? { stderr_path: resource.stderrPath } : {}),
  };
}

/** Encode the generated-file backend payload. */
function encodeGeneratedFile(resource: Extract<ResolvedResource, { kind: "generated-file" }>): TomlTableWithoutBigInt {
  return {
    kind: resource.kind,
    target: resource.target,
    format: resource.format,
    if_exists: resource.ifExists,
    value_json: JSON.stringify(resource.value),
    ...(resource.renderedContent !== undefined ? { rendered_content: resource.renderedContent } : {}),
    ...(resource.mode !== undefined ? { mode: resource.mode } : {}),
  };
}

/** Encode the systemd-service backend payload. */
function encodeSystemdService(resource: Extract<ResolvedResource, { kind: "systemd-service" }>): TomlTableWithoutBigInt {
  return {
    kind: resource.kind,
    name: resource.name,
    scope: resource.scope,
    program: resource.program,
    ...(resource.description ? { description: resource.description } : {}),
    ...(resource.args ? { args: [...resource.args] } : {}),
    ...(resource.environment ? { environment: { ...resource.environment } } : {}),
    ...(resource.restart ? { restart: resource.restart } : {}),
    ...(resource.wantedBy ? { wanted_by: resource.wantedBy } : {}),
  };
}

/** Encode the custom-tool backend payload. */
function encodeCustomTool(resource: Extract<ResolvedResource, { kind: "custom-tool" }>): TomlTableWithoutBigInt {
  return {
    kind: resource.kind,
    name: resource.name,
    source: resource.source,
    source_hash: resource.sourceHash ?? "",
    target: resource.target,
    build: {
      command: resource.build.command,
      ...(resource.build.args ? { args: [...resource.build.args] } : {}),
      ...(resource.build.cwd ? { cwd: resource.build.cwd } : {}),
      ...(resource.build.environment
        ? { environment: { ...resource.build.environment } }
        : {}),
    },
  };
}

/** Narrow serialized format identifiers without accepting unknown renderers. */
function isGeneratedFormat(format: string): format is GeneratedFileResource["format"] {
  return ["toml", "yaml", "json", "jsonc", "zsh", "bash", "dotenv"].includes(format);
}

/** Decode optional cask upgrade flags while preserving false values. */
function parseUpgrade(upgrade: TomlTableWithoutBigInt | undefined): Pick<ResolvedPackageResource, "upgrade"> {
  return {
    ...(upgrade
      ? {
        upgrade: {
          ...(upgrade.greedy !== undefined
            ? { greedy: requireBoolean(upgrade.greedy, "package.upgrade.greedy") }
            : {}),
          ...(upgrade.force !== undefined
            ? { force: requireBoolean(upgrade.force, "package.upgrade.force") }
            : {}),
        },
      }
      : {}),
  };
}
