import { mkdtemp, readFile, writeFile, symlink, lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { createWorkstation, provision, files, resourceId, type Context, type Runner } from "../src/index.js";
import { resolveConfig } from "../src/config/load.js";
import { applyPlan } from "../src/reconciliation/apply.js";
import { inspectProvision, installProvision } from "../src/resources/provision.js";
import { readState } from "../src/persistence/state.js";

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "workstation-provision-"));
  const context: Context = { home, configDir: home, machine: "test", hostname: "test", platform: "linux" };
  return { home, context };
}
const silent: Runner = { async run() { throw new Error("Unexpected command"); } };
it("seeds a mutable file, preserves later edits and retains it when removed from configuration", async () => {
  const { home, context } = await fixture();
  await writeFile(join(home, "defaults"), "original\n");
  const resource = provision("preferences", { type: "copy-file", source: "defaults", target: "~/preferences", seed: true, mode: 0o600 });
  const config = await resolveConfig({ resources: [resource] }, context);
  expect((await applyPlan(config, silent)).map(a => a.type)).toEqual(["create"]);
  await writeFile(join(home, "preferences"), "user changes\n");
  expect(await applyPlan(config, silent)).toEqual([]);
  expect((await applyPlan({ ...config, resources: [] }, silent)).map(a => a.type)).toEqual(["forget"]);
  expect(await readFile(join(home, "preferences"), "utf8")).toBe("user changes\n");
});
it("migrates a seed symlink without changing its source and preserves its original identity", async () => {
  const { home, context } = await fixture();
  await writeFile(join(home, "defaults"), "shared defaults");
  await writeFile(join(home, "old"), "existing runtime settings");
  await symlink(join(home, "old"), join(home, "preferences"));
  const config = await resolveConfig({ resources: [provision("preferences", { type: "copy-file", source: "defaults", target: "~/preferences", seed: true, migrateSymlink: true })] }, context);
  await applyPlan(config, silent);
  expect((await lstat(join(home, "preferences"))).isFile()).toBe(true);
  expect(await readFile(join(home, "preferences"), "utf8")).toBe("existing runtime settings");
  expect(await readFile(join(home, "old"), "utf8")).toBe("existing runtime settings");
  expect(Object.values((await readState(config.stateFile, "test")).resources)[0]?.originalFile?.kind).toBe("symlink");
});
it("orders a checked repair after its file dependency and verifies it once repaired", async () => {
  const { home, context } = await fixture();
  let ready = false;
  const calls: string[] = [];
  const runner: Runner = { async run(command) {
    calls.push(command);
    if (command === "repair") { expect(await readFile(join(home, "settings"), "utf8")).toContain("ok"); ready = true; }
    return { exitCode: ready ? 0 : 1, stdout: "", stderr: "" };
  } };
  const file = files.json(join(home, "settings"), { ok: true });
  const check = provision("health", { type: "check", check: { command: "probe" }, repair: [{ command: "repair" }] }, [resourceId(file)]);
  const config = await resolveConfig({ resources: [check, file] }, context);
  await applyPlan(config, runner);
  expect(calls.filter(c => c === "repair")).toHaveLength(1);
  expect(await applyPlan(config, runner)).toEqual([]);
});
it("does not checkpoint a repair that fails verification", async () => {
  const { home, context } = await fixture();
  const runner: Runner = { async run(command) { return { exitCode: command === "repair" ? 0 : 1, stdout: "", stderr: "" }; } };
  const config = await resolveConfig({ resources: [provision("broken", { type: "check", check: { command: "probe" }, repair: [{ command: "repair" }] })] }, context);
  await expect(applyPlan(config, runner)).rejects.toThrow("verification failed");
  expect((await readState(config.stateFile, "test")).resources).toEqual({});
  expect(await readFile(join(home, ".local/state/workstation/configs", config.stateFile.split("/").at(-2)!, "pending.json"), "utf8")).toContain("broken");
});
it("rejects a repository key mismatch before any privileged command", async () => {
  const calls: string[] = [];
  const runner: Runner = { async run(command, args) {
    calls.push(command);
    if (command === "curl") await writeFile(args.at(-1)!, "untrusted key");
    return { exitCode: 0, stdout: "", stderr: "" };
  } };
  await expect(installProvision(provision("docker", { type: "apt-repository", name: "docker", uri: "https://example.test", suite: "noble", components: ["stable"], architecture: "amd64", keyUrl: "https://example.test/key", keySha256: "0".repeat(64) }), runner)).rejects.toThrow("digest mismatch");
  expect(calls).toEqual(["curl"]);
});
it("checks existing service activation as well as enablement", async () => {
  const runner: Runner = { async run(_command, args) { return { exitCode: args.includes("is-active") ? 3 : 0, stdout: "", stderr: "" }; } };
  expect((await inspectProvision(provision("docker", { type: "service", manager: "systemd", scope: "system", name: "docker.service" }), runner)).matches).toBe(false);
});
it("rejects unknown dependencies before writes or bootstrap commands", async () => {
  const { home, context } = await fixture();
  const client = createWorkstation({ configPath: join(home, "config.ts"), context, config: { resources: [provision("bad", { type: "linger", user: "test" }, ["missing"])] }, runner: silent });
  await expect(client.build()).rejects.toThrow("Unknown resource dependency");
});
it("rejects non-regular copy targets", async () => {
  const { home, context } = await fixture();
  await writeFile(join(home, "defaults"), "defaults");
  await mkdir(join(home, "target"));
  const config = await resolveConfig({ resources: [provision("copy", { type: "copy-file", source: "defaults", target: "~/target", seed: true })] }, context);
  await expect(applyPlan(config, silent)).rejects.toThrow("non-regular");
});

it("renders mise activation from installed pins and keeps status stable", async () => {
  const { home, context } = await fixture();
  const runner: Runner = { async run(command, args) {
    if (command === "mise" && args[0] === "latest") return { exitCode: 0, stdout: "26.8.1\n", stderr: "" };
    if (command === "mise" && args[0] === "where") return { exitCode: 0, stdout: "/installed/node\n", stderr: "" };
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  } };
  const client = createWorkstation({ configPath: join(home, "config.ts"), context, runner, config: { resources: [
    { kind: "package", manager: "mise", name: "node", version: "lts" },
    files.mise(join(home, "mise.toml"), { node: "lts" }),
  ] } });
  await client.build();
  expect(await readFile(join(home, "mise.toml"), "utf8")).toContain('node = "26.8.1"');
  expect(await client.build()).toEqual([]);
  expect((await client.status()).every(entry => entry.status === "converged")).toBe(true);
});

it("does not probe a dependent command until its changed environment has been written", async () => {
  const { home, context } = await fixture();
  const file = files.json(join(home, "environment"), { ready: true });
  const runner: Runner = { async run(command) {
    expect(await readFile(file.target, "utf8")).toContain('"ready": true');
    expect(command).toBe("probe");
    return { exitCode: 0, stdout: "", stderr: "" };
  } };
  const config = await resolveConfig({ resources: [file, provision("probe", { type: "check", check: { command: "probe" }, repair: [{ command: "must-not-repair" }] }, [resourceId(file)])] }, context);
  await applyPlan(config, runner);
});
