import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { resolveAfterApply } from "../src/config/hooks.js";
import { resolveConfig } from "../src/config/load.js";
import { runAfterApply } from "../src/resources/hooks.js";
import { readManifest, writeManifest } from "../src/persistence/manifest.js";
import { createWorkstation, defineConfig, linux, task, files, type Context } from "../src/index.js";

const context: Context = { machine: "test", hostname: "test", platform: "linux", home: "/home/test", configDir: "/repo" };

it("appends hooks from matching fragments and resolves their command options", async () => {
  const config = await resolveConfig(defineConfig([
    { afterApply: [task("first", ["$(literal)"], { description: "First", environment: { MODE: "test" } })] },
    linux({ afterApply: [task("second", [], { cwd: "scripts" }), task("third", [], { cwd: "~/tools" })] }),
    false,
  ]), context);
  expect(config.afterApply).toEqual([
    { command: "first", args: ["$(literal)"], description: "First", environment: { MODE: "test" }, cwd: "/repo" },
    { command: "second", args: [], cwd: "/repo/scripts" },
    { command: "third", args: [], cwd: "/home/test/tools" },
  ]);
  const darwin = await resolveConfig([{}, linux({ afterApply: [task("ignored")] })], { ...context, platform: "darwin" });
  expect(darwin.afterApply).toBeUndefined();
  const root = await mkdtemp(join(tmpdir(), "workstation-hooks-"));
  const path = join(root, "config.toml");
  await writeManifest(path, config);
  expect((await readManifest(path)).afterApply).toEqual(config.afterApply);
});

it.each([null, "echo", {}, [null], [{ command: " " }], [{ command: "echo", args: [1] }],
  [{ command: "echo", cwd: 1 }], [{ command: "echo", environment: { BAD: 1 } }], [{ command: "echo", description: 1 }]])(
  "rejects invalid hook data before execution: %j", (value) => {
    expect(() => resolveAfterApply(value, context)).toThrow(/afterApply/);
  },
);

it("rejects malformed hooks when reading a manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "workstation-hook-manifest-"));
  const path = join(root, "config.toml");
  const config = await resolveConfig({ afterApply: [task("valid")] }, context);
  await writeManifest(path, config);
  await writeFile(path, (await readFile(path, "utf8")).replace('command = "valid"', 'command = 42'));
  await expect(readManifest(path)).rejects.toThrow(/afterApply/);
});

it("streams literal arguments and stops on the first failed hook with failure details", async () => {
  const config = await resolveConfig({ afterApply: [
    task("first", ["$(literal)"], { environment: { MODE: "test" } }),
    task("second"), task("never"),
  ] }, context);
  const run = vi.fn().mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
    .mockResolvedValueOnce({ exitCode: 7, stdout: "", stderr: "broken" });
  await expect(runAfterApply(config, { run })).rejects.toThrow(/afterApply\[1\].*\(7\).*broken/);
  expect(run.mock.calls).toEqual([
    ["first", ["$(literal)"], { cwd: "/repo", environment: { MODE: "test" }, streamOutput: true }],
    ["second", [], { cwd: "/repo", streamOutput: true }],
  ]);
});

it("runs embedded build hooks after resource writes, including converged builds, but not plans", async () => {
  const root = await mkdtemp(join(tmpdir(), "workstation-hook-build-"));
  const run = vi.fn(async () => {
    expect(await readFile(join(root, "ready"), "utf8")).toContain("ready");
    return { exitCode: 0, stdout: "", stderr: "" };
  });
  const client = createWorkstation({ configPath: join(root, "inline.ts"), context: { ...context, home: root, configDir: root },
    config: { resources: [files.json("ready", "ready")], afterApply: [task("check")] }, runner: { run },
  });
  await client.plan();
  expect(run).not.toHaveBeenCalled();
  await client.build();
  expect(run).toHaveBeenCalledTimes(1);
  expect(await client.build()).toEqual([]);
  expect(run).toHaveBeenCalledTimes(2);
});
