import { createHash } from "node:crypto";
import type { ResolvedResource } from "../api/types.js";

/** Stable ownership key. File-like resources share their destination as an identity. */
export function resourceId(resource: ResolvedResource): string {
  switch (resource.kind) {
    case "package":
      if (resource.manager === "flatpak") return `package:flatpak:${resource.flatpak?.scope ?? "user"}:${resource.name}:${resource.flatpak?.branch ?? "stable"}`;
      return `package:${resource.manager}:${resource.name}`;
    case "symlink":
      return `file:${resource.target}`;
    case "launch-agent":
      return `launch-agent:${resource.label}`;
    case "generated-file":
      return `file:${resource.target}`;
    case "systemd-service":
      return `systemd-service:${resource.scope}:${resource.name}`;
    case "custom-tool":
      return `file:${resource.target}`;
  }
}

/** SHA-256 of a declaration with object keys ordered consistently. Array order remains meaningful. */
export function fingerprint(resource: ResolvedResource): string {
  return createHash("sha256").update(stableJson(resource)).digest("hex");
}

/** Serialize values deterministically by sorting object keys while preserving array order. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
