import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ResolvedConfig } from "../src/api/types.js";

const config = vi.hoisted((): ResolvedConfig => ({
  context: { home: "/unused", configDir: "/unused", machine: "test", hostname: "test", platform: "linux" },
  stateFile: "/unused/state.json", resources: [],
  tasks: { hello: { command: "echo", description: "Say hello" } }, aliases: { hi: "hello" },
}));
const mocks = vi.hoisted(() => ({
  find: vi.fn(async () => "/unused/config.ts"), load: vi.fn(),
  bootstrap: vi.fn(), update: vi.fn(), init: vi.fn(async () => "/unused/config.ts"),
  lock: vi.fn(), plan: vi.fn(async () => []), apply: vi.fn(async () => []),
  task: vi.fn(async () => ({ exitCode: 7, stdout: "", stderr: "" })),
  status: vi.fn(async () => []), doctor: vi.fn(async () => []),
  history: vi.fn(async () => []), rollback: vi.fn(async () => []),
  write: vi.fn(), read: vi.fn(),
}));
vi.mock("../src/config/load.js", () => ({ findConfig: mocks.find, loadConfig: mocks.load }));
vi.mock("../src/bootstrap.js", () => ({ ensurePrerequisites: mocks.bootstrap }));
vi.mock("../src/self-update.js", () => ({ selfUpdate: mocks.update }));
vi.mock("../src/config/init.js", () => ({ initConfig: mocks.init }));
vi.mock("../src/persistence/lock.js", () => ({ lockConfig: mocks.lock }));
vi.mock("../src/persistence/manifest.js", () => ({ manifestPath: () => "/unused/manifest.toml", writeManifest: mocks.write, readManifest: mocks.read }));
vi.mock("../src/reconciliation/plan.js", () => ({ createPlan: mocks.plan }));
vi.mock("../src/reconciliation/apply.js", () => ({ applyPlan: mocks.apply }));
vi.mock("../src/reconciliation/rollback.js", () => ({ listHistory: mocks.history, rollback: mocks.rollback }));
vi.mock("../src/diagnostics.js", () => ({ diagnose: mocks.doctor, inspectStatus: mocks.status }));
vi.mock("../src/resources/tasks.js", () => ({ runTask: mocks.task }));
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
  },
);

it("builds only the re-read manifest and forwards frozen and removal controls", async () => {
  await runCli(["build", "--frozen-lockfile", "--no-remove"]);
  expect(mocks.bootstrap).toHaveBeenCalledOnce();
  expect(mocks.write).toHaveBeenCalledOnce();
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(mocks.lock).toHaveBeenCalledWith("/unused/config.ts", config, expect.anything(), { frozen: true });
  expect(mocks.apply).toHaveBeenCalledWith(config, expect.anything(), expect.any(Function), expect.any(Function), { noRemove: true });
});

it("preserves task arguments and native failure status", async () => {
  await runCli(["hello", "--", "--help", "$(literal)"]);
  expect(mocks.task).toHaveBeenCalledWith(config, "hello", ["--help", "$(literal)"], expect.anything());
  expect(process.exitCode).toBe(7);
});

it.each([["status", "extra"], ["doctor", "extra"], ["history", "extra"], ["rollback"], ["rollback", "123-456", "--invalid"], ["lock", "invalid"]])(
  "rejects invalid builtin arguments for %s before mutation",
  async (...args) => {
    await expect(runCli(args)).rejects.toThrow();
    expect(mocks.bootstrap).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  },
);
