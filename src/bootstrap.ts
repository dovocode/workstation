import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { resolveTaskName } from "./config/tasks.js";
import type { Platform, ResolvedConfig, Runner } from "./api/types.js";

const NODE_VERSION = "26.8.1";
const PNPM_VERSION = "12.3.4";

/** Install package managers and task runtimes required by this invocation. */
export async function ensurePrerequisites(
  config: ResolvedConfig,
  runner: Runner,
  taskName?: string,
  commandExists: (command: string) => Promise<boolean> = executableExists,
): Promise<void> {
  addKnownToolPaths(config.context.home, config.context.platform);

  const managers = new Set(config.resources.flatMap((resource) =>
    resource.kind === "package" ? [resource.manager] : []));
  const taskCommand = taskName === undefined ? undefined : selectedTaskCommand(config, taskName);
  const needsBrew = managers.has("brew") || managers.has("brew-cask");
  const needsNode = taskCommand === "node" || taskCommand === "npm" || taskCommand === "npx" || taskCommand === "pnpm";
  const needsPnpm = taskCommand === "pnpm";
  const needsMise = managers.has("mise") || needsNode;

  if (needsBrew && !await commandExists("brew")) {
    runner.report?.("Homebrew is required; installing it...");
    await requireSuccess(runner, "/bin/bash", ["-c",
      '/usr/bin/env NONINTERACTIVE=1 /bin/bash -c "$(/usr/bin/curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    ], "Homebrew installer");
    addKnownToolPaths(config.context.home, config.context.platform);
    if (!await commandExists("brew")) throw new Error("Homebrew installed but brew was not found on PATH");
  }

  if (needsMise && !await commandExists("mise")) {
    runner.report?.("mise is required; installing it...");
    await requireSuccess(runner, "/bin/sh", ["-c", "curl -fsSL https://mise.run | sh"], "mise installer");
    addKnownToolPaths(config.context.home, config.context.platform);
    if (!await commandExists("mise")) throw new Error("mise installed but was not found on PATH");
  }

  if (needsNode && !await commandExists("node")) {
    runner.report?.(`Node.js ${NODE_VERSION} is required by task ${taskName}; installing it with mise...`);
    await requireSuccess(runner, "mise", ["use", "--global", `node@${NODE_VERSION}`], "Node.js installation");
    if (!await commandExists("node")) throw new Error("Node.js installed but node was not found on PATH");
  }
  if (needsPnpm && !await commandExists("pnpm")) {
    runner.report?.(`pnpm ${PNPM_VERSION} is required by task ${taskName}; installing it with mise...`);
    await requireSuccess(runner, "mise", ["use", "--global", `pnpm@${PNPM_VERSION}`], "pnpm installation");
    if (!await commandExists("pnpm")) throw new Error("pnpm installed but was not found on PATH");
  }
}

/** Add default installation locations so tools installed during this process are immediately visible. */
export function addKnownToolPaths(home: string, platform: Platform): void {
  const candidates = [
    join(home, ".local", "bin"),
    join(home, ".local", "share", "mise", "shims"),
    "/home/linuxbrew/.linuxbrew/bin",
    join(home, ".linuxbrew", "bin"),
  ];
  if (platform === "darwin") candidates.push("/opt/homebrew/bin", "/usr/local/bin");
  const current = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  process.env.PATH = [...new Set([...candidates, ...current])].join(delimiter);
}

/** Check whether an executable is available without spawning it. */
async function executableExists(command: string): Promise<boolean> {
  if (command.includes("/")) return canExecute(command);
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory && await canExecute(join(directory, command))) return true;
  }
  return false;
}

/** Return the command behind a task or alias. */
function selectedTaskCommand(config: ResolvedConfig, name: string): string {
  const tasks = config.tasks ?? {};
  const resolved = resolveTaskName(name, tasks, config.aliases ?? {});
  return tasks[resolved]?.command ?? "";
}

/** Convert installer failures into concise actionable errors. */
async function requireSuccess(runner: Runner, command: string, args: readonly string[], label: string): Promise<void> {
  const result = await runner.run(command, args, { streamOutput: true });
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed (${result.exitCode})${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
  }
}

/** Test executable access while treating missing and inaccessible candidates alike. */
async function canExecute(path: string): Promise<boolean> {
  try {
    await access(path, 1);
    return true;
  } catch {
    return false;
  }
}
