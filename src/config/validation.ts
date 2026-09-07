import type { Resource } from "../api/types.js";
import { isConfigValue, isStringRecord, isCommandSpec, isBrewCaskUpgradeOptions } from "./value-validation.js";
import { isFlatpakOptions, isPackageName } from "./package-options.js";

/** Validate a resource declaration before resolving paths or running backends. */
export function validateResource(value: unknown): asserts value is Resource {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Every configured resource must be an object, array, or falsey value");
  }
  const candidate = value as Record<string, unknown>;
  switch (candidate.kind) {
    case "package": return validatePackage(candidate);
    case "symlink": return validateSymlink(candidate);
    case "launch-agent": return validateLaunchAgent(candidate);
    case "generated-file": return validateGeneratedFile(candidate);
    case "custom-tool": return validateCustomTool(candidate);
    case "systemd-service": return validateSystemdService(candidate);
    default:
      throw new Error(`Unknown resource kind: ${String(candidate.kind)}`);
  }
}

/** Validate declaration fields for package resources. */
function validatePackage(candidate: Record<string, unknown>): void {
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
}

/** Validate declaration fields for symlink resources. */
function validateSymlink(candidate: Record<string, unknown>): void {
  if (typeof candidate.source !== "string" || typeof candidate.target !== "string") {
    throw new Error("Invalid symlink resource");
  }
}

/** Validate declaration fields for launch-agent resources. */
function validateLaunchAgent(candidate: Record<string, unknown>): void {
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
}

/** Validate declaration fields for generated-file resources. */
function validateGeneratedFile(candidate: Record<string, unknown>): void {
  if (
    typeof candidate.target !== "string" ||
    !["toml", "yaml", "json", "jsonc", "zsh", "bash", "dotenv"].includes(String(candidate.format)) ||
    !["update", "overwrite", "ignore", "inject", "merge"].includes(String(candidate.ifExists)) ||
    (candidate.ifExists === "merge" && candidate.format !== "dotenv") ||
    !isConfigValue(candidate.value) ||
    (candidate.renderedContent !== undefined &&
      (candidate.format !== "jsonc" || typeof candidate.renderedContent !== "string")) ||
    (candidate.ifExists !== "inject" && ["zsh", "bash"].includes(String(candidate.format)) &&
      typeof candidate.value !== "string") ||
    (candidate.mode !== undefined &&
      (typeof candidate.mode !== "number" ||
        !Number.isInteger(candidate.mode) ||
        candidate.mode < 0 ||
        candidate.mode > 0o777))
  ) {
    throw new Error("Invalid generated file resource");
  }
}

/** Validate declaration fields for custom-tool resources. */
function validateCustomTool(candidate: Record<string, unknown>): void {
  if (
    typeof candidate.name !== "string" ||
    !/^[A-Za-z0-9_.-]+$/.test(candidate.name) ||
    typeof candidate.source !== "string" ||
    typeof candidate.target !== "string" ||
    !isCommandSpec(candidate.build)
  ) {
    throw new Error("Invalid custom tool resource");
  }
}

/** Validate declaration fields for systemd-service resources. */
function validateSystemdService(candidate: Record<string, unknown>): void {
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
}
