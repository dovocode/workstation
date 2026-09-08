import { parseArguments, type Options } from "./arguments.js";
import * as bundledApi from "../index.js";
import { findConfig, loadConfig } from "../config/load.js";
import { manifestPath, readManifest, writeManifest } from "../persistence/manifest.js";
import { applyPlan } from "../reconciliation/apply.js";
import { ProcessRunner } from "../resources/runner.js";
import { lockConfig } from "../persistence/lock.js";
import type { Action, ResolvedConfig, Runner } from "../api/types.js";
import { runTask } from "../resources/tasks.js";
import { initConfig } from "../config/init.js";
import { ensurePrerequisites } from "../bootstrap.js";
import { selfUpdate } from "../self-update.js";
import { createPlan } from "../reconciliation/plan.js";
import { listHistory, rollback } from "../reconciliation/rollback.js";
import { diagnose, inspectStatus } from "../diagnostics.js";
import metadata from "../../package.json" with { type: "json" };
import { commandHelp } from "../commands.js";

/** Load the entry point, update its lock and manifest, then reconcile the current machine. */
export async function runCli(args: readonly string[]): Promise<void> {
  if (args.length === 0) {
    help();
    return;
  }
  const options = parseArguments(args, {
    /** Print help and end the CLI without evaluating user configuration. */
    help: () => { help(); process.exit(0); },
    /** Print package metadata and end the CLI without evaluating configuration. */
    version: () => { console.log(metadata.version); process.exit(0); },
  });
  if (options.update) {
    await selfUpdate(new ProcessRunner({ progress: true, verbose: true }));
    return;
  }
  if (options.init) {
    const path = await initConfig(options.config);
    console.log(`Created ${path}`);
    console.log("Edit the configuration, then run workstation build with the same --config path if provided.");
    console.log("No tools installed or setup applied. Built-in helpers work without dependencies; install @dovocode/workstation only for local editor types or a pinned library version.");
    return;
  }
  const sourcePath = await findConfig(options.config);
  if (!options.listTasks && !options.task) console.log(`Loading configuration: ${sourcePath}`);
  const sourceConfig = await loadConfig(sourcePath, options.machine, bundledApi);
  const runner = new ProcessRunner({ progress: !options.listTasks, verbose: options.verbose });
  if (options.task === "lock") {
    await refreshLock(options, sourcePath, sourceConfig, runner);
    return;
  }
  if (options.task === "status" || options.task === "doctor") {
    await showDiagnostics(options, sourceConfig, runner);
    return;
  }
  if (options.task === "history") {
    await showHistory(options, sourceConfig);
    return;
  }
  if (options.task === "rollback") {
    await runRollback(options, sourceConfig, runner);
    return;
  }
  if (options.listTasks) {
    await showTasks(sourceConfig);
    return;
  }
  if (options.plan) {
    await showPlan(options, sourcePath, sourceConfig, runner);
    return;
  }
  await ensurePrerequisites(sourceConfig, runner, options.task);
  if (options.task) {
    const result = await runTask(sourceConfig, options.task, options.taskArgs, new ProcessRunner({ progress: true, verbose: true }));
    process.exitCode = result.exitCode;
    return;
  }
  await buildWorkstation(options, sourcePath, sourceConfig, runner);
}

/** Print the action identity and reason before execution. */
function printAction(action: Action): void {
  console.log(`> ${action.type.padEnd(6)} ${action.id} (${action.reason})`);
}

/** Print CLI usage and supported options without loading configuration. */
function help(): void {
  console.log(`Usage: workstation <command> [options]
       workstation <task> [--] [args...]

Loads workstation.config.ts, updates workstation.lock, writes a resolved
config.toml, and reconciles it.

Commands:
${commandHelp()}

Options:
  --version       Show the Workstation version without loading configuration
  --frozen-lockfile Reject missing or changed lock pins
  --no-remove     Reject plans containing resource removals
  --config PATH    Configuration entry point (default: workstation.config.ts)
  --machine NAME   Override the short hostname
  --list-tasks     List configured tasks and aliases
  -v, --verbose    Also stream inspection and version-query output
  -h, --help       Show this help`);
}

/** Handle the refreshLock CLI operation independently of top-level dispatch. */
async function refreshLock(options: Options, sourcePath: string, sourceConfig: ResolvedConfig, runner: Runner): Promise<void> {
  const [operation, ...ids] = options.taskArgs;
  if (operation !== "update") throw new Error("Usage: workstation [--config PATH] lock update [package:manager:name ...]");
  const result = await lockConfig(sourcePath, sourceConfig, runner, { refresh: ids.length ? ids : true });
  console.log(`Lock ${result.changed ? "updated" : "unchanged"}: ${result.path}. No packages installed.`);
}

