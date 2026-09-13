import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig, loadConfig } from "../src/config/load.js";
import { tools } from "../src/api/config.js";
import { lockConfig } from "../src/persistence/lock.js";
import { readManifest, writeManifest } from "../src/persistence/manifest.js";
import { readState } from "../src/persistence/state.js";
import { fingerprint, resourceId } from "../src/config/identity.js";
import type { Context, Runner } from "../src/api/types.js";

async function context(): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), "workstation-ownership-"));
  return { machine: "test", hostname: "test", platform: "darwin", home: root, configDir: root };
}

const noCommands: Runner = { run: async () => { throw new Error("Unexpected package-manager query"); } };

describe("package ownership configuration", () => {
  it("merges manager defaults across fragments, resolves system and honors per-package overrides", async () => {
    const config = await resolveConfig([
      { packageOwnership: { brew: "adopt", "brew-cask": "own" } },
      { packageOwnership: { brew: "own" }, resources: [
        tools.system(["fzf"]), tools.brewCask(["ghostty"]), tools.mise(["node"]),
        { kind: "package", manager: "brew", name: "git", ownership: "adopt" },
      ] },
    ], await context());
    expect(config.resources).toEqual([
      { kind: "package", manager: "brew", name: "fzf", ownership: "own" },
      { kind: "package", manager: "brew-cask", name: "ghostty", ownership: "own" },
      { kind: "package", manager: "mise", name: "node", version: "latest" },
      { kind: "package", manager: "brew", name: "git", ownership: "adopt" },
    ]);
  });

  it.each([null, true, [], { brew: true }, { brew: "owned" }, { system: "own" }, { typo: "own" }])("rejects invalid manager policies: %j", async (policy) => {
    const ctx = await context();
    const path = join(ctx.configDir, "workstation.config.ts");
    await writeFile(path, `export default { packageOwnership: ${JSON.stringify(policy)} };`);
    await expect(loadConfig(path)).rejects.toThrow("Invalid packageOwnership");
  });

  it("rejects invalid per-package policies in config, manifests and state", async () => {
    const ctx = await context();
    const path = join(ctx.configDir, "workstation.config.ts");
    const invalid = { kind: "package", manager: "brew", name: "fzf", ownership: "owned" };
    await writeFile(path, `export default { resources: [${JSON.stringify(invalid)}] };`);
    await expect(loadConfig(path)).rejects.toThrow("Invalid package resource");
    const config = await resolveConfig({ packageOwnership: { brew: "own" }, resources: tools.brew(["fzf"]) }, ctx);
    const manifest = join(ctx.configDir, "config.toml");
    await writeManifest(manifest, config);
    await writeFile(manifest, (await readFile(manifest, "utf8")).replace('ownership = "own"', 'ownership = "owned"'));
    await expect(readManifest(manifest)).rejects.toThrow("Invalid package ownership");
    const resource = config.resources[0]!;
    const id = resourceId(resource);
    const state = join(ctx.configDir, "state.json");
    await writeFile(state, JSON.stringify({ version: 1, machine: ctx.machine, resources: { [id]: { id, resource: invalid, fingerprint: fingerprint(resource), owned: true } } }));
    await expect(readState(state, ctx.machine)).rejects.toThrow();
  });

  it("preserves pins and frozen locks when ownership alone changes", async () => {
    const ctx = await context();
    const path = join(ctx.configDir, "workstation.config.ts");
    const config = await resolveConfig({ resources: tools.brew(["fzf"]) }, ctx);
    const resolver: Runner = { run: async () => ({ exitCode: 0, stderr: "", stdout: JSON.stringify({ formulae: [{ versions: { stable: "0.74.3" } }] }) }) };
    await lockConfig(path, config, resolver);
    const owned = await resolveConfig({ packageOwnership: { brew: "own" }, resources: tools.brew(["fzf"]) }, ctx);
    const locked = await lockConfig(path, owned, noCommands, { frozen: true });
    expect(locked.changed).toBe(false);
    expect(locked.config.resources).toEqual([{ kind: "package", manager: "brew", name: "fzf", ownership: "own", lockedVersion: "0.74.3" }]);
  });
});
