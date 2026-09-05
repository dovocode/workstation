import { isAbsolute, resolve } from "node:path";
import type { ConfigDefinition, Context, TaskDefinition } from "../api/types.js";

/** Validate tasks and aliases, resolving relative working directories against the entry point. */
export function resolveTasks(definition: ConfigDefinition, context: Context): {
  tasks: Record<string, TaskDefinition>; aliases: Record<string, string>;
} {
  const tasks: Record<string, TaskDefinition> = Object.create(null);
  const aliases: Record<string, string> = Object.create(null);
  for (const [name, value] of Object.entries(definition.tasks ?? {})) {
    validateName(name);
    if (!value || typeof value !== "object" || typeof value.command !== "string" || !value.command.trim() ||
        (value.args !== undefined && (!Array.isArray(value.args) || !value.args.every((arg) => typeof arg === "string"))) ||
        (value.cwd !== undefined && typeof value.cwd !== "string") ||
        (value.description !== undefined && typeof value.description !== "string") ||
        (value.environment !== undefined && (typeof value.environment !== "object" || value.environment === null ||
          Array.isArray(value.environment) || !Object.values(value.environment).every((item) => typeof item === "string")))) {
      throw new Error(`Invalid task: ${name}`);
    }
    const cwd = value.cwd?.replace(/^~(?=\/|$)/, context.home) ?? context.configDir;
    tasks[name] = { ...value, cwd: isAbsolute(cwd) ? cwd : resolve(context.configDir, cwd) };
  }
  for (const [name, target] of Object.entries(definition.aliases ?? {})) {
    validateName(name);
    if (Object.hasOwn(tasks, name)) throw new Error(`Task and alias share a name: ${name}`);
    if (typeof target !== "string") throw new Error(`Invalid alias target: ${name}`);
    aliases[name] = target;
  }
  for (const name of Object.keys(aliases)) resolveTaskName(name, tasks, aliases);
  return { tasks, aliases };
}

/** Follow task aliases, rejecting cycles and unknown targets. */
export function resolveTaskName(name: string, tasks: Readonly<Record<string, TaskDefinition>>, aliases: Readonly<Record<string, string>>): string {
  const visited = new Set<string>();
  let current = name;
  while (Object.hasOwn(aliases, current)) {
    if (visited.has(current)) throw new Error(`Task alias cycle: ${[...visited, current].join(" -> ")}`);
    visited.add(current);
    const target = aliases[current];
    if (target === undefined) throw new Error(`Invalid alias: ${current}`);
    current = target;
  }
  if (!Object.hasOwn(tasks, current)) throw new Error(`Unknown task: ${current}`);
  return current;
}

/** Keep task names distinct from flags and reserved CLI commands. */
function validateName(name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/.test(name) || name === "help" || name === "init") throw new Error(`Invalid or reserved task name: ${name}`);
}
