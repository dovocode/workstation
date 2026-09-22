import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { android, ios, resolveConfig, createWorkstation, ProcessRunner, type Context, type TaskDefinition } from "../src/index.js";

const context: Context = { platform: "darwin", home: "/home/test", configDir: "/project", hostname: "test", machine: "test" };
const runtime = "com.apple.CoreSimulator.SimRuntime.iOS-18-0";
const deviceType = "com.apple.CoreSimulator.SimDeviceType.iPhone-16";
const systemImage = `system-images;android-35;google_apis;${process.arch === "arm64" ? "arm64-v8a" : "x86_64"}`;
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(p => rm(p, { recursive: true, force: true }))); });

it("exports retained setup with common tasks and rejects invalid declarations", async () => {
  const a = await resolveConfig(android.emulator("phone", { systemImage, device: "pixel_7" }), context);
  const i = await resolveConfig(ios.simulator("phone", { runtime, deviceType }), context);
  expect(Object.keys(a.tasks ?? {})).toEqual(Object.keys(i.tasks ?? {}));
  expect(a.resources[0]).toMatchObject({ kind: "provision", operation: { type: "check", repair: [{ args: expect.arrayContaining(["setup"]) }] } });
  await expect(resolveConfig(ios.simulator("phone", { runtime, deviceType }), { ...context, platform: "linux" })).rejects.toThrow("requires macOS");
  expect(() => android.emulator("phone", { systemImage, device: "pixel_7", port: 5555 })).toThrow("even");
  expect(() => android.emulator("phone", { systemImage: "../image", device: "pixel_7" })).toThrow();
  expect(() => ios.simulator("phone", { runtime, deviceType, downloadRuntimeVersion: "19.0" })).toThrow("match");
});

/** Choose a free emulator port pair without interfering with a real local emulator. */
async function freeEmulatorPort(): Promise<number> {
  for (let port = 5554; port <= 5682; port += 2) {
    const servers = [createServer(), createServer()];
    try {
      await Promise.all(servers.map((server, offset) => new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port + offset, "127.0.0.1", resolve);
      })));
      return port;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EADDRINUSE") throw error;
    } finally {
      await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    }
  }
  throw new Error("No free emulator port pair for mobile tests");
}

