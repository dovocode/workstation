import { describe, expect, it } from "vitest";
import type { CommandResult, Runner, RunOptions } from "../src/api/types.js";
import { tools } from "../src/api/config.js";
import { validateResource } from "../src/config/validation.js";
import { resourceId } from "../src/config/identity.js";
import { inspectResource, installResource, removeResource } from "../src/resources/dispatch.js";
import { resolvePackageVersion } from "../src/resources/package-version.js";

const ok = (stdout = ""): CommandResult => ({ exitCode: 0, stdout, stderr: "" });
const hash = "a".repeat(64);
const oldHash = "b".repeat(64);

class RecordingRunner implements Runner {
  readonly calls: Array<{ command: string; args: readonly string[]; options?: RunOptions }> = [];
  constructor(private readonly results: CommandResult[]) {}
  async run(command: string, args: readonly string[], options?: RunOptions): Promise<CommandResult> {
    this.calls.push({ command, args, ...(options ? { options } : {}) });
    const result = this.results.shift();
    if (!result) throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    return result;
  }
}

describe("pacman", () => {
  const resource = { kind: "package" as const, manager: "pacman" as const, name: "jq", lockedVersion: "1.8.1-2" };
  const missing = { exitCode: 1, stdout: "", stderr: "error: package 'jq' was not found\n" };
  it("locks the exact package rather than the dependencies in a transaction", async () => {
    const runner = new RecordingRunner([ok("oniguruma\t6.9.10-1\njq\t1.8.1-2\n")]);
    expect(await resolvePackageVersion(resource, runner)).toBe("1.8.1-2");
    expect(runner.calls[0]?.args).toEqual(["-Sp", "--print-format", "%n\t%v", "jq"]);
  });
  it("installs and verifies a pin without refreshing the database", async () => {
    const runner = new RecordingRunner([missing, ok("jq\t1.8.1-2"), ok(), ok("jq 1.8.1-2")]);
    expect(await installResource(resource, runner)).toMatchObject({ matches: true, installedVersion: "1.8.1-2" });
    expect(runner.calls[2]).toMatchObject({ command: "sudo", args: ["pacman", "-S", "--needed", "--noconfirm", "jq"] });
  });
  it("does not mutate an unavailable pin or a matching install", async () => {
    const runner = new RecordingRunner([missing, ok("jq\t1.8.2-1")]);
    await expect(installResource(resource, runner)).rejects.toThrow("workstation.lock pins 1.8.1-2");
    expect(runner.calls.every(({ command }) => command !== "sudo")).toBe(true);
    const matching = new RecordingRunner([ok("jq 1.8.1-2"), ok("jq 1.8.1-2")]);
    expect(await installResource(resource, matching)).toMatchObject({ matches: true });
    expect(matching.calls.every(({ args }) => args[0] === "-Q")).toBe(true);
  });
  it("preserves query failures and rejects ambiguous metadata", async () => {
    await expect(inspectResource(resource, new RecordingRunner([{ exitCode: 1, stdout: "", stderr: "permission denied" }]))).rejects.toThrow("permission denied");
    await expect(resolvePackageVersion(resource, new RecordingRunner([ok("jq\t1\njq\t2")]))).rejects.toThrow("unique version");
  });
  it("removes only the requested package", async () => {
    const runner = new RecordingRunner([ok()]);
    await removeResource(resource, runner);
    expect(runner.calls[0]?.args).toEqual(["pacman", "-R", "--noconfirm", "jq"]);
  });
});

