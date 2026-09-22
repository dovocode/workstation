import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cua, createWorkstation, ProcessRunner, type TaskDefinition } from "../src/index.js";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

it("targets named local Cua sandboxes and keeps host/runtime options separate", () => {
  expect(cua.create("desktop", "ubuntu:24.04", { vm: true, cpus: 2, memory: "4GB", disk: "20GB", cli: "/venv/bin/cua", python: "/venv/bin/python", cwd: "/project" })).toEqual({ command: "/venv/bin/cua", args: ["sandbox", "launch", "--local", "--name", "desktop", "--vm", "--cpu", "2", "--memory", "4GB", "--disk", "20GB", "ubuntu:24.04"], cwd: "/project" });
  for (const [helper, operation] of [[cua.suspend, "suspend"], [cua.resume, "resume"], [cua.restart, "restart"], [cua.vnc, "vnc"]] as const) expect(helper("desktop").args).toEqual(["sandbox", operation, "--local", "desktop"]);
  expect(cua.status("desktop").args).toEqual(["sandbox", "info", "--local", "--json", "desktop"]);
  expect(cua.remove("desktop").args).toEqual(["sandbox", "delete", "--local", "--force", "desktop"]);
  expect(() => cua.remove("--all")).toThrow();
  expect(() => cua.create("dev", "--help")).toThrow();
  expect(() => cua.create("dev", "ubuntu", { memory: "4096" })).toThrow();
  expect(() => cua.click("dev", -1, 0)).toThrow();
  expect(() => cua.scroll("dev", 0, 0, 0.5, 1)).toThrow();
});

/** Provide a fake Cua SDK while executing the real Python bridge and shell quoting. */
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "workstation-cua-")); temporary.push(dir);
  await writeFile(join(dir, "cua_sandbox.py"), `import json, os, shlex
from types import SimpleNamespace
from contextlib import asynccontextmanager

def record(action, *args):
    with open(os.environ['CUA_TEST_LOG'], 'a') as output:
        output.write(json.dumps([action, *args]) + '\\n')

class Surface:
    async def run(self, command, timeout):
        record('exec', command, timeout)
        return SimpleNamespace(stdout=json.dumps(shlex.split(command)), stderr='', returncode=int(os.environ.get('CUA_TEST_EXIT', '0')))
    async def screenshot(self, format):
        record('screenshot', format)
        return b'PNG test bytes'
    async def click(self, x, y, button): record('click', x, y, button)
    async def type(self, text): record('type', text)
    async def keypress(self, keys): record('key', keys)
    async def scroll(self, x, y, scroll_x, scroll_y): record('scroll', x, y, scroll_x, scroll_y)

class Sandbox:
    @staticmethod
    @asynccontextmanager
    async def connect(name, local):
        record('connect', name, local)
        surface = Surface()
        try:
            yield SimpleNamespace(shell=surface, screen=surface, mouse=surface, keyboard=surface)
        finally:
            record('disconnect')
`);
  const environment = { PYTHONPATH: dir, CUA_TEST_LOG: join(dir, "log") };
  /** Run a declaration with the same ProcessRunner used by embedded clients. */
  const run = (task: TaskDefinition, extra: readonly string[] = [], overrides: Record<string, string> = {}) => new ProcessRunner().run(task.command, [...task.args ?? [], ...extra], { environment: { ...environment, ...overrides } });
  return { dir, environment, run };
}

it("preserves literal guest arguments, appended task arguments, output and exit codes", async () => {
  const f = await fixture();
  const args = ["printf", "a b", "$(touch /NO)", "'quoted'", "", "line\nbreak"] as const;
  const result = await f.run(cua.exec("desktop", args), [";literal"], { CUA_TEST_EXIT: "23" });
  expect(result.exitCode, result.stderr).toBe(23);
  expect(JSON.parse(result.stdout)).toEqual([...args, ";literal"]);
  const log = await readFile(join(f.dir, "log"), "utf8");
  expect(log).toContain('["connect", "desktop", true]');
  expect(log.trim().split("\n").at(-1)).toBe('["disconnect"]');
  expect(log).not.toContain("destroy");
});

it("controls the named desktop and saves screenshots without replacing existing files", async () => {
  const f = await fixture();
  const output = join(f.dir, "screen.png");
  for (const declaration of [cua.click("desktop", 10, 20), cua.type("desktop", "hello ' $(world)\n"), cua.key("desktop", ["ctrl", "a"]), cua.scroll("desktop", 10, 20, 0, -3), cua.screenshot("desktop", output)]) {
    const result = await f.run(declaration);
    expect(result.exitCode, result.stderr).toBe(0);
  }
  expect(await readFile(output, "utf8")).toBe("PNG test bytes");
  expect((await f.run(cua.screenshot("desktop", output))).exitCode).not.toBe(0);
  expect(await readFile(output, "utf8")).toBe("PNG test bytes");
  expect((await f.run(cua.click("desktop", 1, 2), ["unexpected"])).exitCode).not.toBe(0);
});

it("runs nested Workstation through the embedded client using the guest configuration", async () => {
  const f = await fixture();
  const client = createWorkstation({ config: { tasks: { setup: cua.workstation("desktop", { config: "/guest/my config.ts", plan: true, frozen: true, noRemove: true }, { environment: f.environment }) } }, context: { home: f.dir, configDir: f.dir, machine: "test", hostname: "test", platform: "linux" } });
  const result = await client.task("setup");
  expect(result.exitCode, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual(["workstation", "plan", "--config", "/guest/my config.ts", "--frozen-lockfile", "--no-remove"]);
});
