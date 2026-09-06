import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CommandResult, PackageManager, ResolvedConfig, ResolvedPackageResource, Runner, RunOptions } from "../src/api/types.js";
import { applyPlan } from "../src/reconciliation/apply.js";
import { readState, writeState } from "../src/persistence/state.js";
import { fingerprint, resourceId } from "../src/config/identity.js";

const managers = ["brew", "brew-cask", "mise", "apt", "dnf", "yum", "pacman", "flatpak", "mas"] as const;
const ok = (stdout = ""): CommandResult => ({ exitCode: 0, stdout, stderr: "" });

/** Model installed state rather than relying on a brittle sequence of query responses. */
async function fixture(manager: PackageManager) {
  const root = await mkdtemp(join(tmpdir(), "workstation-batch-"));
  const version = manager === "flatpak" ? "b".repeat(64) : ["dnf", "yum"].includes(manager) ? "0:2-1.x86_64" : "2";
  const oldVersion = manager === "flatpak" ? "a".repeat(64) : ["dnf", "yum"].includes(manager) ? "0:1-1.x86_64" : "1";
  const names = manager === "mas" ? ["123", "456"] : manager === "flatpak" ? ["org.example.Alpha", "org.example.Beta"] : ["alpha", "beta"];
  const resources: ResolvedPackageResource[] = names.map((name) => ({ kind: "package", manager, name, ...(manager === "mas" ? {} : { lockedVersion: version }) }));
  const installed = new Map<string, string>();
  const mutations: Array<{ command: string; args: readonly string[]; options?: RunOptions }> = [];
  let fail = false;
  let wrong = false;
  let available = version;
  const runner: Runner = { async run(command, args, options) {
    const name = args.at(-1) ?? "";
    const current = installed.get(name);
    if (command === "brew" && args[0] === "list") return current ? ok(name) : { ...ok(), exitCode: 1 };
    if (command === "brew" && args[0] === "info") return ok(JSON.stringify(manager === "brew" ? { formulae: [{ versions: { stable: available }, installed: current ? [{ version: current }] : [] }] } : { casks: [{ version: available, installed: current ?? null }] }));
    if (command === "mise" && args[0] === "where") {
      const [tool, pin] = name.split("@");
      return tool && installed.get(tool) === pin ? ok(`/mise/${tool}/${pin}`) : { ...ok(), exitCode: 1 };
    }
    if (command === "dpkg-query") return current ? ok(`install ok installed\t${current}`) : { ...ok(), exitCode: 1 };
    if (command === "rpm" && args[0] === "-q") return current ? ok(current) : { ...ok(`package ${name} is not installed`), exitCode: 1 };
    if (command === "rpm" && args[0] === "--eval") return ok("-1");
    if (command === "pacman" && args[0] === "-Q") return current ? ok(`${name} ${current}`) : { ...ok(), exitCode: 1, stderr: `error: package '${name}' was not found` };
    if (command === "pacman" && args[0] === "-Sp") return ok(`${name}\t${available}`);
    if (command === "flatpak" && args[0] === "list") return ok([...installed.keys()].map((id) => `${id}\tstable\tflathub`).join("\n"));
    if (command === "flatpak" && args[0] === "info") return ok(installed.get(name.split("/")[1] ?? "") ?? "");
    if (command === "flatpak" && args[0] === "remote-info") return ok(available);
    if (command === "mas" && ["list", "outdated"].includes(args[0] ?? "")) return ok([...installed].filter(([, pin]) => args[0] === "list" || pin !== version).map(([id, pin]) => `${id} Test App (${pin})`).join("\n"));
    mutations.push({ command, args, ...(options ? { options } : {}) });
    const removing = args.includes("remove") || args.includes("uninstall") || args.includes("-R");
    const targets = names.filter((id) => args.some((arg) => arg === id || arg === `${id}=${version}` || arg === `${id}-${version}` || arg.startsWith(`${id}@`) || arg === `app/${id}//stable`));
    if (!targets.length) throw new Error(`Unexpected mutation: ${command} ${args.join(" ")}`);
    for (const id of fail ? targets.slice(0, 1) : targets) {
      if (removing) installed.delete(id);
      else installed.set(id, wrong ? oldVersion : version);
    }
    return fail ? { ...ok(), exitCode: 1, stderr: "transaction failed" } : ok();
  } };
  const config: ResolvedConfig = { context: { machine: "test", hostname: "test", platform: "linux", home: root, configDir: root }, stateFile: join(root, "state.json"), resources };
  return { config, resources, runner, mutations, installed, version, oldVersion,
    fail: (value: boolean) => { fail = value; }, wrong: () => { wrong = true; }, unavailable: () => { available = "unavailable"; } };
}

