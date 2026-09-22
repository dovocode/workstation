import { afterEach, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { firecracker, resolveConfig, createWorkstation, writeManifest, readManifest, type FirecrackerVmOptions, type Context } from "../src/index.js";
import { renderMicrovm } from "../src/firecracker/guest.js";
import { hostCommand } from "../src/firecracker/host.js";

const context: Context = { platform: "linux", home: "/home/test", configDir: "/project", hostname: "test", machine: "test" };
const digest = createHash("sha256").update("artifact").digest("hex");
const download = { url: "https://example.com/artifact", sha256: digest };
const options: FirecrackerVmOptions = { architecture: "aarch64", kernel: download, rootfs: download, binary: download, subnet: "10.231.0.0/30", guest: { workstation: download, config: "export default { resources: [] };" } };
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

it("composes native provisioning dependencies, lifecycle tasks, and persisted manifests", async () => {
  const config = await resolveConfig(firecracker.vm("dev", options), context);
  expect(config.resources.map(resource => resource.kind)).toEqual(["provision", "provision"]);
  expect(config.resources[1]?.dependsOn).toEqual(["provision:firecracker-host-native"]);
  expect(Object.keys(config.tasks ?? {})).toEqual(["dev:up", "dev:stop", "dev:status", "dev:provision", "dev:exec", "dev:destroy"]);
  expect(config.tasks?.["dev:up"]?.command).toBe("sudo");
  const dir = await mkdtemp(join(tmpdir(), "wfc-manifest-")); temporary.push(dir);
  await writeManifest(join(dir, "manifest.toml"), config);
  expect((await readManifest(join(dir, "manifest.toml"))).resources).toEqual(config.resources);
});

it("dispatches literal extra guest arguments and preserves failures through the embedded API", async () => {
  const client = createWorkstation({ config: firecracker.vm("dev", options), context, runner: { async run(command, args) {
    expect(command).toBe("sudo");
    expect(args.slice(-3)).toEqual(["exec", "printf", "$(touch /do-not-create);' quoted"]);
    return { exitCode: 19, stdout: "", stderr: "guest failure" };
  } } });
  expect((await client.task("dev:exec", ["printf", "$(touch /do-not-create);' quoted"])).exitCode).toBe(19);
});

it("rejects ambiguous or unsafe declarations before producing commands", () => {
  for (const subnet of ["10.0.0.1/30", "8.8.8.0/30", "10.0.0.0/24", "010.0.0.0/30", "10.0.0.0/30/extra"]) expect(() => firecracker.vm("dev", { ...options, subnet })).toThrow();
  expect(() => firecracker.vm("../dev", options)).toThrow();
  expect(() => firecracker.vm("dev", { ...options, cpus: 0 })).toThrow();
  expect(() => firecracker.vm("dev", { ...options, kernel: { ...download, sha256: "bad" } })).toThrow();
  expect(() => firecracker.vm("dev", { ...options, binary: { ...download, url: "http://example.com" } })).toThrow();
});

it("renders valid Bash even when guest config and URLs contain shell metacharacters", () => {
  const script = renderMicrovm("dev", "a".repeat(64), { ...options, kernel: { ...download, url: "https://example.com/'$(touch%20BAD)" }, guest: { ...options.guest, config: "export default { tasks: { x: { command: `echo`, args: [\"'$(danger)\"] } } };" } });
  expect(spawnSync("bash", ["-n"], { input: script }).status).toBe(0);
  for (const provider of ["lima", "orb"] as const) {
    const spec = hostCommand({ provider }, script, "up");
    expect(spawnSync("bash", ["-n"], { input: spec.args?.[1] }).status).toBe(0);
  }
});

it("does not start stopped macOS machines during inspection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wfc-host-")); temporary.push(dir);
  for (const provider of ["lima", "orb"] as const) {
    const binary = provider === "lima" ? "limactl" : "orb";
    await writeFile(join(dir, binary), '#!/bin/bash\nif [ "$1" = list ]; then exit 0; fi\necho "Unexpected mutation" >&2; exit 99\n', { mode: 0o755 });
    const spec = hostCommand({ provider }, "exit 99", "check");
    const result = spawnSync(spec.command, [...spec.args ?? []], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("stopped or absent");
    expect(result.stderr).not.toContain("Unexpected mutation");
  }
});

