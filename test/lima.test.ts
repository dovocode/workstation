import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm, stat, access, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { lima, resolveConfig, type Context, type LimaVmOptions, type TaskDefinition } from "../src/index.js";

const context: Context = { platform: "darwin", home: "/tmp/test", configDir: "/project", hostname: "studio", machine: "studio" };
const image = { url: "https://example.com/ubuntu.img", sha256: "a".repeat(64), architecture: "aarch64" as const };
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "workstation lima ")); roots.push(root);
  const cli = join(root, "limactl");
  await writeFile(cli, `#!${process.execPath}
const fs = require('node:fs'); const path = require('node:path');
const a=process.argv.slice(2), dir=path.join(process.env.LIMA_HOME,'code'), status=path.join(dir,'status');
fs.appendFileSync(${JSON.stringify(join(root, "calls"))},JSON.stringify(a)+'\\n');
if(a[0]==='create') {fs.mkdirSync(dir,{recursive:true}); fs.copyFileSync(a.at(-1),path.join(dir,'lima.yaml')); fs.writeFileSync(status,'Stopped');}
else if(a[0]==='start') fs.writeFileSync(status,'Running');
else if(a[0]==='stop') fs.writeFileSync(status,'Stopped');
else if(a[0]==='list') console.log(JSON.stringify({name:'code',status:fs.readFileSync(status,'utf8')}));
else if(a[0]==='shell') {if(process.env.FAIL_GUEST)process.exit(23); if(a[2]==='echo-args'){console.log(JSON.stringify(a.slice(3)));process.exit(17);} fs.readFileSync(0,'utf8');}
else process.exit(99);
`, { mode: 0o755 });
  const disk = join(root, "disk.raw");
  const options: LimaVmOptions = { image, dataDisk: { path: disk, sizeGiB: 1 }, guestScript: "set -eu\ntrue\n", cli };
  const config = (overrides: Partial<LimaVmOptions> = {}) => resolveConfig(lima.vm("code", { ...options, ...overrides }), { ...context, home: root });
  const run = (task: TaskDefinition | undefined, args: string[] = [], env: Record<string, string> = {}) => {
    if (!task) throw new Error("Missing task");
    return spawnSync(task.command, [...task.args ?? [], ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  };
  return { root, disk, options, config, run };
}

it("validates declarations without touching the host", async () => {
  const f = await fixture();
  const config = await f.config();
  expect(Object.keys(config.tasks ?? {})).toEqual(["code:up", "code:stop", "code:status", "code:exec", "code:provision"]);
  await expect(access(f.disk)).rejects.toThrow();
  expect(() => lima.vm("bad/name", f.options)).toThrow();
  expect(() => lima.vm("code", { ...f.options, dataDisk: { path: "relative.raw", sizeGiB: 1 } })).toThrow();
  expect(() => lima.vm("code", { ...f.options, memoryGiB: 0 })).toThrow();
  await expect(resolveConfig(lima.vm("code", f.options), { ...context, platform: "linux" })).rejects.toThrow("macOS");
});

it("creates a sparse external disk, attaches it without copying and retains it across starts/stops", async () => {
  const f = await fixture(); const tasks = (await f.config()).tasks;
  expect(f.run(tasks?.["code:status"]).status).not.toBe(0);
  await expect(access(join(f.root, ".local"))).rejects.toThrow();
  let result = f.run(tasks?.["code:up"]); expect(result.status, result.stderr).toBe(0);
  const initial = await stat(f.disk); expect(initial.size).toBe(1024 ** 3);
  expect(initial.blocks * 512).toBeLessThan(1024 ** 2);
  const yaml = JSON.parse(await readFile(join(f.root, ".lima/code/lima.yaml"), "utf8"));
  expect(yaml.plain).toBe(true); expect(yaml.additionalDisks).toEqual([{ name: "ws-code", format: false }]);
  expect((await stat(join(f.root, ".lima/_disks/ws-code/datadisk"))).ino).toBe(initial.ino);
  expect(f.run(tasks?.["code:stop"]).status).toBe(0);
  expect(f.run(tasks?.["code:status"]).status).not.toBe(0);
  result = f.run(tasks?.["code:up"]); expect(result.status, result.stderr).toBe(0);
  expect((await stat(f.disk)).ino).toBe(initial.ino);
  expect(f.run(tasks?.["code:status"]).status).toBe(0);
  const exec = f.run(tasks?.["code:exec"], ["echo-args", "literal $(id)", "two words"]);
  expect(exec.status).toBe(17); expect(JSON.parse(exec.stdout)).toEqual(["literal $(id)", "two words"]);
});

it("preserves unmanaged files and refuses changed disk identity or configuration", async () => {
  const f = await fixture(); const tasks = (await f.config()).tasks;
  await writeFile(f.disk, "existing data");
  expect(f.run(tasks?.["code:up"]).stderr).toContain("Refusing to adopt");
  expect(await readFile(f.disk, "utf8")).toBe("existing data");
  await rm(f.disk);
  await symlink(join(f.root, "absent"), f.disk);
  expect(f.run(tasks?.["code:up"]).stderr).toContain("Refusing to adopt");
  await rm(f.disk);
  expect(f.run(tasks?.["code:up"]).status).toBe(0);
  const changed = (await f.config({ cpus: 8 })).tasks;
  expect(f.run(changed?.["code:up"]).stderr).toContain("explicit migration");
  await writeFile(join(f.root, ".lima/code/lima.yaml"), "external edit");
  expect(f.run(tasks?.["code:up"]).stderr).toContain("configuration changed");
});

it("does not checkpoint failed guest setup and retries against the same disk", async () => {
  const f = await fixture(); const tasks = (await f.config()).tasks;
  expect(f.run(tasks?.["code:up"], [], { FAIL_GUEST: "1" }).status).toBe(23);
  const ino = (await stat(f.disk)).ino;
  expect(f.run(tasks?.["code:status"]).stderr).toContain("Guest setup changed");
  expect(f.run(tasks?.["code:up"]).status).toBe(0);
  expect((await stat(f.disk)).ino).toBe(ino);
  const changed = (await f.config({ guestScript: "echo new setup" })).tasks;
  expect(f.run(changed?.["code:status"]).stderr).toContain("Guest setup changed");
  expect(f.run(changed?.["code:provision"]).status).toBe(0);
  expect(f.run(changed?.["code:status"]).status).toBe(0);
});

it("refuses to fabricate a missing parent volume", async () => {
  const f = await fixture();
  const config = await f.config({ dataDisk: { path: join(f.root, "absent", "disk.raw"), sizeGiB: 1 } });
  expect(f.run(config.tasks?.["code:up"]).stderr).toContain("must already be mounted");
  await expect(access(join(f.root, "absent"))).rejects.toThrow();
});

it("rejects foreign registry entries and disk replacements without starting the VM", async () => {
  const f = await fixture(); const tasks = (await f.config()).tasks;
  const result = f.run(tasks?.["code:up"]); expect(result.status, result.stderr).toBe(0);
  const calls = await readFile(join(f.root, "calls"), "utf8");
  await rm(f.disk); await writeFile(f.disk, "replacement");
  expect(f.run(tasks?.["code:up"]).stderr).toContain("size or identity changed");
  expect(await readFile(join(f.root, "calls"), "utf8")).toBe(calls);
  expect(await readFile(f.disk, "utf8")).toBe("replacement");
});


it("rejects filesystem migrations before CLI calls but allows compression tuning", async () => {
  const f = await fixture();
  const dataDisk = { path: f.disk, sizeGiB: 1 };
  const original = await f.config({ dataDisk: { ...dataDisk, storage: { filesystem: "btrfs", mountPoint: "/code" } } });
  const created = f.run(original.tasks?.["code:up"]);
  expect(created.status, created.stderr).toBe(0);
  const inode = (await stat(f.disk)).ino;
  const calls = await readFile(join(f.root, "calls"), "utf8");
  const changed = await f.config({ dataDisk: { ...dataDisk, storage: { filesystem: "ext4", mountPoint: "/code" } } });
  expect(f.run(changed.tasks?.["code:up"]).stderr).toContain("explicit migration");
  expect(await readFile(join(f.root, "calls"), "utf8")).toBe(calls);
  const tuned = await f.config({ dataDisk: { ...dataDisk, storage: { filesystem: "btrfs", mountPoint: "/code", compression: false } } });
  const result = f.run(tuned.tasks?.["code:provision"]);
  expect(result.status, result.stderr).toBe(0);
  expect((await stat(f.disk)).ino).toBe(inode);
});
