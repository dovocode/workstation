import { buildConfiguration } from "../reconciliation/build.js";
import { resolve } from "node:path";
import { homedir, hostname, platform } from "node:os";
import { loadConfig, resolveConfig } from "../config/load.js";
import { lockConfig } from "../persistence/lock.js";
import { createPlan } from "../reconciliation/plan.js";
import { inspectStatus, diagnose } from "../diagnostics.js";
import { listHistory, rollback } from "../reconciliation/rollback.js";
import { runTask } from "../resources/tasks.js";
import { ProcessRunner } from "../resources/runner.js";
import type { Action, ConfigInput, Context, Runner } from "./types.js";

export interface WorkstationOptions {
  /** File to load, or the lock/state identity for an inline configuration. Defaults to ./workstation.config.ts. */
  readonly configPath?: string;
  /** Inline definition; no configuration file is loaded when supplied. */
  readonly config?: ConfigInput;
  /** Explicit context for inline definitions, useful for isolated tests and alternate home directories. */
  readonly context?: Context;
  readonly machine?: string;
  /** Injectable execution boundary. Defaults to a silent ProcessRunner. */
  readonly runner?: Runner;
  readonly onAction?: (action: Action) => void;
  readonly onProgress?: (message: string) => void;
}

/** Create an embedded client. Methods load fresh definitions, throw errors, and never exit the host process. */
export function createWorkstation(options: WorkstationOptions = {}) {
  const configPath = resolve(options.configPath ?? "workstation.config.ts");
  const runner = options.runner ?? new ProcessRunner();
  /** Resolve current declarations from memory or the selected entry point. */
  const configuration = async () => {
    if (options.config === undefined) {
      if (options.context) throw new Error("context requires an inline config");
      return loadConfig(configPath, options.machine);
    }
    const nativePlatform = platform();
    if (!options.context && nativePlatform !== "darwin" && nativePlatform !== "linux") throw new Error(`Unsupported platform: ${nativePlatform}`);
    const context: Context = options.context ?? {
      home: homedir(), configDir: resolve(configPath, ".."), hostname: hostname(),
      machine: options.machine ?? hostname().split(".")[0]!, platform: nativePlatform as Context["platform"],
    };
    return resolveConfig(options.config, context, configPath);
  };
  return {
    configuration,
    /** Read-only plan; managers must already be available. Does not install prerequisites or write locks. */
    async plan(settings: { readonly frozen?: boolean } = {}) {
      const locked = await lockConfig(configPath, await configuration(), runner, { ...settings, write: false });
      return createPlan(locked.config, runner, options.onProgress);
    },
    /** Install missing prerequisites, lock and apply configuration. */
    async build(settings: { readonly frozen?: boolean; readonly noRemove?: boolean } = {}) {
      return buildConfiguration(configPath, await configuration(), runner, { ...settings, ...(options.onAction ? { onAction: options.onAction } : {}), ...(options.onProgress ? { onProgress: options.onProgress } : {}) });
    },
    /** Refresh selected packages and reconcile through the same state transaction. */
    async upgrade(ids?: readonly string[]) { return buildConfiguration(configPath, await configuration(), runner, { refresh: ids ?? true }); },
    /** Refresh all pins or selected package resource IDs without installing packages. */
    async updateLock(ids?: readonly string[]) {
      return lockConfig(configPath, await configuration(), runner, { refresh: ids ?? true });
    },
    /** Inspect live resources against recorded pins. */
    async status() { return inspectStatus(await configuration(), runner); },
    /** Check command availability and report backend limitations. */
    async doctor() { return diagnose(await configuration()); },
    /** List recovery identifiers for this configuration. */
    async history() { return listHistory(await configuration()); },
    /** Preview rollback, or execute with apply: true. */
    async rollback(snapshot: string, settings: { readonly apply?: boolean } = {}) {
      return rollback(await configuration(), snapshot, runner, settings.apply ?? false);
    },
    /** Run a declared task without reconciling resources or bootstrapping tools. */
    async task(name: string, args: readonly string[] = []) { return runTask(await configuration(), name, args, runner); },
  };
}

/** Public embedded client inferred from the factory's typed methods. */
export type WorkstationClient = ReturnType<typeof createWorkstation>;
