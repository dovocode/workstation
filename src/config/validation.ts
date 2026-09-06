import type { Resource } from "../api/types.js";
import { isFlatpakOptions, isPackageName } from "./package-options.js";

/** Validate a resource declaration before resolving paths or running backends. */
export function validateResource(value: unknown): asserts value is Resource {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Every configured resource must be an object, array, or falsey value");
  }
  const candidate = value as Record<string, unknown>;
  switch (candidate.kind) {
    case "package":
      if (
        !["mise", "brew", "brew-cask", "apt", "dnf", "yum", "pacman", "flatpak", "mas", "system"].includes(String(candidate.manager)) ||
        !isPackageName(candidate.manager, candidate.name) ||
        (candidate.flatpak !== undefined &&
          (!["flatpak", "system"].includes(String(candidate.manager)) || !isFlatpakOptions(candidate.flatpak))) ||
        (candidate.version !== undefined && typeof candidate.version !== "string") ||
        !isBrewCaskUpgradeOptions(candidate.upgrade)
      ) {
        throw new Error("Invalid package resource");
      }
      return;
    case "symlink":
      if (typeof candidate.source !== "string" || typeof candidate.target !== "string") {
        throw new Error("Invalid symlink resource");
      }
      return;
    case "launch-agent":
      if (
        typeof candidate.label !== "string" ||
        !/^[A-Za-z0-9.-]+$/.test(candidate.label) ||
        typeof candidate.program !== "string" ||
        (candidate.args !== undefined &&
          (!Array.isArray(candidate.args) ||
            !candidate.args.every((argument) => typeof argument === "string")))
      ) {
        throw new Error("Invalid LaunchAgent resource");
      }
      return;
    case "generated-file":
      if (
        typeof candidate.target !== "string" ||
        !["toml", "yaml", "json", "jsonc", "zsh", "bash"].includes(String(candidate.format)) ||
        !["update", "overwrite", "ignore"].includes(String(candidate.ifExists)) ||
        !isConfigValue(candidate.value) ||
        (candidate.renderedContent !== undefined &&
          (candidate.format !== "jsonc" || typeof candidate.renderedContent !== "string")) ||
        (["zsh", "bash"].includes(String(candidate.format)) &&
          typeof candidate.value !== "string") ||
        (candidate.mode !== undefined &&
          (typeof candidate.mode !== "number" ||
            !Number.isInteger(candidate.mode) ||
            candidate.mode < 0 ||
            candidate.mode > 0o777))
      ) {
        throw new Error("Invalid generated file resource");
      }
      return;
    case "custom-tool":
      if (
        typeof candidate.name !== "string" ||
        !/^[A-Za-z0-9_.-]+$/.test(candidate.name) ||
        typeof candidate.source !== "string" ||
        typeof candidate.target !== "string" ||
        !isCommandSpec(candidate.build)
      ) {
        throw new Error("Invalid custom tool resource");
      }
      return;
    case "systemd-service":
      if (
        typeof candidate.name !== "string" ||
        !/^[A-Za-z0-9_.@-]+(?:\.service)?$/.test(candidate.name) ||
        typeof candidate.program !== "string" ||
        !["user", "system"].includes(String(candidate.scope)) ||
        (candidate.restart !== undefined &&
          !["no", "on-failure", "always"].includes(String(candidate.restart))) ||
        (candidate.args !== undefined &&
          (!Array.isArray(candidate.args) ||
            !candidate.args.every((argument) => typeof argument === "string"))) ||
        (candidate.environment !== undefined && !isStringRecord(candidate.environment))
      ) {
        throw new Error("Invalid systemd service resource");
      }
      return;
    default:
      throw new Error(`Unknown resource kind: ${String(candidate.kind)}`);
  }
}

/** Check that a value consists only of supported finite JSON-like data. */
function isConfigValue(value: unknown): boolean {
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
function isStringRecord(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

/** Validate a direct command declaration, arguments, working directory, and environment. */
function isCommandSpec(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.command === "string" &&
    candidate.command.length > 0 &&
    (candidate.args === undefined ||
      (Array.isArray(candidate.args) && candidate.args.every((item) => typeof item === "string"))) &&
    (candidate.cwd === undefined || typeof candidate.cwd === "string") &&
    (candidate.environment === undefined || isStringRecord(candidate.environment))
  );
}

/** Validate the supported Homebrew upgrade option fields. */
function isBrewCaskUpgradeOptions(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const options = value as Record<string, unknown>;
  return (
    Object.keys(options).every((key) => key === "greedy" || key === "force") &&
    (options.greedy === undefined || typeof options.greedy === "boolean") &&
    (options.force === undefined || typeof options.force === "boolean")
  );
}
