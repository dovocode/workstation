import type { TaskDefinition } from "./types.js";

/** Declare a task command; arguments are passed directly without a shell.
 * @example tasks: { test: task("pnpm", ["test"], { description: "Run tests" }) }
 */
export function task(command: string, args: readonly string[] = [], options: Omit<TaskDefinition, "command" | "args"> = {}): TaskDefinition {
  return { command, args, ...options };
}
