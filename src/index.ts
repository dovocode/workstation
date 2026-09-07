export { jsonc, JsoncDocument } from "./api/jsonc.js";
export { task } from "./api/tasks.js";
export { docker, sbx, microsandbox } from "./api/environments.js";
export type { EnvironmentTaskOptions, NestedWorkstationOptions } from "./api/environments.js";
export { createWorkstation } from "./api/client.js";
export type { WorkstationOptions, WorkstationClient } from "./api/client.js";
export { runTask } from "./resources/tasks.js";
export type { TaskDefinition } from "./api/types.js";
export type { JsoncCommand, JsoncLine } from "./api/jsonc.js";
export {
  configure,
  customTool,
  darwin,
  defineConfig,
  files,
  launchAgent,
  linux,
  machine,
  symlink,
  systemdService,
  tools,
  when,
} from "./api/config.js";
export type { GeneratedFileOptions } from "./api/config.js";
export { bash, renderShell, shell, zsh } from "./api/shell.js";
export type {
  Shell,
  ShellCommand,
  ShellCondition,
  ShellExpression,
  ShellFileOptions,
  ShellStatement,
  ShellValue,
} from "./api/shell.js";
export { loadConfig, resolveConfig, findConfig, fingerprint, resourceId } from "./config/load.js";
export { manifestPath, readManifest, writeManifest } from "./persistence/manifest.js";
export { lockConfig, lockPath } from "./persistence/lock.js";
export type { LockedConfigResult, LockOptions } from "./persistence/lock.js";
export { ProcessRunner } from "./resources/runner.js";
export { packageCapabilities } from "./resources/capabilities.js";
export type { PackageCapabilities } from "./resources/capabilities.js";
export { diagnose, inspectStatus } from "./diagnostics.js";
export type { ResourceStatus } from "./diagnostics.js";
export type {
  Action,
  ActionType,
  CommandResult,
  Platform,
  ResolvedResource,
  BrewCaskUpgradeOptions,
  FlatpakOptions,
  ConfigDefinition,
  ConfigFactory,
  ConfigInput,
  Context,
  ConfigValue,
  CommandSpec,
  CustomToolResource,
  GeneratedFileResource,
  IfExistsPolicy,
  LaunchAgentResource,
  OriginalFile,
  PackageManager,
  PackageResource,
  ResolvedConfig,
  ResolvedPackageResource,
  Resource,
  ResourceInput,
  Runner,
  RunOptions,
  StateEntry,
  StructuredFormat,
  SymlinkResource,
  SystemdScope,
  SystemdServiceResource,
  WorkstationConfig,
  WorkstationState,
} from "./api/types.js";
