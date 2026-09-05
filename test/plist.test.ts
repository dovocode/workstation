import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderLaunchAgent } from "../src/rendering/plist.js";
import { installResource, removeResource } from "../src/resources/dispatch.js";
import type { CommandResult, Runner } from "../src/api/types.js";

const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});

class LaunchctlRunner implements Runner {
  readonly calls: Array<{ command: string; args: readonly string[] }> = [];

  constructor(private readonly results: CommandResult[]) {}

  async run(command: string, args: readonly string[]): Promise<CommandResult> {
    this.calls.push({ command, args });
    return this.results.shift() ?? { exitCode: 0, stdout: "", stderr: "" };
  }
}

describe("renderLaunchAgent", () => {
  it("renders deterministic, escaped plist content", () => {
    const result = renderLaunchAgent({
      kind: "launch-agent",
      label: "network.example.worker",
      program: "/opt/example & worker",
      args: ["serve", "<all>"],
      environment: { ZED: "last", ALPHA: "first" },
      keepAlive: true,
    });

    expect(result).toContain("<string>/opt/example &amp; worker</string>");
    expect(result).toContain("<string>&lt;all&gt;</string>");
    expect(result.indexOf("ALPHA")).toBeLessThan(result.indexOf("ZED"));
    expect(result).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(result).toContain("<key>KeepAlive</key>\n  <true/>");
  });

  it("installs, loads, and safely removes an owned LaunchAgent", async () => {
    const home = await mkdtemp(join(tmpdir(), "workstation-launchagent-"));
    process.env.HOME = home;
    const resource = {
      kind: "launch-agent" as const,
      label: "network.example.worker",
      program: "/usr/bin/true",
    };
    const installRunner = new LaunchctlRunner([
      { exitCode: 1, stdout: "", stderr: "not loaded" },
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
    ]);

    await installResource(resource, installRunner);
    const path = join(home, "Library", "LaunchAgents", "network.example.worker.plist");
    expect(await readFile(path, "utf8")).toBe(renderLaunchAgent(resource));
    expect(installRunner.calls.map(({ args }) => args[0])).toEqual([
      "print",
      "bootstrap",
      "kickstart",
    ]);

    const removeRunner = new LaunchctlRunner([
      { exitCode: 0, stdout: "loaded", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
    ]);
    await removeResource(resource, removeRunner);
    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(removeRunner.calls.map(({ args }) => args[0])).toEqual(["print", "bootout"]);
  });
});
