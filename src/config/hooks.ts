import { isAbsolute, resolve } from "node:path";
import { isCommandSpec } from "./value-validation.js";
import type { Context, TaskDefinition } from "../api/types.js";

/** Validate post-apply commands from configuration or a manifest and resolve working directories. */
export function resolveAfterApply(value: unknown, context: Context): TaskDefinition[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("afterApply must be an array of commands");
  return value.map((command: unknown, index) => {
    validateHook(command, index);
    const cwd = command.cwd?.replace(/^~(?=\/|$)/, context.home) ?? context.configDir;
    return {
      command: command.command,
      ...(command.args !== undefined ? { args: command.args } : {}),
      ...(command.environment !== undefined ? { environment: command.environment } : {}),
      ...(command.description !== undefined ? { description: command.description } : {}),
      cwd: isAbsolute(cwd) ? cwd : resolve(context.configDir, cwd),
    };
  });
}

/** Reject malformed hook data before any resource changes or process execution. */
function validateHook(value: unknown, index: number): asserts value is TaskDefinition {
  if (!isCommandSpec(value) || typeof value !== "object" || value === null ||
    !("command" in value) || typeof value.command !== "string" || !value.command.trim() ||
    ("description" in value && value.description !== undefined && typeof value.description !== "string")) {
    throw new Error(`Invalid afterApply command at index ${index}`);
  }
}
