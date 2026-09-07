import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stringify } from "smol-toml";
import type { CommandResult, ResolvedPackageResource, Runner, RunOptions, ResolvedConfig } from "../src/api/types.js";
import { inspectMiseCask } from "../src/resources/mise-cask.js";
import { installResource } from "../src/resources/dispatch.js";
import { applyPlan } from "../src/reconciliation/apply.js";
import { readState } from "../src/persistence/state.js";

const resource: ResolvedPackageResource = { kind: "package", manager: "brew-cask", name: "ghostty", lockedVersion: "1.3.1" };

/** Create a realistic mise cask with an external app and completion link. */
async function fixture(available = "1.3.1") {
  const root = await mkdtemp(join(tmpdir(), "workstation-mise-cask-"));
  const cask = join(root, "Caskroom", "ghostty");
  const app = join(root, "Applications", "Ghostty.app");
  const version = join(cask, "1.3.1");
  const completion = join(root, "completion");
  await mkdir(version, { recursive: true });
  await mkdir(app, { recursive: true });
  await writeFile(join(app, "contents"), "original app");
  await writeFile(join(version, "completion"), "original completion");
  await symlink(join(version, "completion"), completion);
  await symlink(app, join(version, "Ghostty.app"));
  const receipt = {
    schema_version: 3, version: "1.3.1", apps: [app], completions: [completion],
    binaries: [], fonts: [], flight_directories: [], generic: [], pkg_ids: []
  };
  await writeFile(join(version, ".mise-cask.toml"), stringify(receipt));
  let installed: string | null = null;
  let failInstall = false;
  const calls: Array<{ command: string; args: readonly string[]; options: RunOptions | undefined }> = [];
  const messages: string[] = [];
  const runner: Runner = {
    report: (message) => { messages.push(message); },
    async run(command, args, options): Promise<CommandResult> {
      calls.push({ command, args, options });
      const ok = (stdout = ""): CommandResult => ({ exitCode: 0, stdout, stderr: "" });
      if (command === "/usr/bin/ditto" && args[0] && args[1]) {
        await cp(args[0], args[1], { recursive: true });
        return ok();
      }
      if (command !== "brew") throw new Error(`Unexpected command ${command}`);
      if (args[0] === "--caskroom") return ok(cask);
      if (args[0] === "list") return ok("ghostty");
      if (args[0] === "info") return ok(JSON.stringify({ casks: [{ version: available, installed }] }));
      if (args[0] === "install") {
        return simulateInstall();
      }
      throw new Error(`Unexpected brew arguments: ${args.join(" ")}`);
    },
  };
  /** Simulate installation and artifact loss independently from query responses. */
  async function simulateInstall(): Promise<CommandResult> {
    await expect(lstat(cask)).rejects.toMatchObject({ code: "ENOENT" });
    await mkdir(cask);
    if (failInstall) {
      // Homebrew may remove adopted artifacts during rollback.
      await rm(app, { recursive: true });
      await rm(completion);
      return { exitCode: 1, stdout: "", stderr: "artifact installation failed" };
    }
    installed = available;
    return { exitCode: 0, stdout: "", stderr: "" };
  }
  return {
    root, cask, app, version, completion, receipt, runner, calls, messages,
    fail: () => { failInstall = true; }, installed: () => { installed = "1.3.1"; }
  };
}