describe.each(managers)("%s native batches", (manager) => {
  it("installs and removes multiple targets with per-package ownership and idempotence", async () => {
    const f = await fixture(manager);
    await applyPlan(f.config, f.runner);
    expect(f.mutations).toHaveLength(1);
    expect(f.installed.size).toBe(2);
    expect(Object.values((await readState(f.config.stateFile, "test")).resources).every((entry) => entry.owned)).toBe(true);
    expect(await applyPlan(f.config, f.runner)).toEqual([]);
    await applyPlan({ ...f.config, resources: [] }, f.runner);
    expect(f.mutations).toHaveLength(2);
    expect(f.installed.size).toBe(0);
    expect((await readState(f.config.stateFile, "test")).resources).toEqual({});
  });

  it("upgrades multiple targets, preserving adopted ownership where versions coexist", async () => {
    const f = await fixture(manager);
    for (const resource of f.resources) f.installed.set(resource.name, f.oldVersion);
    await applyPlan(f.config, f.runner);
    // Flatpak's --commit only accepts one ref; all other backends use one native transaction.
    expect(f.mutations).toHaveLength(manager === "flatpak" ? 2 : 1);
    expect([...f.installed.values()]).toEqual([f.version, f.version]);
    const entries = Object.values((await readState(f.config.stateFile, "test")).resources);
    expect(entries.every((entry) => entry.owned === (manager === "mise"))).toBe(true);
  });
});

describe("batch safety", () => {
  it("saves successful partial installs and retries only missing targets", async () => {
    const f = await fixture("apt");
    f.fail(true);
    await expect(applyPlan(f.config, f.runner)).rejects.toThrow("transaction failed");
    const state = await readState(f.config.stateFile, "test");
    expect(Object.keys(state.resources)).toEqual(["package:apt:alpha"]);
    expect(state.resources["package:apt:alpha"]?.owned).toBe(true);
    f.fail(false);
    await applyPlan(f.config, f.runner);
    expect(f.mutations[1]?.args).toEqual(["apt-get", "install", "-y", "--allow-downgrades", "beta=2"]);
  });

  it("retains ownership of a created package even when a success exit installs the wrong version", async () => {
    const f = await fixture("apt");
    f.wrong();
    await expect(applyPlan(f.config, f.runner)).rejects.toThrow("did not converge");
    const entries = Object.values((await readState(f.config.stateFile, "test")).resources);
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.owned && entry.installedVersion === "1")).toBe(true);
  });

  it("checkpoints partial removals and retains state for packages still installed", async () => {
    const f = await fixture("brew");
    await applyPlan(f.config, f.runner);
    f.fail(true);
    await expect(applyPlan({ ...f.config, resources: [] }, f.runner)).rejects.toThrow("transaction failed");
    expect(Object.keys((await readState(f.config.stateFile, "test")).resources)).toEqual(["package:brew:beta"]);
  });

  it("preflights all pins before beginning a package phase", async () => {
    const f = await fixture("brew");
    const runner: Runner = { async run(command, args, options) {
      if (command === "brew" && args[0] === "info" && args.at(-1) === "beta") f.unavailable();
      return f.runner.run(command, args, options);
    } };
    await expect(applyPlan(f.config, runner)).rejects.toThrow("workstation.lock pins");
    expect(f.mutations).toEqual([]);
  });

  it("keeps Flatpak user and system installs in separate native transactions", async () => {
    const f = await fixture("flatpak");
    const resources = f.resources.map((resource, index) => ({ ...resource, flatpak: { scope: index === 0 ? "user" as const : "system" as const } }));
    await applyPlan({ ...f.config, resources }, f.runner);
    expect(f.mutations.map(({ command }) => command)).toEqual(["sudo", "flatpak"]);
  });

  it("stops before later incompatible batches after a native failure", async () => {
    const f = await fixture("brew-cask");
    for (const resource of f.resources) f.installed.set(resource.name, f.oldVersion);
    const resources = f.resources.map((resource, index) => ({ ...resource, upgrade: { force: index === 0 } }));
    f.fail(true);
    await expect(applyPlan({ ...f.config, resources }, f.runner)).rejects.toThrow("transaction failed");
    expect(f.mutations).toHaveLength(1);
    expect(f.installed.get("beta")).toBe(f.oldVersion);
  });

  it("does not combine different cask upgrade policies", async () => {
    const f = await fixture("brew-cask");
    for (const resource of f.resources) f.installed.set(resource.name, f.oldVersion);
    const resources = f.resources.map((resource, index) => ({ ...resource, upgrade: { force: index === 0 } }));
    await applyPlan({ ...f.config, resources }, f.runner);
    expect(f.mutations).toHaveLength(2);
    expect(f.mutations[0]?.args).toContain("--force");
    expect(f.mutations[1]?.args).not.toContain("--force");
  });

  it("does not remove adopted packages when their declarations disappear", async () => {
    const f = await fixture("mas");
    await writeState(f.config.stateFile, { version: 1, machine: "test", resources: Object.fromEntries(f.resources.map((resource) => {
      const id = resourceId(resource);
      return [id, { id, resource, fingerprint: fingerprint(resource), owned: false }];
    })) });
    await applyPlan({ ...f.config, resources: [] }, f.runner);
    expect(f.mutations).toEqual([]);
  });
});
