import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Runner } from "../src/api/types.js";

const commands = vi.hoisted(() => vi.fn<Runner["run"]>());
vi.mock("../src/resources/runner.js", () => ({ ProcessRunner: class { run = commands; } }));
vi.mock("../src/bootstrap.js", () => ({ ensurePrerequisites: vi.fn() }));
import { runCli } from "../src/cli/run.js";

const packages = [
  { name: "npm:@example/cli", version: "latest", spec: "@example/cli@latest" },
  { name: "npm:other-cli", version: "latest", spec: "other-cli@latest" },
  { name: "npm:t3[allow_builds=node-pty]", version: "nightly", spec: "t3@nightly" },
];
let root: string;
let configPath: string;
let registry: Map<string, string>;
let installed: Set<string>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "workstation-npm-upgrade-"));
  vi.stubEnv("HOME", root);
  configPath = join(root, "config.ts");
  registry = new Map(packages.map(({ spec }) => [spec, "1.0.0"]));
  installed = new Set();
  await writeFile(configPath, `export default ${JSON.stringify({
    stateFile: join(root, "state.json"),
    resources: packages.map(({ name, version }) => ({ kind: "package", manager: "mise", name, version })),
  })}`);
  commands.mockReset();
  commands.mockImplementation(async (command, args) => {
    if (command === "npm" && args[0] === "view") {
      const version = registry.get(args[1] ?? "");
      return version ? { exitCode: 0, stdout: JSON.stringify(version), stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "Registry unavailable" };
    }
    if (command === "mise") return simulateMise(args);
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  await runCli(["build", "--config", configPath]);
  registry = new Map(packages.map(({ spec }) => [spec, "2.0.0"]));
  commands.mockClear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it("upgrades all declared npm tools while build continues to respect existing pins", async () => {
  await runCli(["build", "--config", configPath]);
  expect(commands.mock.calls.every(([command, args]) => command === "mise" && args[0] === "where")).toBe(true);
  commands.mockClear();
  await runCli(["upgrade", "--config", configPath]);
  expect(commands.mock.calls.filter(([command]) => command === "npm").map(([, args]) => args)).toEqual(
    packages.map(({ spec }) => ["view", spec, "version", "--json"]),
  );
  expect(installed).toEqual(new Set(packages.map(({ name }) => `${name}@2.0.0`)));
  expect((await readFile(join(root, "workstation.lock"), "utf8")).match(/locked_version = "2.0.0"/g)).toHaveLength(3);
  commands.mockClear();
  await runCli(["upgrade", "--config", configPath]);
  expect(commands.mock.calls.some(([, args]) => args[0] === "install" || args[0] === "uninstall")).toBe(false);
});

it("limits npm upgrades to explicitly selected package IDs", async () => {
  await runCli(["upgrade", "package:mise:npm:@example/cli", "--config", configPath]);
  expect(commands.mock.calls.filter(([command]) => command === "npm").map(([, args]) => args)).toEqual([
    ["view", "@example/cli@latest", "version", "--json"],
  ]);
  expect(installed).toEqual(new Set(["npm:@example/cli@2.0.0", "npm:other-cli@1.0.0", "npm:t3[allow_builds=node-pty]@1.0.0"]));
});

it("preserves npm installations and the lock when registry refresh fails", async () => {
  const before = await readFile(join(root, "workstation.lock"), "utf8");
  registry.clear();
  await expect(runCli(["upgrade", "--config", configPath])).rejects.toThrow("Registry unavailable");
  expect(await readFile(join(root, "workstation.lock"), "utf8")).toBe(before);
  expect(installed).toEqual(new Set(packages.map(({ name }) => `${name}@1.0.0`)));
  expect(commands.mock.calls.every(([command]) => command === "npm")).toBe(true);
});

function simulateMise(args: readonly string[]) {
    if (args[0] === "where") {
      const spec = args[1] ?? "";
      return installed.has(spec) ? { exitCode: 0, stdout: join(root, "installs", spec.slice(spec.lastIndexOf("@") + 1)), stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "Not installed" };
    }
    if (args[0] === "install") {
      args.slice(1).forEach((spec) => installed.add(spec));
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "uninstall") {
      args.slice(1).forEach((spec) => installed.delete(spec));
      return { exitCode: 0, stdout: "", stderr: "" };
    }
  throw new Error(`Unexpected mise command: ${args.join(" ")}`);
}
