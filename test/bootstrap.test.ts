import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensurePrerequisites } from "../src/bootstrap.js";
import type { ResolvedConfig, Runner } from "../src/api/types.js";

const originalPath = process.env.PATH;
afterEach(() => { process.env.PATH = originalPath; });

function config(platform: "darwin" | "linux", resources: ResolvedConfig["resources"] = [], command?: string): ResolvedConfig {
  return {
    context: { machine: "test", hostname: "test", platform, home: "/home/test", configDir: "/project" },
    stateFile: "/unused",
    resources,
    ...(command ? { tasks: { test: { command } }, aliases: { t: "test" } } : {}),
  };
}

function recordingRunner(calls: Array<{ command: string; args: readonly string[] }>): Runner {
  return { report() {}, async run(command, args) {
    calls.push({ command, args });
    return { exitCode: 0, stdout: "", stderr: "" };
  } };
}

describe("prerequisite bootstrap", () => {
  it("finds existing executables on the default search path without running them", async () => {
    const root = await mkdtemp(join(tmpdir(), "workstation-path-"));
    try {
      const bin = join(root, ".local", "bin");
      await mkdir(bin, { recursive: true });
      await writeFile(join(bin, "mise"), "not executed", { mode: 0o755 });
      const base = config("linux", [{ kind: "package", manager: "mise", name: "node" }]);
      const calls: Array<{ command: string; args: readonly string[] }> = [];
      await ensurePrerequisites({ ...base, context: { ...base.context, home: root } }, recordingRunner(calls));
      expect(calls).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("installs Homebrew only for a macOS Homebrew resource", async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    let installed = false;
    const runner = recordingRunner(calls);
    const baseRun = runner.run.bind(runner);
    runner.run = async (...args) => { const result = await baseRun(...args); installed = true; return result; };
    await ensurePrerequisites(config("darwin", [{ kind: "package", manager: "brew", name: "jq" }]), runner,
      undefined, async (command) => command === "brew" && installed);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("/bin/bash");
    expect(calls[0]?.args.join(" ")).toContain("Homebrew/install");
  });

  it("installs mise, Node.js, and pinned pnpm for a pnpm task on a clean machine", async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    let miseInstalled = false;
    let nodeInstalled = false;
    let pnpmInstalled = false;
    const runner = recordingRunner(calls);
    const baseRun = runner.run.bind(runner);
    runner.run = async (command, args, options) => {
      const result = await baseRun(command, args, options);
      if (command === "/bin/sh") miseInstalled = true;
      if (args.includes("node@26.8.1")) nodeInstalled = true;
      if (args.includes("pnpm@12.3.4")) pnpmInstalled = true;
      return result;
    };
    await ensurePrerequisites(config("linux", [], "pnpm"), runner, "t", async (command) =>
      (command === "mise" && miseInstalled) || (command === "node" && nodeInstalled) || (command === "pnpm" && pnpmInstalled));
    expect(calls.map(({ command, args }) => [command, ...args])).toEqual([
      ["/bin/sh", "-c", "curl -fsSL https://mise.run | sh"],
      ["mise", "use", "--global", "node@26.8.1"],
      ["mise", "use", "--global", "pnpm@12.3.4"],
    ]);
  });

  it("does nothing when no selected resource or task needs the tools", async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    await ensurePrerequisites(config("linux"), recordingRunner(calls), undefined, async () => false);
    expect(calls).toEqual([]);
  });
});