it("uses Lima by default on macOS and supports explicit Orb selection only there", async () => {
  for (const provider of ["lima", "orb"] as const) {
    const definition = firecracker.vm("dev", { ...options, macos: { provider } });
    const mac = await resolveConfig(definition, { ...context, platform: "darwin" });
    expect(mac.resources[1]?.dependsOn).toEqual([`provision:firecracker-host-${provider}-workstation-firecracker`]);
    expect(mac.tasks?.["dev:up"]?.args?.[1]).toContain(provider === "orb" ? "'orb' '-m'" : "'limactl' 'shell'");
    expect((await resolveConfig(definition, context)).tasks?.["dev:up"]?.command).toBe("sudo");
  }
  expect((await resolveConfig(firecracker.vm("dev", options), { ...context, platform: "darwin" })).resources[1]?.dependsOn).toEqual(["provision:firecracker-host-lima-workstation-firecracker"]);
});

/** Execute the real generated lifecycle shell against filesystem-backed fake Linux utilities. */
async function linuxFixture() {
  const root = await mkdtemp(join(tmpdir(), "wfc-linux-")); temporary.push(root);
  const bin = join(root, "bin");
  await mkdir(bin);
  await mkdir(join(root, "run/systemd/system"), { recursive: true });
  await mkdir(join(root, "etc/systemd/system"), { recursive: true });
  const mock = `#!${process.execPath}
const fs = require('node:fs'); const cp = require('node:child_process'); const path = require('node:path'); const crypto = require('node:crypto');
const root = process.env.WFC_TEST_ROOT, args = process.argv.slice(2), name = path.basename(process.argv[1]);
fs.appendFileSync(root + '/calls', JSON.stringify([name, ...args]) + '\\n');
const stateFile=root+'/mock.json'; let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):{active:false,enabled:false,tap:false,disk:{}};
const save=()=>fs.writeFileSync(stateFile,JSON.stringify(state));
if(name==='uname') console.log(args[0]==='-s'?'Linux':'aarch64');
else if(name==='id') console.log('0');
else if(name==='flock') {}
else if(name==='python3') { if(args[1].includes('ipaddress')&&process.env.WFC_ROUTE_CONFLICT){console.error('Requested subnet overlaps a host route');process.exit(1);} if(args[1].includes('shlex')) console.log(args.slice(2).map(s=>String.fromCharCode(39)+s.replaceAll(String.fromCharCode(39), String.fromCharCode(39,34,39,34,39))+String.fromCharCode(39)).join(' ')); }
else if(name==='curl') fs.writeFileSync(args[args.indexOf('-o')+1],process.env.WFC_BAD_DOWNLOAD?'bad':'artifact');
else if(name==='sha256sum') {
 const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
 if(args.includes('--check')) { const file=args.at(-1); const data=file==='--status'?fs.readFileSync(0,'utf8'):fs.readFileSync(file,'utf8'); for(const line of data.trim().split('\\n')){ const [digest,p]=line.split(/  /); if(hash(p)!==digest)process.exit(1); } }
 else for(const file of args) console.log(hash(file)+'  '+file);
}
else if(name==='cp') fs.copyFileSync(args.at(-2),args.at(-1));
else if(name==='ssh-keygen') {const p=args[args.indexOf('-f')+1];fs.writeFileSync(p,'private');fs.writeFileSync(p+'.pub','ssh-ed25519 public\\n');}
else if(name==='debugfs') {const parts=args[args.indexOf('-R')+1].split(' '); if(parts[0]==='write'){state.disk[parts[2]]=fs.readFileSync(parts[1],'utf8');save();} if(parts[0]==='cat')process.stdout.write(state.disk[parts[1]]??'');}
else if(name==='ssh'||name==='scp') {if(process.env.WFC_GUEST_FAILURE && args.at(-1).includes('workstation build'))process.exit(7);}
else if(name==='sysctl') console.log('1');
else if(name==='iptables') {}
else if(name==='ip') {
 if(args.includes('route')) {if(process.env.WFC_ROUTE_CONFLICT)console.log('conflicting route');}
 else if(args[0]==='link'&&args[1]==='show')process.exit(state.tap?0:1);
 else if(args[0]==='tuntap') {state.tap=true;save();}
 else if(args.includes('alias')) {const tap=args[args.indexOf('dev')+1];fs.mkdirSync(root+'/sys/class/net/'+tap,{recursive:true});fs.writeFileSync(root+'/sys/class/net/'+tap+'/ifalias',args.at(-1));}
 else if(args[0]==='link'&&args[1]==='delete'){state.tap=false;save();}
 else if(args.includes('address')&&args.includes('show'))console.log('inet 10.231.0.1/30 ');
}
else if(name==='systemctl') {
 const op=args[0]; if(op==='is-active')process.exit(state.active?0:3); if(op==='is-enabled')process.exit(state.enabled?0:1);
 const network=root+'/var/lib/workstation-firecracker/dev/network';
 if(['enable','stop','disable'].includes(op)) {if(fs.existsSync(network))cp.execFileSync('bash',[network,op==='enable'?'up':'down'],{env:process.env});state=JSON.parse(fs.readFileSync(stateFile));state.active=op==='enable';if(op!=='stop')state.enabled=op==='enable';save();}
}
else throw Error('unexpected utility '+name);
`;
  for (const tool of ["uname", "id", "flock", "python3", "curl", "sha256sum", "cp", "ssh-keygen", "debugfs", "ssh", "scp", "sysctl", "iptables", "ip", "systemctl"]) await writeFile(join(bin, tool), mock, { mode: 0o755 });
  /** Substitute only operating-system boundaries; lifecycle, downloads and persistence run unchanged. */
  const run = (operation: string, declaration = options, extra: Record<string, string> = {}) => {
    let script = renderMicrovm("dev", "a".repeat(64), declaration);
    for (const prefix of ["/var/lib/workstation-firecracker", "/run/systemd/system", "/etc/systemd/system", "/sys/class/net"]) script = script.replaceAll(prefix, root + prefix);
    script = script.replaceAll("export PATH=/usr/sbin:/usr/bin:/sbin:/bin", `export PATH=${bin}:/usr/bin:/bin`).replaceAll("[ -c /dev/kvm ]", "true");
    return spawnSync("bash", ["-c", script, "test", operation], { env: { ...process.env, ...extra, WFC_TEST_ROOT: root }, encoding: "utf8" });
  };
  return { root, run, dir: join(root, "var/lib/workstation-firecracker/dev") };
}

