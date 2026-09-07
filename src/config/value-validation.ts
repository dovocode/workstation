import type { ConfigValue } from "../api/types.js";

/** Check that a value consists only of supported finite JSON-like data. */
export function isConfigValue(value: unknown): value is ConfigValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isConfigValue);
  return typeof value === "object" && value !== null && Object.values(value).every(isConfigValue);
}

/** Check that an object contains only string values. */
export function isStringRecord(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

/** Validate a direct command declaration, arguments, working directory, and environment. */
export function isCommandSpec(value: unknown, allowEmpty = false): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.command === "string" &&
    (allowEmpty || candidate.command.length > 0) &&
    (candidate.args === undefined ||
      (Array.isArray(candidate.args) && candidate.args.every((item) => typeof item === "string"))) &&
    (candidate.cwd === undefined || typeof candidate.cwd === "string") &&
    (candidate.environment === undefined || isStringRecord(candidate.environment))
  );
}

/** Validate the supported Homebrew upgrade option fields. */
export function isBrewCaskUpgradeOptions(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const options = value as Record<string, unknown>;
  return (
    Object.keys(options).every((key) => key === "greedy" || key === "force") &&
    (options.greedy === undefined || typeof options.greedy === "boolean") &&
    (options.force === undefined || typeof options.force === "boolean")
  );
}
