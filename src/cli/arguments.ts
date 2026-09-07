/** Parsed invocation; task arguments remain literal and are not parsed as global flags. */
export interface Options {
  readonly plan: boolean;
  readonly frozen: boolean;
  readonly noRemove: boolean;
  readonly build: boolean;
  readonly init: boolean;
  readonly update: boolean;
  readonly verbose: boolean;
  readonly task?: string;
  readonly taskArgs: readonly string[];
  readonly listTasks: boolean;
  readonly config?: string;
  readonly machine?: string;
}

type MutableOptions = { -readonly [K in keyof Options]: Options[K] };
type CommandFlag = "plan" | "build" | "init" | "update";
const commandFlags = new Set<string>(["plan", "build", "init", "update"]);
const booleanFlags = new Map<string, "frozen" | "noRemove" | "verbose" | "listTasks">([
  ["--frozen-lockfile", "frozen"], ["--no-remove", "noRemove"],
  ["--verbose", "verbose"], ["-v", "verbose"], ["--list-tasks", "listTasks"],
]);

/** Parse flags without I/O; stop parsing at a task to preserve its literal arguments. */
export function parseArguments(args: readonly string[], display: { readonly help: () => never; readonly version: () => never }): Options {
  const options: MutableOptions = { plan: false, frozen: false, noRemove: false, build: false, init: false, update: false, verbose: false, listTasks: false, taskArgs: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--version") display.version();
    if (["help", "--help", "-h"].includes(argument)) display.help();
    if (consumeFlag(options, argument)) continue;
    if (argument === "--config" || argument === "--machine") {
      options[argument === "--config" ? "config" : "machine"] = requireValue(args, ++index, argument);
      continue;
    }
    consumeTask(options, argument, args.slice(index + 1));
    break;
  }
  validateInvocation(options);
  return options;
}

/** Consume boolean flags and reject repeated command selectors. */
function consumeFlag(options: MutableOptions, argument: string): boolean {
  const flag = booleanFlags.get(argument);
  if (flag) { options[flag] = true; return true; }
  if (!commandFlags.has(argument)) return false;
  const command = argument as CommandFlag;
  if (options[command]) throw new Error(`${command} may only be specified once`);
  options[command] = true;
  return true;
}

/** Reject active options from an incompatible group while keeping diagnostics stable. */
function rejectOptions(options: Options, keys: readonly (keyof Options)[], message: string): void {
  if (keys.some((key) => Boolean(options[key]))) throw new Error(message);
}

/** Enforce command-specific constraints after all global options have been parsed. */
function validateInvocation(options: Options): void {
  if (options.listTasks && options.task) throw new Error("--list-tasks cannot be combined with a task name");
  if (options.plan) rejectOptions(options, ["build", "init", "update", "task", "listTasks"], "plan cannot be combined with another command");
  if ((options.frozen || options.noRemove) && !options.build && !options.plan) throw new Error("Build options require build or plan");
  validateExclusiveCommands(options);
  if (!["build", "plan", "init", "update", "task", "listTasks"].some((key) => Boolean(options[key as keyof Options]))) throw new Error("Specify build to reconcile the workstation");
}

/** Validate commands whose accepted global options differ from build and plan. */
function validateExclusiveCommands(options: Options): void {
  if (options.init) rejectOptions(options, ["task", "listTasks", "machine", "update", "build"], "init supports only --config PATH and --help");
  if (options.update) rejectOptions(options, ["task", "listTasks", "machine", "config", "verbose", "build"], "update does not accept options or a task");
  if (options.build) rejectOptions(options, ["task", "listTasks"], "build cannot be combined with a task or --list-tasks");
}

/** Read a required option value, preserving the existing CLI value contract. */
function requireValue(args: readonly string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

/** Preserve all arguments after a task selector, stripping only its optional separator. */
function consumeTask(options: MutableOptions, argument: string, args: readonly string[]): void {
  if (!argument || argument.startsWith("-")) throw new Error(`Unknown argument: ${argument}`);
  options.task = argument;
  options.taskArgs = args[0] === "--" ? args.slice(1) : args;
}
