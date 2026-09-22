import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { microvm, microsandbox, resolveConfig, ProcessRunner, type Context, type TaskDefinition } from "../src/index.js";

const context: Context = { platform: "darwin", home: "/home/test", configDir: "/project", hostname: "test", machine: "test" };
const artifact = { url: "https://example.com/workstation", sha256: createHash("sha256").update("artifact").digest("hex") };
const shared = { architecture: "aarch64" as const, guest: { workstation: artifact, config: "export default {};" } };
const image = "docker.io/library/ubuntu@sha256:" + "a".repeat(64);
const firecracker = { kernel: artifact, rootfs: artifact, binary: artifact, subnet: "10.231.0.0/30" };
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

it("maps platforms to backends with identical lifecycle task names and explicit overrides", async () => {
  const factory = microvm.vm("dev", { ...shared, microsandbox: { image }, firecracker });
  const mac = await resolveConfig(factory, context);
  const linux = await resolveConfig(factory, { ...context, platform: "linux" });
  expect(mac.tasks?.["dev:up"]?.command).toBe("python3");
  expect(linux.tasks?.["dev:up"]?.command).toBe("sudo");
  expect(Object.keys(mac.tasks ?? {})).toEqual(Object.keys(linux.tasks ?? {}));
  expect(mac.resources).toHaveLength(1);
  expect(JSON.stringify(mac)).not.toContain("limactl");
  const explicit = await resolveConfig(microvm.vm("dev", { ...shared, backend: "microsandbox", microsandbox: { image } }), { ...context, platform: "linux" });
  expect(explicit.resources).toEqual(mac.resources);
  expect(explicit.tasks).toEqual(mac.tasks);
  expect(await resolveConfig(microsandbox.vm("dev", { ...shared, image }), context)).toEqual(mac);
  expect(() => microsandbox.vm("dev", { ...shared, image: "ubuntu:latest" })).toThrow("digest-pinned");
});

/** Execute the production Python adapter against a persistent fake CLI and pinned download. */
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "workstation-microvm-")); temporary.push(dir);
  const cli = join(dir, "msb");
  await writeFile(cli, `#!${process.execPath}
const fs = require('node:fs');
const a=process.argv.slice(2), root=process.env.MSB_TEST_ROOT, file=root+'/state';
if(process.env.MSB_BACKEND!=='local')process.exit(98);
fs.appendFileSync(root+'/calls',JSON.stringify(a)+'\\n');
let s=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;
const save=()=>fs.writeFileSync(file,JSON.stringify(s));
const value=k=>a[a.indexOf(k)+1];
const resources=()=>({cpus:Number(value('--cpus')),memory_mib:parseInt(value('--memory'))});
if(a[0]==='--version')console.log('microsandbox 0.7.1');
else if(a[0]==='ls'){if(process.env.FAIL_LIST)process.exit(27); console.log(JSON.stringify(s?[{name:s.name,status:s.status}]:[]));}
else if(a[0]==='inspect')console.log(JSON.stringify(s));
else if(a[0]==='create'){const [k,v]=value('--label').split('=');s={name:value('--name'),status:'Running',config:{labels:{[k]:v},resources:resources(),image:{Oci:{reference:a.at(-1)}}},disk:'retained'};s.active_config=structuredClone(s.config);save();}
else if(a[0]==='modify'){if(a.includes('--cpus'))s.config.resources=resources();if(a.includes('--label')){const [k,v]=value('--label').split('=');s.config.labels[k]=v;}save();}
else if(a[0]==='stop'){s.status='Stopped';s.active_config=null;save();}
else if(a[0]==='start'){s.status='Running';s.active_config=structuredClone(s.config);save();}
else if(a[0]==='rm'){fs.unlinkSync(file);}
else if(a[0]==='copy'){if(!fs.existsSync(a[1]))process.exit(99);}
else if(a[0]==='exec'){const args=a.slice(a.indexOf('--')+1);if(args[0]==='uname')console.log('aarch64');else if(args[0]==='/usr/local/bin/workstation'&&process.env.FAIL_GUEST)process.exit(19);else if(args[0]==='echo-test'){console.log(JSON.stringify(args.slice(1)));process.exit(Number(process.env.GUEST_EXIT||0));}}
else process.exit(99);
`, { mode: 0o755 });
  await writeFile(join(dir, "sitecustomize.py"), "import io, urllib.request\nurllib.request.OpenerDirector.open = lambda self, url, **kwargs: io.BytesIO(b'artifact')\n");
  /** Re-evaluate desired state to test configuration changes against the same VM. */
  const config = (cpus = 2, selectedImage = image, sha256 = artifact.sha256) => resolveConfig(microvm.vm("dev", { ...shared, cpus, guest: { ...shared.guest, workstation: { ...artifact, sha256 } }, backend: "microsandbox", microsandbox: { image: selectedImage, cli } }), { ...context, home: dir });
  /** Run tasks through the real process runner with an isolated fake backend. */
  const run = (task: TaskDefinition | undefined, extra: string[] = [], env: Record<string, string> = {}) => {
    if (!task) throw new Error("Missing test task");
    return new ProcessRunner().run(task.command, [...task.args ?? [], ...extra], { environment: { PYTHONPATH: dir, MSB_TEST_ROOT: dir, MSB_BACKEND: "cloud", ...env } });
  };
  const tasks = (await config()).tasks;
  return { dir, config, run, tasks };
}

