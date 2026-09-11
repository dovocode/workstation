import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { provision, type ProvisionOperation } from "../src/api/provision.js";
import { isProvisionResource } from "../src/config/provision.js";
import { inspectProvision, installProvision } from "../src/resources/provision.js";
import type { Runner } from "../src/api/types.js";

it("validates native operation boundaries without coercion or insecure download schemes", () => {
  const operations: ProvisionOperation[] = [
    { type: "brew-tap", tap: "vendor/tools", url: "https://example.test/tools", trust: true },
    { type: "apt-repository", name: "docker", uri: "https://example.test", suite: "auto", components: ["stable"], architecture: "auto", keyUrl: "https://example.test/key", keySha256: "0".repeat(64), conflicts: ["docker.io"] },
    { type: "copy-file", source: "source", target: "target", seed: true, mode: 0o600 },
    { type: "macos-default", domain: "app.example", key: "enabled", value: true },
    { type: "macos-installer", url: "https://example.test/app.pkg", teamId: "ABCDEFGHIJ", installedPath: "/Applications/Example.app", version: "1", sha256: "0".repeat(64) },
    { type: "service", manager: "launchd", scope: "user", name: "app.example", plist: "~/agent.plist", optionalSession: true },
    { type: "check", check: { command: "probe" }, repair: [{ command: "repair" }], requiresFile: "vault", restartOnChange: true },
    { type: "linger", user: "test" }, { type: "group-member", user: "test", group: "docker" },
  ];
  for (const op of operations) expect(isProvisionResource(provision("setup", op))).toBe(true);
  for (const url of ["http://example.test/app.pkg", "https://user:password@example.test/app.pkg", "not a URL", ""]) expect(isProvisionResource({ kind: "provision", name: "bad", operation: { ...operations[4], url } })).toBe(false);
  expect(isProvisionResource({ kind: "provision", name: "bad", operation: { ...operations[2], mode: "0600" } })).toBe(false);
  expect(isProvisionResource({ kind: "provision", name: "bad", operation: { type: "service", manager: "launchd", scope: "user", name: "example" } })).toBe(false);
});
it("reconciles tap origin and explicit trust, then becomes a no-op", async () => {
  let tapped = false; let trusted = false;
  const runner: Runner = { async run(command, args) {
    if (command === "git") return { exitCode: 0, stdout: "https://example.test/tools.git\n", stderr: "" };
    if (args[0] === "tap" && args.length > 1) tapped = true;
    if (args[0] === "trust" && args.length > 1) trusted = true;
    const output: Record<string, string> = { "--repository": "/tap", tap: tapped ? "vendor/tools\n" : "", trust: trusted ? "vendor/tools\n" : "" };
    expect(Object.keys(output)).toContain(args[0]);
    return { exitCode: 0, stdout: String(output[args[0] ?? ""]), stderr: "" };
  } };
  const resource = provision("tap", { type: "brew-tap", tap: "vendor/tools", url: "https://example.test/tools", trust: true });
  expect((await inspectProvision(resource, runner)).matches).toBe(false);
  expect((await installProvision(resource, runner)).matches).toBe(true);
  expect((await inspectProvision(resource, runner)).matches).toBe(true);
});
it.each([true, 123, "literal value"])("writes and verifies a typed preference: %s", async value => {
  let installed = false;
  const runner: Runner = { async run(_command, args) {
    if (args[0] === "write") { installed = true; expect(args.at(-1)).toBe(String(value)); }
    return { exitCode: installed ? 0 : 1, stdout: installed ? String(typeof value === "boolean" ? Number(value) : value) : "", stderr: installed ? "" : "does not exist" };
  } };
  const resource = provision("preference", { type: "macos-default", domain: "app.example", key: "setting", value });
  expect((await inspectProvision(resource, runner)).matches).toBe(false);
  expect((await installProvision(resource, runner)).matches).toBe(true);
});
it.each(["user", "system"] as const)("activates and verifies a %s systemd service", async scope => {
  let active = false;
  const mutations: string[][] = [];
  const runner: Runner = { async run(command, args) {
    if (command === "sudo" || args.includes("enable") || args.includes("restart")) { mutations.push([command, ...args]); active = true; }
    return { exitCode: active ? 0 : 3, stdout: active ? "enabled" : "disabled", stderr: "" };
  } };
  const resource = provision("service", { type: "service", manager: "systemd", scope, name: "example.service" });
  expect((await inspectProvision(resource, runner)).matches).toBe(false);
  expect((await installProvision(resource, runner)).matches).toBe(true);
  expect(mutations).toHaveLength(2);
  expect(mutations[1]).toContain("restart");
});
it("activates an unloaded launchd daemon and verifies runtime state", async () => {
  let active = false;
  const runner: Runner = { async run(command, args) {
    if (command === "sudo") { expect(args.slice(0, 3)).toEqual(["launchctl", "bootstrap", "system"]); active = true; }
    return { exitCode: active ? 0 : 1, stdout: active ? "state = running" : "", stderr: "" };
  } };
  expect((await installProvision(provision("daemon", { type: "service", manager: "launchd", scope: "system", name: "example", plist: "/daemon.plist" }), runner)).matches).toBe(true);
});
it("checks lingering and group membership after applying them", async () => {
  let linger = false; let group = false;
  const runner: Runner = { async run(command, args) {
    if (command === "sudo" && args[0] === "loginctl") linger = true;
    if (command === "sudo" && args[0] === "usermod") group = true;
    return { exitCode: 0, stdout: command === "id" ? (group ? "test docker" : "test") : linger ? "yes" : "no", stderr: "" };
  } };
  expect((await installProvision(provision("linger", { type: "linger", user: "test" }), runner)).matches).toBe(true);
  expect((await installProvision(provision("group", { type: "group-member", user: "test", group: "docker" }), runner)).matches).toBe(true);
});
it("refuses a notarized installer signed by a different team before sudo", async () => {
  const commands: string[] = [];
  const runner: Runner = { async run(command, args) {
    commands.push(command);
    if (command === "curl") await writeFile(args.at(-1)!, "installer fixture");
    return { exitCode: 0, stdout: "1. Developer ID Installer: Other Inc. (OTHERTEAM1)", stderr: "" };
  } };
  await expect(installProvision(provision("installer", { type: "macos-installer", url: "https://example.test/app.pkg", teamId: "ABCDEFGHIJ", installedPath: "/missing/example" }), runner)).rejects.toThrow("signer mismatch");
  expect(commands).toEqual(["curl", "pkgutil"]);
});
it("reports an installed vendor version mismatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "workstation-vendor-"));
  await mkdir(join(root, "Example.app"));
  const runner: Runner = { async run() { return { exitCode: 0, stdout: "1.0\n", stderr: "" }; } };
  const result = await inspectProvision(provision("installer", { type: "macos-installer", url: "https://example.test/app.pkg", teamId: "ABCDEFGHIJ", installedPath: join(root, "Example.app"), version: "2.0" }), runner);
  expect(result).toMatchObject({ present: true, matches: false, installedVersion: "1.0" });
});
