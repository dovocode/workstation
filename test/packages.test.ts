import { describe, expect, it } from "vitest";
import { inspectResource, installResource, removeResource } from "../src/resources/dispatch.js";
import { resolvePackageVersion } from "../src/resources/package-version.js";
import type { CommandResult, Runner, RunOptions } from "../src/api/types.js";

class RecordingRunner implements Runner {
  readonly calls: Array<{ command: string; args: readonly string[] }> = [];
  readonly options: Array<RunOptions | undefined> = [];

  constructor(private readonly results: CommandResult[]) {}

  async run(command: string, args: readonly string[], options?: RunOptions): Promise<CommandResult> {
    this.calls.push({ command, args });
    this.options.push(options);
    return this.results.shift() ?? { exitCode: 0, stdout: "", stderr: "" };
  }
}

describe("package backends", () => {
  it.each([
    ["npm:t3", "nightly", "t3@nightly"],
    ["npm:@example/cli", "next", "@example/cli@next"],
    ["npm:t3[prerelease=true]", "nightly", "t3@nightly"],
    ["npm:t3", undefined, "t3@latest"],
  ])("resolves %s tags through npm and installs the concrete mise version", async (name, version, spec) => {
    const pinned = "0.0.41-nightly.20260909.1439";
    const runner = new RecordingRunner([
      { exitCode: 0, stdout: JSON.stringify(pinned), stderr: "" },
      { exitCode: 1, stdout: "", stderr: "not installed" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: `/tmp/mise/installs/t3/${pinned}\n`, stderr: "" },
    ]);
    const resource = { kind: "package" as const, manager: "mise" as const, name, ...(version ? { version } : {}) };
    const lockedVersion = await resolvePackageVersion(resource, runner);
    expect(lockedVersion).toBe(pinned);
    if (!lockedVersion) throw new Error("Expected an exact npm version");
    await expect(installResource({ ...resource, lockedVersion }, runner)).resolves.toMatchObject({ matches: true, installedVersion: pinned });
    expect(runner.calls).toEqual([
      { command: "npm", args: ["view", spec, "version", "--json"] },
      { command: "mise", args: ["where", `${name}@${pinned}`] },
      { command: "mise", args: ["install", `${name}@${pinned}`] },
      { command: "mise", args: ["where", `${name}@${pinned}`] },
    ]);
  });

  it.each(["", "not-json", "null", "{}", '["1.0.0"]', '"nightly"', '"1.0.0 extra"'])("rejects invalid npm tag metadata: %s", async (stdout) => {
    await expect(resolvePackageVersion({ kind: "package", manager: "mise", name: "npm:t3", version: "nightly" },
      new RecordingRunner([{ exitCode: 0, stdout, stderr: "" }]))).rejects.toThrow("npm view t3@nightly did not report");
  });

  it("propagates npm registry failures without falling back to a different version", async () => {
    const runner = new RecordingRunner([{ exitCode: 1, stdout: "", stderr: "E404 No match found for version nightly" }]);
    await expect(resolvePackageVersion({ kind: "package", manager: "mise", name: "npm:t3", version: "nightly" }, runner)).rejects.toThrow("E404");
    expect(runner.calls).toHaveLength(1);
  });

  it.each([["node", "lts"], ["npm:t3", "0.0.40"], ["npm:t3", "^0.0.40"]])("keeps %s@%s on mise resolution", async (name, version) => {
    const runner = new RecordingRunner([{ exitCode: 0, stdout: "1.2.3\n", stderr: "" }]);
    expect(await resolvePackageVersion({ kind: "package", manager: "mise", name, version }, runner)).toBe("1.2.3");
    expect(runner.calls).toEqual([{ command: "mise", args: ["latest", `${name}@${version}`] }]);
  });

  it("upgrades locked auto-updating casks without refreshing validated metadata", async () => {
    const present = { exitCode: 0, stdout: "ghostty", stderr: "" };
    const info = (installed: string): CommandResult => ({
      exitCode: 0, stderr: "",
      stdout: JSON.stringify({ casks: [{ version: "1.3.1", installed, auto_updates: true }] }),
    });
    const runner = new RecordingRunner([present, info("1.3.0"), info("1.3.0"),
      { exitCode: 0, stdout: "Upgraded", stderr: "" }, present, info("1.3.1")]);
    await expect(installResource({ kind: "package", manager: "brew-cask", name: "ghostty", lockedVersion: "1.3.1" }, runner))
      .resolves.toMatchObject({ matches: true, installedVersion: "1.3.1" });
    expect(runner.calls[3]).toEqual({ command: "brew", args: ["upgrade", "--cask", "--no-ask", "--greedy", "ghostty"] });
    expect(runner.options[3]).toEqual({ streamOutput: true, environment: { HOMEBREW_NO_AUTO_UPDATE: "1" } });
  });

  it("reports actual and expected versions when an upgrade succeeds without converging", async () => {
    const present = { exitCode: 0, stdout: "ghostty", stderr: "" };
    const info = { exitCode: 0, stderr: "", stdout: JSON.stringify({ casks: [{ version: "1.3.1", installed: "1.3.0" }] }) };
    const runner = new RecordingRunner([present, info, info, present, present, info]);
    await expect(installResource({ kind: "package", manager: "brew-cask", name: "ghostty", lockedVersion: "1.3.1" }, runner))
      .rejects.toThrow("expected 1.3.1; installed 1.3.0");
  });

  it("identifies missing installed-version metadata", async () => {
    const runner = new RecordingRunner([
      { exitCode: 0, stdout: "ghostty", stderr: "" },
      { exitCode: 0, stdout: JSON.stringify({ casks: [{ version: "1.3.1", installed: null }] }), stderr: "" },
      { exitCode: 0, stdout: "/missing-workstation-test/ghostty", stderr: "" },
    ]);
    await expect(inspectResource({ kind: "package", manager: "brew-cask", name: "ghostty", lockedVersion: "1.3.1" }, runner))
      .resolves.toMatchObject({ matches: false, conflict: expect.stringContaining("reports no installed version") });
  });

  it("does not attempt an upgrade with missing installation metadata", async () => {
    const runner = new RecordingRunner([
      { exitCode: 0, stdout: "ghostty", stderr: "" },
      { exitCode: 0, stdout: JSON.stringify({ casks: [{ version: "1.3.1", installed: null }] }), stderr: "" },
      { exitCode: 0, stdout: "/missing-workstation-test/ghostty", stderr: "" },
    ]);
    await expect(installResource({ kind: "package", manager: "brew-cask", name: "ghostty", lockedVersion: "1.3.1" }, runner))
      .rejects.toThrow("reports no installed version");
    expect(runner.calls).toHaveLength(3);
  });

  it("uses the same Homebrew formula revision for locking and installed-version checks", async () => {
    const info = {
      exitCode: 0, stderr: "",
      stdout: JSON.stringify({ formulae: [{ versions: { stable: "1.2.3" }, revision: 2, installed: [{ version: "1.2.3_2" }] }] }),
    };
    const resource = { kind: "package" as const, manager: "brew" as const, name: "example" };
    const runner = new RecordingRunner([info, { exitCode: 0, stdout: "example", stderr: "" }, info]);
    const lockedVersion = await resolvePackageVersion(resource, runner);
    expect(lockedVersion).toBe("1.2.3_2");
    if (!lockedVersion) throw new Error("Expected a concrete formula version");
    await expect(inspectResource({ ...resource, lockedVersion }, runner))
      .resolves.toMatchObject({ matches: true, installedVersion: "1.2.3_2" });
  });

  it("rejects malformed Homebrew metadata during version resolution", async () => {
    const resource = { kind: "package" as const, manager: "brew" as const, name: "example" };
    await expect(resolvePackageVersion(resource, new RecordingRunner([
      { exitCode: 0, stdout: "[]", stderr: "" },
    ]))).rejects.toThrow("Homebrew returned invalid JSON");
  });

  it("records the concrete mise version and removes that exact version", async () => {
    const runner = new RecordingRunner([
      { exitCode: 0, stdout: "/home/test/.local/share/mise/installs/node/24.20.0\n", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
    ]);
    const resource = { kind: "package" as const, manager: "mise" as const, name: "node", version: "lts" };

    await expect(inspectResource(resource, runner)).resolves.toMatchObject({
      installedVersion: "24.20.0",
    });
    await removeResource(resource, runner, "24.20.0");

    expect(runner.calls).toEqual([
      { command: "mise", args: ["where", "node@lts"] },
      { command: "mise", args: ["uninstall", "--yes", "node@24.20.0"] },
    ]);
  });

  it("uses the configured Homebrew cask backend", async () => {
    const runner = new RecordingRunner([
      { exitCode: 1, stdout: "", stderr: "not installed" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "ghostty\n", stderr: "" },
    ]);
    const resource = { kind: "package" as const, manager: "brew-cask" as const, name: "ghostty" };

    await installResource(resource, runner);
    expect(runner.calls).toEqual([
      { command: "brew", args: ["list", "--cask", "ghostty"] },
      { command: "brew", args: ["install", "--cask", "ghostty"] },
      { command: "brew", args: ["list", "--cask", "ghostty"] },
    ]);
  });

  it("upgrades outdated Homebrew casks with greedy and force", async () => {
    const runner = new RecordingRunner([
      { exitCode: 0, stdout: "ghostty\n", stderr: "" },
      { exitCode: 0, stdout: "ghostty\n", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "ghostty\n", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
    ]);
    const resource = {
      kind: "package" as const,
      manager: "brew-cask" as const,
      name: "ghostty",
      upgrade: { greedy: true, force: true },
    };

    await installResource(resource, runner);

    expect(runner.calls).toEqual([
      { command: "brew", args: ["list", "--cask", "ghostty"] },
      { command: "brew", args: ["outdated", "--quiet", "--cask", "--greedy", "ghostty"] },
      {
        command: "brew",
        args: ["upgrade", "--cask", "--no-ask", "--greedy", "--force", "ghostty"],
      },
      { command: "brew", args: ["list", "--cask", "ghostty"] },
      { command: "brew", args: ["outdated", "--quiet", "--cask", "--greedy", "ghostty"] },
    ]);
  });

  it("uses sudo only for mutating APT operations", async () => {
    const runner = new RecordingRunner([
      { exitCode: 1, stdout: "", stderr: "not installed" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "install ok installed", stderr: "" },
    ]);
    const resource = { kind: "package" as const, manager: "apt" as const, name: "jq" };

    await installResource(resource, runner);
    expect(runner.calls[1]).toEqual({
      command: "sudo",
      args: ["apt-get", "install", "-y", "jq"],
    });
  });

  it("installs and inspects an exact locked APT version", async () => {
    const runner = new RecordingRunner([
      { exitCode: 1, stdout: "", stderr: "not installed" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "install ok installed\t1.7.1-3ubuntu0.1", stderr: "" },
    ]);
    const resource = {
      kind: "package" as const,
      manager: "apt" as const,
      name: "jq",
      lockedVersion: "1.7.1-3ubuntu0.1",
    };

    await installResource(resource, runner);
    expect(runner.calls).toEqual([
      { command: "dpkg-query", args: ["-W", "-f=${Status}\t${Version}", "jq"] },
      {
        command: "sudo",
        args: [
          "apt-get",
          "install",
          "-y",
          "--allow-downgrades",
          "jq=1.7.1-3ubuntu0.1",
        ],
      },
      { command: "dpkg-query", args: ["-W", "-f=${Status}\t${Version}", "jq"] },
    ]);
  });

  it("refuses a Homebrew mutation when the locked version is unavailable", async () => {
    const runner = new RecordingRunner([
      { exitCode: 1, stdout: "", stderr: "" },
      {
        exitCode: 0,
        stdout: JSON.stringify({ formulae: [{ versions: { stable: "2.0.0" } }] }),
        stderr: "",
      },
    ]);
    const resource = {
      kind: "package" as const,
      manager: "brew" as const,
      name: "example",
      lockedVersion: "1.0.0",
    };

    await expect(installResource(resource, runner)).rejects.toThrow(
      "Homebrew currently offers example 2.0.0, but workstation.lock pins 1.0.0",
    );
    expect(runner.calls.at(-1)).toEqual({
      command: "brew",
      args: ["info", "--json=v2", "--formula", "example"],
    });
  });
});
