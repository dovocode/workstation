import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { lockConfig } from "../src/persistence/lock.js";
import { readState, writeState } from "../src/persistence/state.js";
import { readManifest } from "../src/persistence/manifest.js";
import { fingerprint, resourceId } from "../src/config/identity.js";
import type { ResolvedConfig, ResolvedPackageResource, Runner } from "../src/api/types.js";

const environment = vi.hoisted(() => ({ platform: "linux" }));
vi.mock("node:os", async () => ({ ...await vi.importActual<typeof import("node:os")>("node:os"), platform: () => environment.platform }));

describe("app package configuration and persistence", () => {
  it("normalizes Flatpak defaults and keeps system and user installations separate", async () => {
    environment.platform = "linux";
    const root = await mkdtemp(join(tmpdir(), "workstation-app-config-"));
    const path = join(root, "workstation.config.ts");
    await writeFile(path, `export default { resources: [
      { kind: "package", manager: "flatpak", name: "org.example.App" },
      { kind: "package", manager: "flatpak", name: "org.example.App", flatpak: { scope: "system" } },
      { kind: "package", manager: "pacman", name: "jq" }
    ] }`);
    const config = await loadConfig(path);
    expect(config.resources).toHaveLength(3);
    expect(config.resources[0]).toMatchObject({ flatpak: { scope: "user", remote: "flathub", branch: "stable" } });
    expect(config.resources[1]).toMatchObject({ flatpak: { scope: "system", remote: "flathub", branch: "stable" } });
  });

  it.each([
    { platform: "linux", manager: "mas", name: "123" },
    { platform: "darwin", manager: "pacman", name: "jq" },
    { platform: "darwin", manager: "flatpak", name: "org.example.App" },
  ])("rejects $manager on $platform", async ({ platform, manager, name }) => {
    environment.platform = platform;
    const root = await mkdtemp(join(tmpdir(), "workstation-app-platform-"));
    const path = join(root, "workstation.config.ts");
    await writeFile(path, `export default { resources: [{ kind: "package", manager: "${manager}", name: "${name}" }] }`);
    await expect(loadConfig(path)).rejects.toThrow("requires");
  });

  it.each(["pacman", "flatpak", "mas"] as const)("persists %s ownership and appropriate lock semantics", async (manager) => {
    const root = await mkdtemp(join(tmpdir(), "workstation-app-lock-"));
    const resource: ResolvedPackageResource = { kind: "package", manager, name: manager === "mas" ? "123" : manager === "flatpak" ? "org.example.App" : "jq" };
    let queries = 0;
    const runner: Runner = { async run() {
      queries++;
      if (manager === "mas") throw new Error("mas must not resolve a version pin");
      return { exitCode: 0, stdout: manager === "pacman" ? "jq\t1.8.1-2" : "a".repeat(64), stderr: "" };
    } };
    const config: ResolvedConfig = { context: { machine: "test", hostname: "test", platform: manager === "mas" ? "darwin" : "linux", home: root, configDir: root },
      resources: [resource], stateFile: join(root, "state.json") };
    const locked = await lockConfig(join(root, "workstation.config.ts"), config, runner);
    const second = await lockConfig(join(root, "workstation.config.ts"), config, runner);
    expect(second.changed).toBe(false);
    expect(queries).toBe(manager === "mas" ? 0 : 1);
    const resolved = locked.config.resources[0];
    if (!resolved) throw new Error("Expected locked resource");
    const id = resourceId(resolved);
    const state = { version: 1 as const, machine: "test", resources: { [id]: { id, fingerprint: fingerprint(resolved), resource: resolved, owned: true } } };
    await writeState(config.stateFile, state);
    expect(await readState(config.stateFile, "test")).toEqual(state);
  });

  it("rejects invalid persisted MAS pins and Flatpak options", async () => {
    const root = await mkdtemp(join(tmpdir(), "workstation-app-manifest-"));
    const path = join(root, "config.toml");
    const header = `version = 1\nstate_file = "/tmp/state.json"\n[context]\nmachine = "test"\nhostname = "test"\nplatform = "darwin"\nhome = "/tmp"\nconfig_dir = "/tmp"\n`;
    await writeFile(path, `${header}[[resources]]\nkind = "package"\nmanager = "mas"\nname = "123"\nlocked_version = "1.0"\n`);
    await expect(readManifest(path)).rejects.toThrow("does not support version pins");
    await writeFile(path, `${header}[[resources]]\nkind = "package"\nmanager = "flatpak"\nname = "org.example.App"\nflatpak = { scope = "global" }\n`);
    await expect(readManifest(path)).rejects.toThrow("Invalid Flatpak options");
  });
});
