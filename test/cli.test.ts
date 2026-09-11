import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ResolvedConfig } from "../src/api/types.js";

const config = vi.hoisted((): ResolvedConfig => ({
  context: { home: "/unused", configDir: "/unused", machine: "test", hostname: "test", platform: "linux" },
  stateFile: "/unused/state.json", resources: [{ kind: "package", manager: "mise", name: "node" }, { kind: "package", manager: "brew", name: "jq" }],
  tasks: { hello: { command: "echo", description: "Say hello" } }, aliases: { hi: "hello" },
}));
const mocks = vi.hoisted(() => ({
  find: vi.fn(async () => "/unused/config.ts"), load: vi.fn(),
  metadata: vi.fn(), bootstrap: vi.fn(), update: vi.fn(), init: vi.fn(async () => "/unused/config.ts"),
  lock: vi.fn(), plan: vi.fn(async () => []), apply: vi.fn(async () => []),
  task: vi.fn(async () => ({ exitCode: 7, stdout: "", stderr: "" })),
  status: vi.fn(async () => []), doctor: vi.fn(async () => []),
  history: vi.fn(async () => []), rollback: vi.fn(async () => []),
  write: vi.fn(), read: vi.fn(),
  afterApply: vi.fn(),
}));
vi.mock("../src/config/load.js", () => ({ findConfig: mocks.find, loadConfig: mocks.load }));
vi.mock("../src/index.js", () => ({ bundledApiMarker: true }));
vi.mock("../src/persistence/guard.js", () => ({ withRunLock: (_config: unknown, fn: () => unknown) => fn() }));
vi.mock("../src/persistence/claims.js", () => ({ claimResources: async () => {}, releaseUnusedClaims: async () => {} }));
vi.mock("../src/persistence/state.js", () => ({ readState: async () => ({ version: 1, machine: "test", resources: {} }) }));
vi.mock("../src/resources/package-metadata.js", () => ({ refreshPackageMetadata: mocks.metadata }));
vi.mock("../src/bootstrap.js", () => ({ ensurePrerequisites: mocks.bootstrap }));
vi.mock("../src/self-update.js", () => ({ selfUpdate: mocks.update }));
vi.mock("../src/config/init.js", () => ({ initConfig: mocks.init }));
vi.mock("../src/persistence/lock.js", () => ({ lockConfig: mocks.lock }));
vi.mock("../src/persistence/manifest.js", () => ({ manifestPath: () => "/unused/manifest.toml", writeManifest: mocks.write, readManifest: mocks.read }));
vi.mock("../src/reconciliation/plan.js", () => ({ createPlan: mocks.plan, orderDependencies: () => [] }));
vi.mock("../src/reconciliation/apply.js", () => ({ applyPlan: mocks.apply }));
vi.mock("../src/reconciliation/rollback.js", () => ({ listHistory: mocks.history, rollback: mocks.rollback }));
vi.mock("../src/diagnostics.js", () => ({ diagnose: mocks.doctor, inspectStatus: mocks.status }));
vi.mock("../src/resources/tasks.js", () => ({ runTask: mocks.task }));
vi.mock("../src/resources/hooks.js", () => ({ runAfterApply: mocks.afterApply }));
vi.mock("../src/resources/runner.js", () => ({ ProcessRunner: class { } }));
import { runCli } from "../src/cli/run.js";

const previousExitCode = process.exitCode;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(config);
  mocks.read.mockResolvedValue(config);
  mocks.lock.mockResolvedValue({ config, changed: false, path: "/unused/workstation.lock" });
  vi.spyOn(console, "log").mockImplementation(() => { });
  process.exitCode = 0;
});
afterEach(() => { vi.restoreAllMocks(); process.exitCode = previousExitCode; });

it("shows help and handles setup commands without loading configuration", async () => {
  await runCli([]);
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
  await runCli(["init"]);
  await runCli(["update"]);
  expect(mocks.init).toHaveBeenCalledOnce();
  expect(mocks.update).toHaveBeenCalledOnce();
  expect(mocks.find).not.toHaveBeenCalled();
});

it.each([["plan"], ["status"], ["doctor"], ["history"], ["--list-tasks"], ["lock", "update"], ["rollback", "123-456"]])(
  "dispatches read-only or metadata command %s without bootstrap",
  async (...args) => {
    await runCli(args);
    expect(mocks.bootstrap).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.afterApply).not.toHaveBeenCalled();
  },
);