it("reconciles once, preserves the writable disk across restart, and destroys explicitly", async () => {
  const fixture = await linuxFixture();
  const result = fixture.run("up");
  expect(result.status, result.stderr).toBe(0);
  await writeFile(join(fixture.dir, "rootfs.ext4"), "guest application data");
  const before = await readFile(join(fixture.root, "calls"), "utf8");
  expect(fixture.run("up").status).toBe(0);
  const after = await readFile(join(fixture.root, "calls"), "utf8");
  expect(after.slice(before.length)).not.toContain('"curl"');
  expect(fixture.run("stop").status).toBe(0);
  expect(fixture.run("check").status).not.toBe(0);
  const restarted = fixture.run("up");
  expect(restarted.status, restarted.stderr).toBe(0);
  expect(await readFile(join(fixture.dir, "rootfs.ext4"), "utf8")).toBe("guest application data");
  expect(fixture.run("destroy").status).toBe(0);
  expect(await readdir(join(fixture.root, "var/lib/workstation-firecracker"))).toEqual(["lock"]);
}, 30000);

it("leaves no applied checkpoint after checksum or guest provisioning failures", async () => {
  const fixture = await linuxFixture();
  const bad = fixture.run("up", options, { WFC_BAD_DOWNLOAD: "1" });
  expect(bad.status).toBe(1);
  expect(bad.stderr).toContain("Checksum mismatch");
  expect(await readdir(fixture.dir)).not.toContain("applied");
  const guest = fixture.run("up", options, { WFC_GUEST_FAILURE: "1" });
  expect(guest.status, guest.stderr).not.toBe(0);
  expect(await readdir(fixture.dir)).not.toContain("applied");
  const recovery = fixture.run("up");
  expect(recovery.status, recovery.stderr).toBe(0);
}, 30000);

it("refuses rootfs replacement, externally edited units and occupied subnets", async () => {
  const fixture = await linuxFixture();
  const conflict = fixture.run("up", options, { WFC_ROUTE_CONFLICT: "1" });
  expect(conflict.stderr).toContain("host route");
  const result = fixture.run("up");
  expect(result.status, result.stderr).toBe(0);
  const changed = fixture.run("up", { ...options, rootfs: { ...download, sha256: "b".repeat(64) } });
  expect(changed.stderr).toContain("Rootfs pin changed");
  const unit = join(fixture.root, "etc/systemd/system/workstation-firecracker-dev.service");
  await writeFile(unit, "external edit");
  expect(fixture.run("destroy").stderr).toContain("edited externally");
  expect(await readFile(unit, "utf8")).toBe("external edit");
}, 30000);
