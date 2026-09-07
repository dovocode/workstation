import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { resolveTasks } from "../src/config/tasks.js";
import { runTask } from "../src/resources/tasks.js";
import { task } from "../src/api/tasks.js";
import type { Context, Runner } from "../src/api/types.js";

const context: Context = { machine: "test", hostname: "test", platform: "linux", home: "/home/test", configDir: "/project" };

describe("custom tasks", () => {
  it("resolves aliases, appends literal arguments, and preserves failure output and status", async () => {
    const config = { context, stateFile: "/unused", resources: [], ...resolveTasks({
      tasks: { test: task("pnpm", ["test"], { cwd: "app", environment: { MODE: "test" } }) },
      aliases: { t: "test", quick: "t" },
    }, context) };
    const calls: unknown[] = [];
    const runner: Runner = { async run(command, args, options) {
      calls.push({ command, args, options });
      return { exitCode: 7, stdout: "output", stderr: "failure" };
    } };
    expect(await runTask(config, "quick", ["$(not-a-command)", "--watch"], runner)).toEqual({ exitCode: 7, stdout: "output", stderr: "failure" });
    expect(calls).toEqual([{ command: "pnpm", args: ["test", "$(not-a-command)", "--watch"], options: { cwd: "/project/app", environment: { MODE: "test" } } }]);
  });

  it("rejects alias cycles, missing targets, and ambiguous names", () => {
    expect(() => resolveTasks({ aliases: { a: "b", b: "a" } }, context)).toThrow("cycle");
    expect(() => resolveTasks({ aliases: { a: "missing" } }, context)).toThrow("Unknown task");
    expect(() => resolveTasks({ tasks: { a: task("echo") }, aliases: { a: "a" } }, context)).toThrow("share a name");
    expect(() => resolveTasks({ tasks: { help: task("echo") } }, context)).toThrow("reserved");
    expect(() => resolveTasks({ tasks: { init: task("echo") } }, context)).toThrow("reserved");
    expect(() => resolveTasks({ tasks: { build: task("echo") } }, context)).toThrow("reserved");
    expect(() => resolveTasks({ tasks: { update: task("echo") } }, context)).toThrow("reserved");
    expect(() => resolveTasks({ aliases: { init: "hello" } }, context)).toThrow("reserved");
  });

  it("merges task-only fragments and applies machine-specific overrides", async () => {
    const root = await mkdtemp(join(tmpdir(), "workstation-tasks-"));
    const path = join(root, "workstation.config.ts");
    await writeFile(path, `export default [
      { tasks: { hello: { command: "echo", args: ["common"] } }, aliases: { hi: "hello" } },
      ({ machine }) => machine === "studio" ? { tasks: { hello: { command: "echo", args: ["studio"] } } } : null,
    ];`);
    const config = await loadConfig(path, "studio");
    expect(config.tasks?.hello).toMatchObject({ command: "echo", args: ["studio"], cwd: root });
    expect(config.aliases).toEqual({ hi: "hello" });
    expect(config.resources).toEqual([]);
  });
});