it("builds only the re-read manifest and forwards frozen and removal controls", async () => {
  await runCli(["build", "--frozen-lockfile", "--no-remove"]);
  expect(mocks.bootstrap).toHaveBeenCalledOnce();
  expect(mocks.write).toHaveBeenCalledOnce();
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(mocks.lock).toHaveBeenCalledWith("/unused/config.ts", config, expect.anything(), { frozen: true });
  expect(mocks.apply).toHaveBeenCalledWith(config, expect.anything(), expect.any(Function), expect.any(Function), { noRemove: true });
  expect(mocks.afterApply).toHaveBeenCalledWith(config, expect.anything(), expect.any(Function));
  expect(mocks.afterApply.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.apply.mock.invocationCallOrder[0]!);
});

it("preserves task arguments and native failure status", async () => {
  await runCli(["hello", "--", "--help", "$(literal)"]);
  expect(mocks.task).toHaveBeenCalledWith(config, "hello", ["--help", "$(literal)"], expect.anything());
  expect(process.exitCode).toBe(7);
  expect(mocks.afterApply).not.toHaveBeenCalled();
});

it.each([["status", "extra"], ["doctor", "extra"], ["history", "extra"], ["rollback"], ["rollback", "123-456", "--invalid"], ["lock", "invalid"]])(
  "rejects invalid builtin arguments for %s before mutation",
  async (...args) => {
    await expect(runCli(args)).rejects.toThrow();
    expect(mocks.bootstrap).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  },
);

it.each([
  { ids: [], refresh: true },
  { ids: ["package:mise:node", "package:brew:jq"], refresh: ["package:mise:node", "package:brew:jq"] },
])("refreshes $refresh and applies the resolved manifest", async ({ ids, refresh }) => {
  const resolved = { ...config, stateFile: "/unused/resolved-state.json" };
  mocks.lock.mockResolvedValueOnce({ config: resolved, changed: true, path: "/unused/workstation.lock" });
  mocks.read.mockResolvedValueOnce(resolved);
  await runCli(["upgrade", ...ids, "--no-remove"]);
  expect(mocks.bootstrap).toHaveBeenCalledOnce();
  expect(mocks.metadata).toHaveBeenCalledExactlyOnceWith(config.resources, refresh, expect.anything());
  expect(mocks.metadata.mock.invocationCallOrder[0]).toBeLessThan(mocks.lock.mock.invocationCallOrder[0]!);
  expect(mocks.lock).toHaveBeenCalledExactlyOnceWith("/unused/config.ts", config, expect.anything(), { refresh });
  expect(mocks.write).toHaveBeenCalledWith("/unused/manifest.toml", resolved);
  expect(mocks.apply).toHaveBeenCalledWith(resolved, expect.anything(), expect.any(Function), expect.any(Function), { noRemove: true });
  expect(mocks.afterApply).toHaveBeenCalledWith(resolved, expect.anything(), expect.any(Function));
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.task).not.toHaveBeenCalled();
});

it("does not write a manifest or apply when upgrade resolution fails", async () => {
  mocks.lock.mockRejectedValueOnce(new Error("Version resolution failed"));
  await expect(runCli(["upgrade"])).rejects.toThrow("Version resolution failed");
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.apply).not.toHaveBeenCalled();
});

it.each(["build", "upgrade"])("skips hooks when %s reconciliation fails", async (command) => {
  mocks.apply.mockRejectedValueOnce(new Error("apply failed"));
  await expect(runCli([command])).rejects.toThrow("apply failed");
  expect(mocks.afterApply).not.toHaveBeenCalled();
});

it("reports hook failures without claiming success", async () => {
  mocks.afterApply.mockRejectedValueOnce(new Error("hook failed"));
  await expect(runCli(["build"])).rejects.toThrow("hook failed");
  expect(console.log).not.toHaveBeenCalledWith("Workstation is already converged.");
});

it("stops upgrade before resolving pins when metadata refresh fails", async () => {
  mocks.metadata.mockRejectedValueOnce(new Error("metadata unavailable"));
  await expect(runCli(["upgrade"])).rejects.toThrow("metadata unavailable");
  expect(mocks.lock).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.apply).not.toHaveBeenCalled();
});

it("does not refresh package metadata during an ordinary build", async () => {
  await runCli(["build"]);
  expect(mocks.metadata).not.toHaveBeenCalled();
});
