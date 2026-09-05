import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installResource, removeResource } from "../src/resources/dispatch.js";
import { renderSystemdService } from "../src/rendering/systemd.js";
import type { CommandResult, Runner } from "../src/api/types.js";

const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});

class SystemctlRunner implements Runner {
  readonly calls: Array<{ command: string; args: readonly string[] }> = [];

  async run(command: string, args: readonly string[]): Promise<CommandResult> {
    this.calls.push({ command, args });
    return { exitCode: 0, stdout: "", stderr: "" };
  }
}

describe("systemd services", () => {
  it("installs, enables, and removes a user service", async () => {
    const home = await mkdtemp(join(tmpdir(), "workstation-systemd-"));
    process.env.HOME = home;
    const resource = {
      kind: "systemd-service" as const,
      name: "dev.example.worker.service",
      scope: "user" as const,
      program: "/usr/bin/example-worker",
      args: ["serve"],
      environment: { PORT: "3000" },
      restart: "always" as const,
    };
    const runner = new SystemctlRunner();

    await installResource(resource, runner);
    const path = join(home, ".config", "systemd", "user", resource.name);
    expect(await readFile(path, "utf8")).toBe(renderSystemdService(resource));
    expect(runner.calls).toEqual([
      { command: "systemctl", args: ["--user", "daemon-reload"] },
      { command: "systemctl", args: ["--user", "enable", "--now", resource.name] },
    ]);

    runner.calls.length = 0;
    await removeResource(resource, runner);
    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(runner.calls).toEqual([
      { command: "systemctl", args: ["--user", "disable", "--now", resource.name] },
      { command: "systemctl", args: ["--user", "daemon-reload"] },
    ]);
  });

  it("uses sudo for system-scoped installation", async () => {
    const resource = {
      kind: "systemd-service" as const,
      name: "workstation-test-never-installed.service",
      scope: "system" as const,
      program: "/usr/bin/true",
    };
    const runner = new SystemctlRunner();

    await installResource(resource, runner);

    expect(runner.calls[0]?.command).toBe("sudo");
    expect(runner.calls[0]?.args.slice(0, 3)).toEqual(["install", "-m", "0644"]);
    expect(runner.calls.slice(1)).toEqual([
      { command: "sudo", args: ["systemctl", "daemon-reload"] },
      {
        command: "sudo",
        args: ["systemctl", "enable", "--now", resource.name],
      },
    ]);
  });
});