describe("mise cask migration", () => {
  it("allows staged binary links into validated apps but rejects unrelated destinations", async () => {
    const f = await fixture();
    const binary = join(f.root, "bin-link");
    const staged = join(f.version, "cli");
    await symlink(join(f.app, "contents"), staged);
    await symlink(staged, binary);
    await writeFile(join(f.version, ".mise-cask.toml"), stringify({ ...f.receipt, binaries: [binary] }));
    expect(await inspectMiseCask(resource, f.runner)).toMatchObject({ links: expect.arrayContaining([{ path: binary, target: staged }]) });
    await rm(staged);
    const unrelated = join(f.root, "unrelated");
    await writeFile(unrelated, "external");
    await symlink(unrelated, staged);
    expect(await inspectMiseCask(resource, f.runner)).toBeUndefined();
  });

  it("migrates binary-only casks and restores links changed by a failed install", async () => {
    const f = await fixture();
    const binary = join(f.root, "op");
    const original = join(f.version, "op");
    await writeFile(original, "original binary");
    await symlink(original, binary);
    await writeFile(join(f.version, ".mise-cask.toml"), stringify({ ...f.receipt, apps: [], binaries: [binary] }));
    expect(await inspectMiseCask(resource, f.runner)).toMatchObject({ apps: [], fonts: [], links: expect.arrayContaining([{ path: binary, target: original }]) });
    f.fail();
    const runner: Runner = {
      ...f.runner, async run(command, args, options) {
        if (command === "brew" && args[0] === "install") {
          await rm(binary);
          await symlink(join(f.cask, "new-layout", "op"), binary);
        }
        return f.runner.run(command, args, options);
      }
    };
    await expect(installResource(resource, runner)).rejects.toThrow("Mise staging restored");
    expect(await readFile(binary, "utf8")).toBe("original binary");
  });

  it("recognizes and adopts copied mise fonts, retaining backups and adopted ownership", async () => {
    const f = await fixture();
    const font = join(f.root, "Library", "Fonts", "Test.ttf");
    await mkdir(join(f.root, "Library", "Fonts"), { recursive: true });
    await writeFile(font, "original font");
    await writeFile(join(f.version, "Test.ttf"), "original font");
    await writeFile(join(f.version, ".mise-cask.toml"), stringify({ ...f.receipt, apps: [], fonts: [font] }));
    expect(await inspectMiseCask(resource, f.runner)).toMatchObject({ apps: [], fonts: [font] });
    const config: ResolvedConfig = {
      context: { machine: "test", hostname: "test", platform: "darwin", home: f.root, configDir: f.root },
      stateFile: join(f.root, "state.json"), resources: [resource]
    };
    expect((await applyPlan(config, f.runner))[0]?.reason).toBe("migrate from mise to Homebrew");
    expect(f.calls.find(({ args }) => args[0] === "install")?.args).toEqual(["install", "--cask", "--adopt", "ghostty"]);
    expect((await readState(config.stateFile, "test")).resources["package:brew-cask:ghostty"]?.owned).toBe(false);
    const backup = (await readdir(f.root)).find((name) => name.startsWith(".workstation-mise-"));
    if (!backup) throw new Error("Expected migration backup");
    expect(await readFile(join(f.root, backup, "font-0"), "utf8")).toBe("original font");
  });

  it("restores missing fonts when Homebrew rolls back a failed migration", async () => {
    const f = await fixture();
    const font = join(f.root, "Library", "Fonts", "Test.otf");
    await mkdir(join(f.root, "Library", "Fonts"), { recursive: true });
    await writeFile(font, "original font");
    await writeFile(join(f.version, "Test.otf"), "original font");
    await writeFile(join(f.version, ".mise-cask.toml"), stringify({ ...f.receipt, apps: [], fonts: [font] }));
    f.fail();
    const runner: Runner = {
      ...f.runner, async run(command, args, options) {
        if (command === "brew" && args[0] === "install") await rm(font);
        return f.runner.run(command, args, options);
      }
    };
    await expect(installResource(resource, runner)).rejects.toThrow("Mise staging restored");
    expect(await readFile(font, "utf8")).toBe("original font");
    expect(await readFile(join(f.version, "Test.otf"), "utf8")).toBe("original font");
  });

  it("rejects changed font copies, symlinks and paths outside font directories", async () => {
    const f = await fixture();
    const font = join(f.root, "Library", "Fonts", "Test.ttf");
    await mkdir(join(f.root, "Library", "Fonts"), { recursive: true });
    await writeFile(font, "changed font");
    await writeFile(join(f.version, "Test.ttf"), "original font");
    await writeFile(join(f.version, ".mise-cask.toml"), stringify({ ...f.receipt, apps: [], fonts: [font] }));
    expect(await inspectMiseCask(resource, f.runner)).toBeUndefined();
    await rm(font);
    await symlink(join(f.version, "Test.ttf"), font);
    expect(await inspectMiseCask(resource, f.runner)).toBeUndefined();
    await writeFile(join(f.version, ".mise-cask.toml"), stringify({ ...f.receipt, apps: [], fonts: [join(f.version, "Test.ttf")] }));
    expect(await inspectMiseCask(resource, f.runner)).toBeUndefined();
    expect(f.calls.every(({ args }) => args[0] === "--caskroom")).toBe(true);
  });

  it("installs the requested version when the mise version differs", async () => {
    const f = await fixture("1.3.2");
    await expect(installResource({ ...resource, lockedVersion: "1.3.2" }, f.runner)).resolves.toMatchObject({ installedVersion: "1.3.2" });
    expect(f.calls.find(({ args }) => args[0] === "install")?.args).toEqual(["install", "--cask", "--force", "ghostty"]);
  });

  it("migrates a matching app and retains its backup and adopted ownership", async () => {
    const f = await fixture();
    const config: ResolvedConfig = {
      context: { machine: "test", hostname: "test", platform: "darwin", home: f.root, configDir: f.root },
      stateFile: join(f.root, "state.json"), resources: [resource]
    };
    const actions = await applyPlan(config, f.runner);
    expect(actions[0]?.reason).toBe("migrate from mise to Homebrew");
    expect(f.calls.find(({ args }) => args[0] === "install")).toMatchObject({
      args: ["install", "--cask", "--adopt", "ghostty"],
      options: { environment: { HOMEBREW_NO_AUTO_UPDATE: "1" } },
    });
    expect(await readFile(join(f.app, "contents"), "utf8")).toBe("original app");
    const state = await readState(config.stateFile, "test");
    expect(state.resources["package:brew-cask:ghostty"]).toMatchObject({ owned: false, installedVersion: "1.3.1" });
    expect(f.messages.some((message) => message.includes("Remove brew-cask:ghostty"))).toBe(true);
    const backups = (await readdir(f.root)).filter((name) => name.startsWith(".workstation-mise-"));
    expect(backups).toHaveLength(1);
    expect(await readFile(join(f.root, backups[0]!, "app-0.app", "contents"), "utf8")).toBe("original app");
    expect(await applyPlan(config, f.runner)).toEqual([]);
    expect(f.calls.filter(({ args }) => args[0] === "install")).toHaveLength(1);
  });

  it("restores mise staging, missing apps and links after a failed Homebrew install", async () => {
    const f = await fixture();
    f.fail();
    await expect(installResource(resource, f.runner)).rejects.toThrow("Mise staging restored");
    expect(await readFile(join(f.app, "contents"), "utf8")).toBe("original app");
    expect(await readFile(f.completion, "utf8")).toBe("original completion");
    expect(await readFile(join(f.version, ".mise-cask.toml"), "utf8")).toContain("schema_version = 3");
  });

  it("does not migrate an ordinary Homebrew installation", async () => {
    const f = await fixture();
    f.installed();
    await expect(installResource(resource, f.runner)).resolves.toMatchObject({ matches: true });
    expect(f.calls.some(({ command }) => command === "/usr/bin/ditto")).toBe(false);
    expect(f.calls.some(({ args }) => args[0] === "--caskroom")).toBe(false);
  });

  it("leaves the original installation in place when app backup fails", async () => {
    const f = await fixture();
    const runner: Runner = {
      ...f.runner, async run(command, args, options) {
        if (command === "/usr/bin/ditto") return { exitCode: 1, stdout: "", stderr: "backup failed" };
        return f.runner.run(command, args, options);
      }
    };
    await expect(installResource(resource, runner)).rejects.toThrow("backup failed");
    expect(await readFile(join(f.app, "contents"), "utf8")).toBe("original app");
    expect(await lstat(f.version)).toBeDefined();
    expect(f.calls.some(({ args }) => args[0] === "install")).toBe(false);
  });

  it("rejects unsupported receipts and mixed Caskroom contents without mutations", async () => {
    const f = await fixture();
    await writeFile(join(f.version, ".mise-cask.toml"), stringify({ ...f.receipt, schema_version: 99 }));
    expect(await inspectMiseCask(resource, f.runner)).toBeUndefined();
    await writeFile(join(f.version, ".mise-cask.toml"), stringify(f.receipt));
    await mkdir(join(f.cask, "another-version"));
    expect(await inspectMiseCask(resource, f.runner)).toBeUndefined();
    expect(f.calls.every(({ args }) => args[0] === "--caskroom")).toBe(true);
  });

  it("rejects receipt paths which do not match the staged app", async () => {
    const f = await fixture();
    await writeFile(join(f.version, ".mise-cask.toml"), stringify({ ...f.receipt, apps: [join(f.root, "Other.app")] }));
    expect(await inspectMiseCask(resource, f.runner)).toBeUndefined();
  });
});
