import { findConfig, loadConfig } from "./config/load.js";
import { manifestPath, readManifest, writeManifest } from "./persistence/manifest.js";
import { applyPlan } from "./reconciliation/apply.js";
import { ProcessRunner } from "./resources/runner.js";
import { lockConfig } from "./persistence/lock.js";
import type { Action } from "./api/types.js";
import { runTask } from "./resources/tasks.js";
import { initConfig } from "./config/init.js";
import { ensurePrerequisites } from "./bootstrap.js";

interface Options {
  readonly init: boolean;
  readonly verbose: boolean;
  readonly task?: string;
  readonly taskArgs: readonly string[];
  readonly listTasks: boolean;
  readonly config?: string;
  readonly machine?: string;
}

/** Load the entry point, update its lock and manifest, then reconcile the current machine. */
async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (options.init) {
    const path = await initConfig(options.config);
    console.log(`Created ${path}`);
    console.log("Edit the configuration, then run workstation with the same --config path if provided.");
    console.log("No tools installed or setup applied. Make @dovocode/workstation available in your project for editor types and helper imports.");
    return;
  }
  const sourcePath = await findConfig(options.config);
  if (!options.listTasks && !options.task) console.log(`Loading configuration: ${sourcePath}`);
  const sourceConfig = await loadConfig(sourcePath, options.machine);
  const runner = new ProcessRunner({ progress: !options.listTasks, verbose: options.verbose });
  if (options.listTasks) {
    for (const [name, task] of Object.entries(sourceConfig.tasks ?? {})) console.log(`${name}${task.description ? `  ${task.description}` : ""}`);
    for (const [name, target] of Object.entries(sourceConfig.aliases ?? {})) console.log(`${name} -> ${target}`);
    return;
  }
  await ensurePrerequisites(sourceConfig, runner, options.task);
  if (options.task) {
    const result = await runTask(sourceConfig, options.task, options.taskArgs, new ProcessRunner({ progress: true, verbose: true }));
    process.exitCode = result.exitCode;
    return;
  }
  console.log(`Resolving package versions for ${sourceConfig.context.machine} (${sourceConfig.resources.length} resources)...`);
  const locked = await lockConfig(sourcePath, sourceConfig, runner);
  console.log(`Lock: ${locked.path}${locked.changed ? " (updated)" : " (unchanged)"}`);
  const outputPath = manifestPath(locked.config);
  await writeManifest(outputPath, locked.config);
  console.log(`Manifest: ${outputPath}`);

  // Re-read the plain manifest so execution never relies on live TypeScript objects.
  const config = await readManifest(outputPath);
  const actions = await applyPlan(config, runner, printAction, (message) => console.log(message));
  console.log(
    actions.length === 0
      ? "Workstation is already converged."
      : `Reconciled ${actions.length} action(s).`,
  );
}

/** Parse supported CLI flags and reject unknown arguments; help exits successfully. */
function parseArguments(args: readonly string[]): Options {
  let config: string | undefined;
  let machine: string | undefined;
  let task: string | undefined;
  let taskArgs: readonly string[] = [];
  let listTasks = false;
  let init = false;
  let verbose = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "init") {
      if (init) throw new Error("init may only be specified once");
      init = true;
    } else if (argument === "--verbose" || argument === "-v") {
      verbose = true;
    } else if (argument === "--list-tasks") {
      listTasks = true;
    } else if (argument && !argument.startsWith("-") && argument !== "help") {
      task = argument;
      taskArgs = args.slice(index + 1);
      if (taskArgs[0] === "--") taskArgs = taskArgs.slice(1);
      break;
    } else if (argument === "help" || argument === "--help" || argument === "-h") {
      help();
      process.exit(0);
    } else if (argument === "--config") {
      config = requireValue(args, ++index, "--config");
    } else if (argument === "--machine") {
      machine = requireValue(args, ++index, "--machine");
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (listTasks && task) throw new Error("--list-tasks cannot be combined with a task name");
  if (init && (task || listTasks || machine)) throw new Error("init supports only --config PATH and --help");
  return { init, verbose, taskArgs, listTasks, ...(task ? { task } : {}), ...(config ? { config } : {}), ...(machine ? { machine } : {}) };
}

/** Read a required CLI option value or report the missing argument. */
function requireValue(args: readonly string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

/** Print the action identity and reason before execution. */
function printAction(action: Action): void {
  console.log(`> ${action.type.padEnd(6)} ${action.id} (${action.reason})`);
}

/** Print CLI usage and supported options without loading configuration. */
function help(): void {
  console.log(`Usage: workstation [options] [task [--] args...]

Loads workstation.config.ts, updates workstation.lock, writes a resolved
config.toml, and reconciles it.

Commands:
  init            Create a starter configuration without applying it; never overwrite

Options:
  --config PATH    Configuration entry point (default: workstation.config.ts)
  --machine NAME   Override the short hostname
  --list-tasks     List configured tasks and aliases
  -v, --verbose    Also stream inspection and version-query output
  -h, --help       Show this help`);
}

main().catch((error: unknown) => {
  console.error(`workstation: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
