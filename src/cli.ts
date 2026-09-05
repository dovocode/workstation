import { findConfig, loadConfig } from "./config/load.js";
import { manifestPath, readManifest, writeManifest } from "./persistence/manifest.js";
import { applyPlan } from "./reconciliation/apply.js";
import { ProcessRunner } from "./resources/runner.js";
import { lockConfig } from "./persistence/lock.js";
import type { Action } from "./api/types.js";
import { runTask } from "./resources/tasks.js";

interface Options {
  readonly task?: string;
  readonly taskArgs: readonly string[];
  readonly listTasks: boolean;
  readonly config?: string;
  readonly machine?: string;
}

/** Load the entry point, update its lock and manifest, then reconcile the current machine. */
async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const sourcePath = await findConfig(options.config);
  const sourceConfig = await loadConfig(sourcePath, options.machine);
  const runner = new ProcessRunner();
  if (options.listTasks) {
    for (const [name, task] of Object.entries(sourceConfig.tasks ?? {})) console.log(`${name}${task.description ? `  ${task.description}` : ""}`);
    for (const [name, target] of Object.entries(sourceConfig.aliases ?? {})) console.log(`${name} -> ${target}`);
    return;
  }
  if (options.task) {
    const result = await runTask(sourceConfig, options.task, options.taskArgs, runner);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
    return;
  }
  const locked = await lockConfig(sourcePath, sourceConfig, runner);
  const outputPath = manifestPath(locked.config);
  await writeManifest(outputPath, locked.config);

  // Re-read the plain manifest so execution never relies on live TypeScript objects.
  const config = await readManifest(outputPath);
  const actions = await applyPlan(config, runner, printAction);
  console.log(`Lock: ${locked.path}${locked.changed ? " (updated)" : ""}`);
  console.log(`Manifest: ${outputPath}`);
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
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--list-tasks") {
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
  return { taskArgs, listTasks, ...(task ? { task } : {}), ...(config ? { config } : {}), ...(machine ? { machine } : {}) };
}

/** Read a required CLI option value or report the missing argument. */
function requireValue(args: readonly string[], index: number, option: string): string {
  const value = args[index];
  if (!value) throw new Error(`${option} requires a value`);
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

Options:
  --config PATH    Configuration entry point (default: workstation.config.ts)
  --machine NAME   Override the short hostname
  --list-tasks     List configured tasks and aliases
  -h, --help       Show this help`);
}

main().catch((error: unknown) => {
  console.error(`workstation: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