/** Execute the actual Python adapter with fake platform tools persisting device state. */
async function fixture(backend: "android" | "ios") {
  const testPort = backend === "android" ? await freeEmulatorPort() : 5554;
  const dir = await mkdtemp(join(tmpdir(), "workstation-mobile-")); temporary.push(dir);
  const bin = join(dir, "bin"), sdk = join(dir, "sdk");
  await mkdir(bin);
  const fake = `#!${process.execPath}
const fs=require('node:fs'), path=require('node:path'), cp=require('node:child_process');
const a=process.argv.slice(2), tool=path.basename(process.argv[1]), root=process.env.MOBILE_TEST_ROOT;
const file=root+'/device.json', log=root+'/calls';
fs.appendFileSync(log,JSON.stringify([tool,...a])+'\\n');
let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;
const save=()=>fs.writeFileSync(file,JSON.stringify(state));
const value=k=>a[a.indexOf(k)+1];
if(tool==='xcodebuild') fs.writeFileSync(root+'/runtime','ready');
else if(tool==='xcrun'){
 const command=a[1];
 if(command==='list'){
  if(process.env.FAIL_LIST)process.exit(29);
  if(a[2]==='runtimes')console.log(JSON.stringify({runtimes:fs.existsSync(root+'/runtime')?[{identifier:'${runtime}',isAvailable:true}]:[]}));
  else console.log(JSON.stringify({devices:{[state?.runtime||'${runtime}']:state?[state]:[]}}));
 } else if(command==='create') {state={name:a[2],deviceTypeIdentifier:a[3],runtime:a[4],udid:'11111111-2222-3333-4444-555555555555',state:'Shutdown',isAvailable:true,disk:'retained'}; save(); console.log(state.udid);}
 else if(command==='boot'){state.state='Booted';save();}
 else if(command==='bootstatus'){if(process.env.FAIL_BOOT)process.exit(17);}
 else if(command==='shutdown'){state.state='Shutdown';save();}
 else if(command==='delete'){fs.unlinkSync(file);}
 else if(command==='install'){if(!path.isAbsolute(a[3]))process.exit(98);}
 else if(command==='spawn'){console.log(JSON.stringify(a.slice(3)));process.exit(Number(process.env.GUEST_EXIT||0));}
 else process.exit(99);
} else if(tool==='sdkmanager'){
 if(a.includes('--licenses'))process.exit(0);
 if(process.env.FAIL_SDK)process.exit(31);
 for(const p of a.filter(x=>!x.startsWith('--'))){const folder=path.join(process.env.ANDROID_HOME,...p.split(';'));fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(folder+'/source.properties','installed');}
} else if(tool==='avdmanager'){
 const home=process.env.ANDROID_AVD_HOME, name=value('--name');
 if(a[0]==='create') {const avd=value('--path');fs.mkdirSync(avd,{recursive:true});fs.writeFileSync(avd+'/config.ini','image.sysdir.1='+value('--package').replaceAll(';','/')+'/\\n');fs.writeFileSync(home+'/'+name+'.ini','path='+avd);state={name,port:${testPort},running:false,disk:'retained'};save();}
 else if(a[0]==='delete'){fs.rmSync(home+'/'+name+'.avd',{recursive:true});fs.unlinkSync(home+'/'+name+'.ini');fs.unlinkSync(file);}
 else process.exit(99);
} else if(tool==='adb'){
 if(a[0]==='devices'){console.log('List of devices attached');if(state?.running)console.log('emulator-'+state.port+'\\tdevice');}
 else if(a.includes('emu')&&a.includes('name'))console.log((process.env.WRONG_DEVICE?'other':state.name)+'\\nOK');
 else if(a.includes('kill')){state.running=false;save();}
 else if(a.includes('shell')){
  const command=a.at(-1);
  if(command==='getprop sys.boot_completed')console.log('1');
  else {const result=cp.spawnSync('python3',['-c','import json,shlex,sys; print(json.dumps(shlex.split(sys.argv[1])))',command],{encoding:'utf8'});process.stdout.write(result.stdout);process.exit(Number(process.env.GUEST_EXIT||0));}
 } else if(a.includes('install')){if(!path.isAbsolute(a.at(-1)))process.exit(98);}
 else process.exit(99);
} else if(tool==='emulator'){state.running=true;state.port=Number(value('-port'));save();setTimeout(()=>process.exit(0),3000);}
else process.exit(99);
`;
  for (const tool of [join(bin, "xcrun"), join(bin, "xcodebuild"), join(sdk, "cmdline-tools/latest/bin/sdkmanager"), join(sdk, "cmdline-tools/latest/bin/avdmanager"), join(sdk, "platform-tools/adb"), join(sdk, "emulator/emulator")]) {
    await mkdir(join(tool, ".."), { recursive: true });
    await writeFile(tool, fake, { mode: 0o755 });
  }
  /** Resolve changed options against the same owned device directory. */
  const config = (changed = false, port = testPort) => resolveConfig(backend === "ios"
    ? ios.simulator("phone", { runtime, deviceType: changed ? deviceType + "-Pro" : deviceType, downloadRuntimeVersion: "18.0" })
    : android.emulator("phone", { sdkRoot: sdk, systemImage, device: "pixel_7", cpus: changed ? 4 : 2, port, acceptLicenses: true }), { ...context, home: dir });
  const resolved = await config();
  /** Use normal command dispatch, including literal appended arguments. */
  const run = (task: TaskDefinition | undefined, extra: string[] = [], overrides: Record<string, string> = {}) => {
    if (!task) throw new Error("Missing mobile test task");
    return new ProcessRunner().run(task.command, [...task.args ?? [], ...extra], { environment: { MOBILE_TEST_ROOT: dir, PATH: `${bin}:${process.env.PATH}`, ...overrides } });
  };
  /** Read/write the fake backend's state to simulate external runtime transitions. */
  const state = async (patch?: Record<string, unknown>) => {
    const current: Record<string, unknown> = JSON.parse(await readFile(join(dir, "device.json"), "utf8"));
    if (patch) await writeFile(join(dir, "device.json"), JSON.stringify({ ...current, ...patch }));
    return current;
  };
  const resource = resolved.resources[0];
  if (resource?.kind !== "provision" || resource.operation.type !== "check") throw new Error("Missing mobile check");
  if (!resolved.tasks) throw new Error("Missing mobile tasks");
  return { dir, run, config, testPort, tasks: resolved.tasks, state, check: resource.operation.check };
}

// Full lifecycle tests launch many real subprocesses; allow for slower shared CI runners.
it("sets up iOS once, selects its UDID, retains data and destroys only its device", { timeout: 30_000 }, async () => {
  const f = await fixture("ios");
  expect((await f.run(f.check)).exitCode).toBe(1);
  await expect(access(join(f.dir, ".local"))).rejects.toThrow();
  const setup = await f.run(f.tasks["phone:setup"]); expect(setup.exitCode, setup.stderr).toBe(0);
  expect((await f.state()).state).toBe("Shutdown");
  expect((await f.run(f.check)).exitCode).toBe(0);
  expect((await f.run(f.tasks["phone:status"])).exitCode).toBe(1);
  await writeFile(join(f.dir, "calls"), "");
  expect((await f.run(f.tasks["phone:setup"])).exitCode).toBe(0);
  expect(await readFile(join(f.dir, "calls"), "utf8")).not.toMatch(/create|xcodebuild|boot/);
  expect((await f.run(f.tasks["phone:up"])).exitCode).toBe(0);
  const args = ["printf", "a b", "$(touch BAD)", "'", ""];
  const exec = await f.run(f.tasks["phone:exec"], args, { GUEST_EXIT: "23" });
  expect(exec.exitCode).toBe(23); expect(JSON.parse(exec.stdout)).toEqual(args);
  expect((await f.run(f.tasks["phone:install"], ["app with spaces.app"])).exitCode).toBe(0);
  expect((await f.run((await f.config(true)).tasks?.["phone:setup"])).stderr).toContain("explicitly destroy");
  expect((await f.run(f.tasks["phone:stop"])).exitCode).toBe(0);
  expect((await f.state()).disk).toBe("retained");
  expect((await f.run(f.tasks["phone:destroy"])).exitCode).toBe(0);
  expect((await f.run(f.tasks["phone:destroy"])).exitCode).toBe(0);
});

