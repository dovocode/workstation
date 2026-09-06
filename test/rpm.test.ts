import { describe, expect, it } from "vitest";
import type { CommandResult, Runner, RunOptions } from "../src/api/types.js";
import { resolvePackageVersion } from "../src/resources/package-version.js";
import { inspectResource, installResource, removeResource } from "../src/resources/dispatch.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockConfig } from "../src/persistence/lock.js";
import { readState, writeState } from "../src/persistence/state.js";
import { fingerprint, resourceId } from "../src/config/identity.js";

const ok = (stdout = ""): CommandResult => ({ exitCode: 0, stdout, stderr: "" });

class RecordingRunner implements Runner {
  readonly calls: Array<{ command: string; args: readonly string[]; options?: RunOptions }> = [];
  constructor(private readonly results: CommandResult[]) {}
  async run(command: string, args: readonly string[], options?: RunOptions): Promise<CommandResult> {
    this.calls.push({ command, args, ...(options ? { options } : {}) });
    const result = this.results.shift();
    if (!result) throw new Error(`Unexpected command ${command} ${args.join(" ")}`);
    return result;
  }
}

describe.each(["dnf", "yum"] as const)("%s packages", (manager) => {
  const resource = { kind: "package" as const, manager, name: "jq" };
  it("persists and reuses pins and ownership state", async () => {
    const root = await mkdtemp(join(tmpdir(), "workstation-rpm-lock-"));
    const config = { context: { platform: "linux" as const, home: root, configDir: root, machine: "test", hostname: "test" },
      stateFile: join(root, "state.json"), resources: [resource] };
    const runner = new RecordingRunner([ok("x86_64"), ok("Available Packages\njq.x86_64 1.7-2.el9 repo")]);
    const first = await lockConfig(join(root, "workstation.config.ts"), config, runner);
    expect(first.config.resources[0]).toMatchObject({ lockedVersion: "0:1.7-2.el9.x86_64" });
    expect((await lockConfig(join(root, "workstation.config.ts"), config, runner)).changed).toBe(false);
    const locked = first.config.resources[0];
    if (!locked) throw new Error("Expected locked resource");
    const id = resourceId(locked);
    const state = { version: 1 as const, machine: "test", resources: { [id]: { id, fingerprint: fingerprint(locked), resource: locked, owned: true } } };
    await writeState(config.stateFile, state);
    expect(await readState(config.stateFile, "test")).toEqual(state);
  });
  it("locks the latest native candidate with epoch and architecture", async () => {
    const runner = new RecordingRunner([ok("x86_64\n"), ok("Installed Packages\njq.x86_64 1.6-1.el9 @base\nAvailable Packages\njq.i686 1.7-2.el9 updates\njq.x86_64 2:1.7-2.el9 updates\n")]);
    expect(await resolvePackageVersion(resource, runner)).toBe("2:1.7-2.el9.x86_64");
    expect(runner.calls.every(({ command }) => command !== "sudo")).toBe(true);
    expect(runner.calls[1]?.options).toEqual({ environment: { LC_ALL: "C" } });
  });
  it("supports noarch, wrapped package names and explicit architectures", async () => {
    expect(await resolvePackageVersion(resource, new RecordingRunner([ok("aarch64"), ok("Available packages\njq.noarch\n   1.7-2.el9 repo\n")]))).toBe("0:1.7-2.el9.noarch");
    expect(await resolvePackageVersion({ ...resource, name: "jq.i686" }, new RecordingRunner([ok("x86_64"), ok("Available Packages\njq.i686 1.7-2.el9 repo\n")]))).toBe("0:1.7-2.el9.i686");
  });
  it("reuses the installed candidate when the package manager lists no newer version", async () => {
    expect(await resolvePackageVersion(resource, new RecordingRunner([ok("x86_64"), ok("Installed Packages\njq.x86_64 1.7-2.el9 @base\n")]))).toBe("0:1.7-2.el9.x86_64");
  });
  it("rejects repository failures and unrelated package matches", async () => {
    await expect(resolvePackageVersion(resource, new RecordingRunner([ok("x86_64"), { exitCode: 1, stdout: "", stderr: "repository unavailable" }]))).rejects.toThrow("repository unavailable");
    await expect(resolvePackageVersion(resource, new RecordingRunner([ok("x86_64"), ok("other.x86_64 1.0-1 base")]))).rejects.toThrow("no installation candidate");
  });
  it("installs and verifies an exact pin with sudo only for the mutation", async () => {
    const lockedVersion = "0:1.7-2.el9.x86_64";
    const runner = new RecordingRunner([{ exitCode: 1, stdout: "package jq is not installed\n", stderr: "" }, ok(), ok(`${lockedVersion}\n`)]);
    await expect(installResource({ ...resource, lockedVersion }, runner)).resolves.toMatchObject({ matches: true, installedVersion: lockedVersion });
    expect(runner.calls[1]).toMatchObject({ command: "sudo", args: [manager, "install", "-y", `jq-${lockedVersion}`] });
  });
  it("uses RPM comparison to downgrade a pin", async () => {
    const lockedVersion = "0:1.6-1.el9.x86_64";
    const runner = new RecordingRunner([ok("0:1.7-2.el9.x86_64\n"), ok("1\n"), ok(), ok(lockedVersion)]);
    await installResource({ ...resource, lockedVersion }, runner);
    expect(runner.calls[1]?.args[1]).toContain("rpm.vercmp");
    expect(runner.calls[2]).toMatchObject({ command: "sudo", args: [manager, "downgrade", "-y", `jq-${lockedVersion}`] });
  });
  it("compares the requested architecture when multiple installed architectures differ", async () => {
    const lockedVersion = "0:1.6-1.el9.x86_64";
    const runner = new RecordingRunner([ok("0:1.5-1.el9.i686\n0:1.7-2.el9.x86_64\n"), ok("1"), ok(), ok(lockedVersion)]);
    await installResource({ ...resource, lockedVersion }, runner);
    expect(runner.calls[1]?.args[1]).toContain('rpm.vercmp("0:1.7-2.el9", "0:1.6-1.el9")');
    expect(runner.calls[2]?.args).toEqual([manager, "downgrade", "-y", `jq-${lockedVersion}`]);
  });
  it("upgrades pins and strips an explicit architecture before building the spec", async () => {
    const lockedVersion = "0:1.7-2.el9.x86_64";
    const runner = new RecordingRunner([ok("0:1.6-1.el9.x86_64"), ok("-1"), ok(), ok(lockedVersion)]);
    await installResource({ ...resource, name: "jq.x86_64", lockedVersion }, runner);
    expect(runner.calls[2]?.args).toEqual([manager, "install", "-y", `jq-${lockedVersion}`]);
  });
  it("does not mutate matching installations, including multilib output", async () => {
    const lockedVersion = "0:1.7-2.el9.x86_64";
    const output = ok(`0:1.7-2.el9.i686\n${lockedVersion}\n`);
    const runner = new RecordingRunner([output, output]);
    await installResource({ ...resource, lockedVersion }, runner);
    expect(runner.calls.every(({ command }) => command === "rpm")).toBe(true);
  });
  it("does not confuse database failures with a missing package", async () => {
    await expect(inspectResource(resource, new RecordingRunner([{ exitCode: 1, stdout: "", stderr: "rpmdb damaged" }]))).rejects.toThrow("rpmdb damaged");
    await expect(inspectResource(resource, new RecordingRunner([ok("invalid")]))).rejects.toThrow("invalid installed versions");
  });
  it("rejects invalid pins before invoking a mutating command", async () => {
    const runner = new RecordingRunner([ok("0:1.7-2.el9.x86_64")]);
    await expect(installResource({ ...resource, lockedVersion: 'bad"pin' }, runner)).rejects.toThrow("Invalid RPM lock version");
    expect(runner.calls).toHaveLength(1);
  });
  it("removes packages through the selected backend", async () => {
    const runner = new RecordingRunner([ok()]);
    await removeResource(resource, runner);
    expect(runner.calls[0]).toMatchObject({ command: "sudo", args: [manager, "remove", "-y", "jq"] });
  });
});