/** Handle the showDiagnostics CLI operation independently of top-level dispatch. */
async function showDiagnostics(options: Options, sourceConfig: ResolvedConfig, runner: Runner): Promise<void> {
  if (options.taskArgs.length) throw new Error(`${options.task} accepts no arguments`);
  if (options.task === "doctor") {
    const messages = await diagnose(sourceConfig);
    messages.forEach((message) => console.log(message));
    if (messages.some((message) => message.startsWith("MISSING"))) process.exitCode = 1;
  } else {
    const statuses = await inspectStatus(sourceConfig, runner);
    statuses.forEach((entry) => console.log(`${entry.status}: ${entry.id}${entry.detail ? ` (${entry.detail})` : ""}`));
    console.log(`${statuses.filter((entry) => entry.status === "converged").length}/${statuses.length} resources converged.`);
    if (statuses.some((entry) => entry.status !== "converged")) process.exitCode = 1;
  }
}

/** Handle the showHistory CLI operation independently of top-level dispatch. */
async function showHistory(options: Options, sourceConfig: ResolvedConfig): Promise<void> {
  if (options.taskArgs.length) throw new Error("history accepts no arguments");
  const history = await listHistory(sourceConfig);
  console.log(history.join("\n") || "No recovery snapshots.");
}

/** Handle the runRollback CLI operation independently of top-level dispatch. */
async function runRollback(options: Options, sourceConfig: ResolvedConfig, runner: Runner): Promise<void> {
  const [snapshot, flag] = options.taskArgs;
  if (!snapshot || (flag !== undefined && flag !== "--apply") || options.taskArgs.length > 2) throw new Error("Usage: workstation [--config PATH] rollback RUN [--apply]");
  const actions = await rollback(sourceConfig, snapshot, runner, flag === "--apply");
  actions.forEach(printAction);
  console.log(`${flag === "--apply" ? "Rolled back" : "Rollback preview:"} ${actions.length} action(s).`);
}

/** Handle the showTasks CLI operation independently of top-level dispatch. */
async function showTasks(sourceConfig: ResolvedConfig): Promise<void> {
  for (const [name, task] of Object.entries(sourceConfig.tasks ?? {})) console.log(`${name}${task.description ? `  ${task.description}` : ""}`);
  for (const [name, target] of Object.entries(sourceConfig.aliases ?? {})) console.log(`${name} -> ${target}`);
}

/** Handle the showPlan CLI operation independently of top-level dispatch. */
async function showPlan(options: Options, sourcePath: string, sourceConfig: ResolvedConfig, runner: Runner): Promise<void> {
  const locked = await lockConfig(sourcePath, sourceConfig, runner, { write: false, frozen: options.frozen });
  const actions = await createPlan(locked.config, runner);
  actions.forEach(printAction);
  console.log(`Plan: ${actions.length} action(s). No changes applied.`);
}

/** Resolve and serialize declarations before applying the validated manifest. */
async function buildWorkstation(options: Options, sourcePath: string, sourceConfig: ResolvedConfig, runner: Runner): Promise<void> {
  console.log(`Resolving package versions for ${sourceConfig.context.machine} (${sourceConfig.resources.length} resources)...`);
  const locked = await lockConfig(sourcePath, sourceConfig, runner, options.upgrade
    ? { refresh: options.upgradeIds.length ? options.upgradeIds : true }
    : { frozen: options.frozen });
  console.log(`Package lock ${locked.changed ? "updated" : "unchanged"}.${options.verbose ? ` ${locked.path}` : ""}`);
  const outputPath = manifestPath(locked.config);
  await writeManifest(outputPath, locked.config);
  if (options.verbose) console.log(`Manifest: ${outputPath}`);

  // Re-read the plain manifest so execution never relies on live TypeScript objects.
  const config = await readManifest(outputPath);
  const actions = await applyPlan(config, runner, printAction, (message) => {
    if (!options.verbose && /^\s+(Inspect|Done):|^\s+Inspect removed declaration:/.test(message)) return;
    console.log(message);
  }, { noRemove: options.noRemove });
  console.log(
    actions.length === 0
      ? "Workstation is already converged."
      : `Reconciled ${actions.length} action(s).`,
  );
}