describe("Flatpak", () => {
  const resource = { kind: "package" as const, manager: "flatpak" as const, name: "org.example.App", lockedVersion: hash };
  const installed = ok("org.example.App\tstable\tflathub\n");
  it("locks full commits from the configured remote and branch", async () => {
    const runner = new RecordingRunner([ok(hash)]);
    expect(await resolvePackageVersion({ ...resource, flatpak: { scope: "system", remote: "testing", branch: "beta" } }, runner)).toBe(hash);
    expect(runner.calls[0]?.args).toEqual(["remote-info", "--system", "--show-commit", "testing", "app/org.example.App//beta"]);
  });
  it("defaults to user Flathub installs and verifies the deployed commit", async () => {
    const runner = new RecordingRunner([ok(), ok(hash), ok(), installed, ok(hash)]);
    expect(await installResource(resource, runner)).toMatchObject({ matches: true, installedVersion: hash });
    expect(runner.calls[2]).toMatchObject({ command: "flatpak", args: ["install", "--user", "--noninteractive", "--assumeyes", "--app", "flathub", "app/org.example.App//stable"] });
  });
  it("updates system installations to a specific retained commit", async () => {
    const runner = new RecordingRunner([installed, ok(oldHash), ok(), installed, ok(hash)]);
    await installResource({ ...resource, flatpak: { scope: "system" } }, runner);
    expect(runner.calls[2]).toMatchObject({ command: "sudo", args: ["flatpak", "update", "--system", "--noninteractive", "--assumeyes", `--commit=${hash}`, "app/org.example.App//stable"] });
  });
  it("does not silently switch origins or install a different initial commit", async () => {
    await expect(installResource(resource, new RecordingRunner([ok("org.example.App\tstable\tother")]))).rejects.toThrow("Migrate its remote explicitly");
    const runner = new RecordingRunner([ok(), ok(oldHash)]);
    await expect(installResource(resource, runner)).rejects.toThrow("Refresh its pin before a fresh install");
    expect(runner.calls.some(({ args }) => args[0] === "install")).toBe(false);
  });
  it("ignores other branches and retains data during uninstall", async () => {
    expect(await inspectResource(resource, new RecordingRunner([ok("org.example.App\tbeta\tflathub")]))).toMatchObject({ present: false });
    const runner = new RecordingRunner([ok()]);
    await removeResource(resource, runner);
    expect(runner.calls[0]).toMatchObject({ command: "flatpak", args: ["uninstall", "--user", "--noninteractive", "--assumeyes", "--app", "app/org.example.App//stable"] });
  });
  it("rejects malformed metadata and surfaces remote failures", async () => {
    await expect(resolvePackageVersion(resource, new RecordingRunner([ok("abc")]))).rejects.toThrow("full commit ID");
    await expect(inspectResource(resource, new RecordingRunner([ok("invalid")]))).rejects.toThrow("invalid application list");
    await expect(resolvePackageVersion(resource, new RecordingRunner([{ exitCode: 1, stdout: "", stderr: "No remote named flathub" }]))).rejects.toThrow("No remote named flathub");
  });
  it("keeps scope and branch identities separate", () => {
    expect(resourceId(resource)).not.toBe(resourceId({ ...resource, flatpak: { scope: "system" } }));
    expect(resourceId(resource)).not.toBe(resourceId({ ...resource, flatpak: { branch: "beta" } }));
  });
});

describe("Mac App Store", () => {
  const resource = { kind: "package" as const, manager: "mas" as const, name: "123" };
  it("uses numeric IDs and never creates a fictitious version pin", async () => {
    expect(tools.mas([123, "456"])).toEqual([{ ...resource }, { ...resource, name: "456" }]);
    expect(() => tools.mas([Number.MAX_SAFE_INTEGER + 1])).toThrow("Invalid Mac App Store ID");
    expect(() => tools.mas(["-1"])).toThrow("Invalid Mac App Store ID");
    expect(await resolvePackageVersion(resource, new RecordingRunner([]))).toBeUndefined();
  });
  it("installs previously acquired apps, without using the purchase command", async () => {
    const runner = new RecordingRunner([ok(), ok(), ok("123 Test App (1.0)"), ok()]);
    expect(await installResource(resource, runner)).toMatchObject({ matches: true, installedVersion: "1.0" });
    expect(runner.calls[1]).toMatchObject({ command: "mas", args: ["install", "123"] });
  });
  it("upgrades only the exact outdated app ID", async () => {
    const list = ok("123 Test App (Beta) (1.0)\n1234 Other App (2.0)");
    const runner = new RecordingRunner([list, ok("123 Test App (Beta) (1.0 -> 1.1)"), ok(), ok("123 Test App (Beta) (1.1)"), ok()]);
    expect(await installResource(resource, runner)).toMatchObject({ matches: true, installedVersion: "1.1" });
    expect(runner.calls[2]?.args).toEqual(["upgrade", "123"]);
    expect(await inspectResource(resource, new RecordingRunner([list, ok("1234 Other App (2.0 -> 3.0)")]))).toMatchObject({ matches: true });
  });
  it("surfaces account and Spotlight failures rather than treating them as absence", async () => {
    await expect(inspectResource(resource, new RecordingRunner([{ exitCode: 1, stdout: "", stderr: "Spotlight error" }]))).rejects.toThrow("Spotlight error");
    await expect(installResource(resource, new RecordingRunner([ok(), { exitCode: 1, stdout: "", stderr: "Sign in to the App Store" }]))).rejects.toThrow("Sign in");
    await expect(inspectResource({ ...resource, lockedVersion: "1.0" }, new RecordingRunner([]))).rejects.toThrow("does not support version pins");
  });
  it("removes the exact app without broad uninstall flags", async () => {
    const runner = new RecordingRunner([ok()]);
    await removeResource(resource, runner);
    expect(runner.calls[0]).toMatchObject({ command: "mas", args: ["uninstall", "123"] });
  });
});

describe("app package validation", () => {
  it("rejects fuzzy identifiers and misplaced or invalid Flatpak options", () => {
    for (const resource of [
      { kind: "package", manager: "mas", name: "Xcode" },
      { kind: "package", manager: "pacman", name: "group/*" },
      { kind: "package", manager: "flatpak", name: "App" },
      { kind: "package", manager: "flatpak", name: "org.example.App", flatpak: { scope: "global" } },
      { kind: "package", manager: "flatpak", name: "org.example.App", flatpak: { remote: "--option" } },
      { kind: "package", manager: "apt", name: "jq", flatpak: {} },
    ]) expect(() => validateResource(resource)).toThrow();
  });
});
