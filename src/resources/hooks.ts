import type { ResolvedConfig, Runner } from "../api/types.js";
import { requireSuccess } from "./shared.js";

/** Run post-apply commands sequentially, streaming output and stopping on the first failure. */
export async function runAfterApply(config: ResolvedConfig, runner: Runner, onProgress?: (message: string) => void): Promise<void> {
  for (const [index, hook] of (config.afterApply ?? []).entries()) {
    const label = `afterApply[${index}]: ${hook.description ?? hook.command}`;
    onProgress?.(`> ${label}`);
    try {
      await requireSuccess(runner, hook.command, hook.args ?? [], {
        cwd: hook.cwd ?? config.context.configDir,
        ...(hook.environment ? { environment: hook.environment } : {}),
        streamOutput: true,
      });
    } catch (cause) {
      throw new Error(`${label} failed; applied resources remain in place: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
  }
}
