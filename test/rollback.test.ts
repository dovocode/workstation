import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { ResolvedConfig, Runner } from "../src/api/types.js";
import { applyPlan } from "../src/reconciliation/apply.js";
import { listHistory, rollback } from "../src/reconciliation/rollback.js";
import { writeState } from "../src/persistence/state.js";
import { writeManifest } from "../src/persistence/manifest.js";
import { fingerprint, resourceId } from "../src/config/identity.js";

it("previews and restores managed updates while rejecting external edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "workstation-rollback-"));
  const file = join(root, "file");
  const config: ResolvedConfig = { context: { home: root, configDir: root, platform: "linux", machine: "test", hostname: "test" }, stateFile: join(root, "state.json"), resources: [{ kind: "generated-file", target: file, value: "old", format: "bash", ifExists: "overwrite" }] };
  const runner: Runner = { async run() { throw new Error("Unexpected command"); } };
  await applyPlan(config, runner);
  const updated: ResolvedConfig = { ...config, resources: [{ ...config.resources[0]!, kind: "generated-file", target: file, value: "new", format: "bash", ifExists: "overwrite" }] };
  await applyPlan(updated, runner);
  const snapshot = (await listHistory(config))[0]!;
  expect(await rollback(config, snapshot, runner)).toHaveLength(1);
  expect(await readFile(file, "utf8")).toBe("new\n");
  await writeFile(file, "external");
  await expect(rollback(config, snapshot, runner, true)).rejects.toThrow("externally edited");
  await writeFile(file, "new\n");
  await rollback(config, snapshot, runner, true);
  expect(await readFile(file, "utf8")).toBe("old\n");
});

it("preflights and applies an exact mise rollback without modifying source locks", async () => {
  const root = await mkdtemp(join(tmpdir(), "workstation-mise-rollback-"));
  const before = { kind: "package", manager: "mise", name: "node", version: "latest", lockedVersion: "1.0.0" } as const;
  const after = { ...before, lockedVersion: "2.0.0" };
  const id = resourceId(before);
  const config: ResolvedConfig = { context: { home: root, configDir: root, machine: "test", hostname: "test", platform: "linux" }, stateFile: join(root, "state.json"), resources: [after] };
  await writeState(join(root, "history/1-1/state.json"), { version: 1, machine: "test", resources: { [id]: { id, resource: before, fingerprint: fingerprint(before), owned: true } } });
  await writeManifest(join(root, "history/1-1/desired.toml"), config);
  await writeState(config.stateFile, { version: 1, machine: "test", resources: { [id]: { id, resource: after, fingerprint: fingerprint(after), owned: true } } });
  const installed = new Set(["node@2.0.0"]);
  const runner: Runner = { async run(command, args) {
    expect(command).toBe("mise");
    if (args[0] === "where") return { exitCode: installed.has(args[1]!) ? 0 : 1, stdout: "/installed", stderr: "" };
    if (args[0] === "latest") return { exitCode: 0, stdout: "1.0.0", stderr: "" };
    if (args[0] === "install") args.slice(1).forEach((spec) => installed.add(spec));
    else if (args[0] === "uninstall") args.slice(1).forEach((spec) => installed.delete(spec));
    else throw new Error(`Unexpected ${args.join(" ")}`);
    return { exitCode: 0, stdout: "", stderr: "" };
  } };
  expect(await rollback(config, "1-1", runner)).toHaveLength(1);
  expect([...installed]).toEqual(["node@2.0.0"]);
  await rollback(config, "1-1", runner, true);
  expect(installed.has("node@1.0.0")).toBe(true);
  expect(installed.has("node@2.0.0")).toBe(false);
});