it("installs Android packages, retains AVD data, resizes while stopped and targets literal commands", { timeout: 30_000 }, async () => {
  const f = await fixture("android");
  expect((await f.run(f.check)).exitCode).toBe(1);
  const failed = await f.run(f.tasks["phone:setup"], [], { FAIL_SDK: "1" }); expect(failed.exitCode).toBe(31);
  await expect(access(join(f.dir, "device.json"))).rejects.toThrow();
  const setup = await f.run(f.tasks["phone:setup"]); expect(setup.exitCode, setup.stderr).toBe(0);
  expect((await f.run(f.check)).exitCode).toBe(0);
  await writeFile(join(f.dir, "calls"), "");
  expect((await f.run(f.tasks["phone:setup"])).exitCode).toBe(0);
  expect(await readFile(join(f.dir, "calls"), "utf8")).toBe("");
  await f.state({ running: true });
  expect((await f.run(f.tasks["phone:up"])).exitCode).toBe(0);
  const args = ["printf", "a b", "$(touch BAD)", "'", ""];
  const exec = await f.run(f.tasks["phone:exec"], args, { GUEST_EXIT: "23" });
  expect(exec.exitCode).toBe(23); expect(JSON.parse(exec.stdout)).toEqual(args);
  expect((await f.run(f.tasks["phone:install"], ["app with spaces.apk"])).exitCode).toBe(0);
  const changed = (await f.config(true)).tasks;
  expect((await f.run(changed?.["phone:setup"])).stderr).toContain("Stop the emulator");
  expect((await f.run(f.tasks["phone:stop"])).exitCode).toBe(0);
  expect((await f.run(changed?.["phone:setup"])).exitCode).toBe(0);
  expect((await f.state()).disk).toBe("retained");
  expect((await f.run(changed?.["phone:destroy"])).exitCode).toBe(0);
  expect((await f.run(changed?.["phone:destroy"])).exitCode).toBe(0);
});

it("fails closed on simulator inventory failures, external identity changes and Android port collisions", { timeout: 30_000 }, async () => {
  const i = await fixture("ios");
  expect((await i.run(i.tasks["phone:setup"], [], { FAIL_LIST: "1" })).exitCode).toBe(29);
  await expect(access(join(i.dir, "device.json"))).rejects.toThrow();
  expect((await i.run(i.tasks["phone:setup"])).exitCode).toBe(0);
  await i.state({ deviceTypeIdentifier: deviceType + "-Pro" });
  expect((await i.run(i.tasks["phone:destroy"])).stderr).toContain("externally modified");
  const a = await fixture("android");
  expect((await a.run(a.tasks["phone:setup"])).exitCode).toBe(0);
  await a.state({ running: true });
  expect((await a.run(a.tasks["phone:destroy"], [], { WRONG_DEVICE: "1" })).stderr).toContain("another AVD");
  expect((await a.state()).disk).toBe("retained");
});

it("dispatches mobile tasks through the embedded client", async () => {
  const client = createWorkstation({ config: ios.simulator("phone", { runtime, deviceType }), context, runner: { async run(_command, args) {
    expect(args.slice(-2)).toEqual(["install", "/tmp/app.app"]);
    return { exitCode: 0, stdout: "", stderr: "" };
  } } });
  expect((await client.task("phone:install", ["/tmp/app.app"])).exitCode).toBe(0);
});

it("starts a stopped Android emulator and verifies boot readiness", { timeout: 30_000 }, async () => {
  const f = await fixture("android");
  const result = await f.run(f.tasks["phone:up"]);
  expect(result.exitCode, result.stderr).toBe(0);
  expect((await f.state()).running).toBe(true);
  expect((await f.run(f.tasks["phone:status"])).exitCode).toBe(0);
  expect((await f.run(f.tasks["phone:stop"])).exitCode).toBe(0);
});

it("rejects redirected Android data paths and changed ports before deletion", { timeout: 30_000 }, async () => {
  const f = await fixture("android");
  expect((await f.run(f.tasks["phone:setup"])).exitCode).toBe(0);
  expect((await f.run((await f.config(false, f.testPort === 5554 ? 5556 : 5554)).tasks?.["phone:destroy"])).stderr).toContain("original SDK");
  const state = await f.state();
  const ini = join(f.dir, ".local/state/workstation/mobile/android/phone/avd", String(state.name) + ".ini");
  await writeFile(ini, "path=/someone/elses/device");
  expect((await f.run(f.tasks["phone:destroy"])).stderr).toContain("externally modified");
  expect((await f.state()).disk).toBe("retained");
});
