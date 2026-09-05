import { describe, expect, it } from "vitest";
import { inspectResource, installResource, removeResource } from "../src/resources/dispatch.js";
import { resolvePackageVersion } from "../src/resources/package-version.js";
import type { CommandResult, Runner } from "../src/api/types.js";

class RecordingRunner implements Runner {
  readonly calls: Array<{ command: string; args: readonly string[] }> = [];

  constructor(private readonly results: CommandResult[]) {}

  async run(command: string, args: readonly string[]): Promise<CommandResult> {
    this.calls.push({ command, args });
    return this.results.shift() ?? { exitCode: 0, stdout: "", stderr: "" };
  }
}

describe("package backends", () => {
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
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "ghostty\n", stderr: "" },
    ]);
    const resource = { kind: "package" as const, manager: "brew-cask" as const, name: "ghostty" };

    await installResource(resource, runner);
    expect(runner.calls).toEqual([
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
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "install ok installed", stderr: "" },
    ]);
    const resource = { kind: "package" as const, manager: "apt" as const, name: "jq" };

    await installResource(resource, runner);
    expect(runner.calls[0]).toEqual({
      command: "sudo",
      args: ["apt-get", "install", "-y", "jq"],
    });
  });

  it("installs and inspects an exact locked APT version", async () => {
    const runner = new RecordingRunner([
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
