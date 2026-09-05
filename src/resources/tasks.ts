import { resolveTaskName } from "../config/tasks.js";
import type { ResolvedConfig, Runner, CommandResult } from "../api/types.js";

/** Run one explicit task or alias, appending CLI arguments without shell interpolation. */
export async function runTask(config: ResolvedConfig, name: string, args: readonly string[], runner: Runner): Promise<CommandResult> {
  const tasks = config.tasks ?? {};
  const resolved = resolveTaskName(name, tasks, config.aliases ?? {});
  const task = tasks[resolved];
  if (!task) throw new Error(`Unknown task: ${resolved}`);
  return await runner.run(task.command, [...(task.args ?? []), ...args], {
    ...(task.cwd ? { cwd: task.cwd } : {}),
    ...(task.environment ? { environment: task.environment } : {}),
  });
}
