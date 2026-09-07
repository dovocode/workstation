import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { validateResource } from "../src/config/validation.js";
import { isCommandSpec, isConfigValue } from "../src/config/value-validation.js";
import { readState, writeState } from "../src/persistence/state.js";
import { fingerprint, resourceId } from "../src/config/identity.js";
import type { ResolvedResource } from "../src/api/types.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("preserves declaration versus legacy-state command validation", () => {
  expect(isCommandSpec({ command: "" })).toBe(false);
  expect(isCommandSpec({ command: "" }, true)).toBe(true);
  expect(isCommandSpec({ command: "echo", args: ["literal"], environment: { KEY: "value" } })).toBe(true);
  expect(isCommandSpec({ command: "echo", args: [1] })).toBe(false);
  expect(isConfigValue({ nested: [null, false, 1, "value"] })).toBe(true);
  expect(isConfigValue({ invalid: Infinity })).toBe(false);
});

it.each<ResolvedResource>([
  { kind: "launch-agent", label: "dev.example", program: "/usr/bin/true", args: ["one"] },
  { kind: "systemd-service", name: "example.service", program: "/usr/bin/true", scope: "user", args: [], restart: "on-failure", environment: { KEY: "value" } },
])("round-trips validated $kind state without invoking service managers", async (resource) => {
  validateResource(resource);
  const root = await mkdtemp(join(tmpdir(), "workstation-validation-"));
  roots.push(root);
  const path = join(root, "state.json");
  const id = resourceId(resource);
  const entry = { id, resource, owned: true, fingerprint: fingerprint(resource) };
  const state = { version: 1 as const, machine: "test", resources: { [id]: entry } };
  await writeState(path, state);
  expect(await readState(path, "test")).toEqual(state);
  const invalid = { ...resource, args: [12] } as unknown as ResolvedResource;
  await writeState(path, { ...state, resources: { [id]: { ...entry, resource: invalid, fingerprint: fingerprint(invalid) } } });
  await expect(readState(path, "test")).rejects.toThrow("invalid state");
});

it.each([
  { kind: "launch-agent", label: "../bad", program: "echo" },
  { kind: "launch-agent", label: "valid", program: "echo", args: [12] },
  { kind: "systemd-service", name: "test", program: "echo", scope: "invalid" },
  { kind: "systemd-service", name: "test", program: "echo", scope: "user", restart: "invalid" },
  { kind: "systemd-service", name: "test", program: "echo", scope: "user", environment: { BAD: 1 } },
])("rejects invalid service declaration %#", (resource) => {
  expect(() => validateResource(resource)).toThrow("Invalid");
});
