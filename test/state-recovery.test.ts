import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { files, fingerprint, resourceId, type ResolvedConfig, type Runner } from "../src/index.js";
import { journalIntent, recoverJournal } from "../src/persistence/journal.js";
import { readState } from "../src/persistence/state.js";
import { withRunLock } from "../src/persistence/guard.js";
import { claimResources } from "../src/persistence/claims.js";

const runner: Runner = { async run() { throw new Error("Unexpected command"); } };
async function fixture(): Promise<ResolvedConfig> {
  const home = await mkdtemp(join(tmpdir(), "workstation-recovery-"));
  return { context: { home, configDir: home, machine: "test", hostname: "test", platform: "linux" }, resources: [], stateFile: join(home, "state/state.json") };
}
it("recovers a created file's ownership after mutation but before checkpoint", async () => {
  const config = await fixture();
  const resource = files.json(join(config.context.home, "file"), { ok: true });
  await journalIntent(config, [{ id: resourceId(resource), fingerprint: fingerprint(resource), resource, owned: true }]);
  await writeFile(resource.target, '{\n  "ok": true\n}\n', { mode: 0o644 });
  await recoverJournal(config, runner);
  expect((await readState(config.stateFile, "test")).resources[resourceId(resource)]?.owned).toBe(true);
});
it("preserves ambiguous interrupted creations and refuses to adopt them", async () => {
  const config = await fixture();
  const resource = files.json(join(config.context.home, "file"), { ok: true });
  await journalIntent(config, [{ id: resourceId(resource), fingerprint: fingerprint(resource), resource, owned: true }]);
  await writeFile(resource.target, "external contents");
  await expect(recoverJournal(config, runner)).rejects.toThrow("ambiguous contents");
  expect(await readFile(resource.target, "utf8")).toBe("external contents");
});
it("serializes separate invocations but permits nested operations under one owner", async () => {
  const config = await fixture();
  let release!: () => void;
  let acquired!: () => void;
  const ready = new Promise<void>(resolve => { acquired = resolve; });
  const first = withRunLock(config, async () => {
    await withRunLock(config, async () => {});
    acquired();
    await new Promise<void>(resolve => { release = resolve; });
  });
  await ready;
  await expect(withRunLock(config, async () => {})).rejects.toThrow("Another Workstation run");
  release(); await first;
  await withRunLock(config, async () => {});
});
it("rejects competing configuration claims without transferring ownership", async () => {
  const config = await fixture();
  const resources = [files.json(join(config.context.home, "file"), {})];
  await withRunLock(config, () => claimResources({ ...config, resources }));
  await expect(withRunLock(config, () => claimResources({ ...config, resources, stateFile: join(config.context.home, "other/state.json") }))).rejects.toThrow("already registered");
});