it("checks without mutations, reconciles idempotently, resizes and retains disks", async () => {
  const f = await fixture();
  expect((await f.run(f.tasks?.["dev:status"])).exitCode).toBe(1);
  await expect(access(join(f.dir, ".local"))).rejects.toThrow();
  const up = await f.run(f.tasks?.["dev:up"]); expect(up.exitCode, up.stderr).toBe(0);
  expect((await f.run(f.tasks?.["dev:status"])).exitCode).toBe(0);
  await writeFile(join(f.dir, "calls"), "");
  expect((await f.run(f.tasks?.["dev:up"])).exitCode).toBe(0);
  expect(await readFile(join(f.dir, "calls"), "utf8")).not.toMatch(/create|modify|copy/);
  expect((await f.run(f.tasks?.["dev:stop"])).exitCode).toBe(0);
  expect((await f.run(f.tasks?.["dev:exec"], ["echo-test"])).exitCode).toBe(1);
  const resized = (await f.config(4)).tasks;
  const result = await f.run(resized?.["dev:up"]); expect(result.exitCode, result.stderr).toBe(0);
  const state = JSON.parse(await readFile(join(f.dir, "state"), "utf8"));
  expect(state.disk).toBe("retained"); expect(state.active_config.resources.cpus).toBe(4);
  const args = ["a b", "$(touch BAD)", "'", "", "line\nbreak"];
  const exec = await f.run(resized?.["dev:exec"], ["echo-test", ...args], { GUEST_EXIT: "23" });
  expect(exec.exitCode).toBe(23); expect(JSON.parse(exec.stdout)).toEqual(args);
});

it("fails closed on inventory errors, checksums, unowned VMs and image changes", async () => {
  const f = await fixture();
  expect((await f.run(f.tasks?.["dev:up"], [], { FAIL_LIST: "1" })).exitCode).toBe(27);
  await expect(access(join(f.dir, "state"))).rejects.toThrow();
  const bad = (await f.config(2, image, "b".repeat(64))).tasks;
  expect((await f.run(bad?.["dev:up"])).stderr).toContain("checksum mismatch");
  expect(JSON.parse(await readFile(join(f.dir, "state"), "utf8")).config.labels["workstation.applied"]).toBeUndefined();
  expect((await f.run(f.tasks?.["dev:up"], [], { FAIL_GUEST: "1" })).exitCode).toBe(19);
  expect((await f.run(f.tasks?.["dev:up"])).exitCode).toBe(0);
  const changed = (await f.config(2, image.replace("a".repeat(64), "b".repeat(64)))).tasks;
  expect((await f.run(changed?.["dev:up"])).stderr).toContain("OCI image changed");
  const state = JSON.parse(await readFile(join(f.dir, "state"), "utf8"));
  state.config.labels["workstation.owner"] = "someone-else";
  await writeFile(join(f.dir, "state"), JSON.stringify(state));
  for (const operation of ["up", "stop", "destroy"]) expect((await f.run(f.tasks?.[`dev:${operation}`])).stderr).toContain("unowned");
  expect(JSON.parse(await readFile(join(f.dir, "state"), "utf8")).disk).toBe("retained");
});
