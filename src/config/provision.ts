import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { isCommandSpec } from "./value-validation.js";
import type { ProvisionResource } from "../api/provision.js";
import type { CommandSpec, Context } from "../api/types.js";

/** Shared validator for source configuration, manifests and saved state. */
export function isProvisionResource(value: unknown): value is ProvisionResource {
  if (!record(value) || value.kind !== "provision" || !name(value.name) || !record(value.operation)) return false;
  if (value.dependsOn !== undefined && !strings(value.dependsOn)) return false;
  const op = value.operation;
  switch (op.type) {
    case "brew-tap": return validTap(op);
    case "apt-repository": return validRepository(op);
    case "copy-file": return validCopy(op);
    case "macos-default": return validPreference(op);
    case "macos-installer": return validInstaller(op);
    case "linger": return name(op.user);
    case "group-member": return name(op.user) && name(op.group);
    case "service": return validService(op);
    case "check": return validCheck(op);
    default: return false;
  }
}
/** Recognize a plain validation record. */
function record(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
/** Recognize a literal string. */
function string(v: unknown): v is string { return typeof v === "string"; }
/** Require nonempty text without NUL bytes. */
function text(v: unknown): v is string { return string(v) && v.length > 0 && !v.includes("\0"); }
/** Require an option-safe resource or account identifier. */
function name(v: unknown): v is string { return text(v) && /^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/.test(v); }
/** Reject whitespace and metacharacters in repository fields. */
function token(v: unknown): v is string { return text(v) && /^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(v); }
/** Validate an array of nonempty strings. */
function strings(v: unknown): v is string[] { return Array.isArray(v) && v.every(text); }
/** Recognize a boolean without coercion. */
function boolean(v: unknown): v is boolean { return typeof v === "boolean"; }
/** Accept ordinary Unix permission bits only. */
function mode(v: unknown): boolean { return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 0o777; }
/** Validate a field only when supplied. */
function optional(v: unknown, check: (v: unknown) => boolean): boolean { return v === undefined || check(v); }
/** Allow credential-free HTTPS URLs only. */
function url(v: unknown): boolean { if (!text(v)) return false; try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; } }

/** Resolve filesystem inputs once so source changes participate in the declaration fingerprint. */
export async function resolveProvision(resource: ProvisionResource, context: Context): Promise<ProvisionResource> {
  /** Resolve home-relative destinations and config-relative source paths. */
  const path = (value: string, source = false) => resolve(value.replace(/^~(?=\/|$)/, context.home).startsWith("/") ? "/" : source ? context.configDir : context.home, value.replace(/^~(?=\/|$)/, context.home));
  /** Resolve command working directories without invoking a shell. */
  const command = (spec: CommandSpec): CommandSpec => ({ ...spec, command: spec.command.startsWith("~/") ? path(spec.command) : spec.command, cwd: spec.cwd ? (isAbsolute(spec.cwd) ? spec.cwd : path(spec.cwd, true)) : context.configDir });
  const op = resource.operation;
  if ((op.type.startsWith("macos-") || op.type === "brew-tap" || (op.type === "service" && op.manager === "launchd")) && context.platform !== "darwin") throw new Error(`${resource.name} requires macOS`);
  if (["apt-repository", "linger", "group-member"].includes(op.type) && context.platform !== "linux") throw new Error(`${resource.name} requires Linux`);
  if (op.type === "copy-file") return { ...resource, operation: { ...op, source: path(op.source, true), target: path(op.target), content: (await readFile(path(op.source, true))).toString("base64") } };
  if (op.type === "macos-installer") return { ...resource, operation: { ...op, installedPath: path(op.installedPath) } };
  if (op.type === "service" && op.plist) return { ...resource, operation: { ...op, plist: path(op.plist) } };
  if (op.type === "check") return { ...resource, operation: { ...op, check: command(op.check), repair: op.repair.map(command), ...(op.requiresFile ? { requiresFile: path(op.requiresFile) } : {}) } };
  return resource;
}

/** Validate the brew-tap operation payload. */
function validTap(op: Record<string, unknown>): boolean { return text(op.tap) && /^[\w-]+\/[\w-]+$/.test(op.tap) && optional(op.url, url) && optional(op.trust, boolean); }

/** Validate the apt-repository operation payload. */
function validRepository(op: Record<string, unknown>): boolean { return name(op.name) && url(op.uri) && token(op.suite) && strings(op.components) && op.components.length > 0 && op.components.every(token) && token(op.architecture) && url(op.keyUrl) && text(op.keySha256) && /^[A-Fa-f0-9]{64}$/.test(op.keySha256) && optional(op.conflicts, strings); }

/** Validate the copy-file operation payload. */
function validCopy(op: Record<string, unknown>): boolean { return text(op.source) && text(op.target) && optional(op.content, string) && optional(op.mode, mode) && optional(op.seed, boolean) && optional(op.migrateSymlink, boolean) && optional(op.privileged, boolean); }

/** Validate the macos-default operation payload. */
function validPreference(op: Record<string, unknown>): boolean { return text(op.domain) && text(op.key) && (typeof op.value === "boolean" || typeof op.value === "string" || (typeof op.value === "number" && Number.isSafeInteger(op.value))); }

/** Validate the macos-installer operation payload. */
function validInstaller(op: Record<string, unknown>): boolean { return url(op.url) && text(op.teamId) && /^[A-Z0-9]{10}$/.test(op.teamId) && text(op.installedPath) && optional(op.version, text) && optional(op.sha256, v => text(v) && /^[a-fA-F0-9]{64}$/.test(v)); }

/** Validate the service operation payload. */
function validService(op: Record<string, unknown>): boolean { return ["systemd", "launchd"].includes(String(op.manager)) && ["user", "system"].includes(String(op.scope)) && name(op.name) && (op.manager !== "launchd" || text(op.plist)) && optional(op.optionalSession, boolean); }

/** Validate the check operation payload. */
function validCheck(op: Record<string, unknown>): boolean { return isCommandSpec(op.check) && Array.isArray(op.repair) && op.repair.length > 0 && op.repair.every(v => isCommandSpec(v)) && optional(op.requiresFile, text) && optional(op.restartOnChange, boolean); }
