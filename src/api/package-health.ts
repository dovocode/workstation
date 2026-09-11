import { provision, type ProvisionResource } from "./provision.js";

/** Smoke-test an installed mise npm package; repair the active installation without changing its version. */
export function npmHealth(name: string, options: { readonly tool: string; readonly package: string; readonly executable?: string; readonly nativePty?: boolean; readonly home: string; readonly environment?: Readonly<Record<string, string>>; readonly dependsOn: readonly string[] }): ProvisionResource {
  /** Construct the same runtime invocation for probing and repairing the installed package. */
  const command = (repair: boolean) => ({
    command: "mise", args: ["--cd", options.home, "exec", "--", "node", "--input-type=module", "-e", healthScript, options.tool, options.package, options.executable ?? "", String(options.nativePty === true), String(repair)],
    cwd: options.home,
    ...(options.environment ? { environment: options.environment } : {}),
  });
  return provision(name, { type: "check", check: command(false), repair: [command(true)] }, options.dependsOn);
}

// Runs under the selected Node runtime, which matters for native module ABI compatibility.
const healthScript = `
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const [tool, name, executable, nativePty, repair] = process.argv.slice(1);
const directory = execFileSync('mise', ['where', tool], {encoding:'utf8'}).trim();
let manifest;
for (const modules of ['node_modules', 'lib/node_modules']) {
  try { manifest = realpathSync(join(directory, modules, name, 'package.json')); break; }
  catch(error) { if(error.code !== 'ENOENT') throw error; }
}
if (!manifest) throw new Error('Missing installed package: ' + name);
const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
if (pkg.name !== name || typeof pkg.version !== 'string' || !pkg.version) throw new Error('Invalid installed package metadata');
const require = createRequire(manifest);
const execute = (command,args) => {
  const result = spawnSync(command,args,{stdio:'inherit',timeout:300000});
  if(result.error) throw result.error;
  if(result.status !== 0) process.exit(result.status ?? 1);
};
if (nativePty === 'true') {
  if (repair === 'true') {
    const dependency = dirname(require.resolve('node-pty/package.json'));
    for (const script of ['install','postinstall']) execute('npm',['--prefix',dependency,'--ignore-scripts','run',script,...(script === 'postinstall' ? ['--if-present'] : [])]);
  }
  const pty = require('node-pty');
  const terminal = pty.spawn('/bin/sh',['-c','exit 0'],{env:process.env});
  const timeout = setTimeout(() => { terminal.kill(); process.exit(1); },5000);
  terminal.onExit(({exitCode}) => {clearTimeout(timeout); process.exitCode = exitCode;});
} else {
  if (repair === 'true') {
    // npm reinstalls the exact observed package version into the same mise prefix.
    execute('npm',['install','--global','--force','--include=optional','--prefix',directory,name+'@'+pkg.version]);
  }
  if (!executable || executable.includes('/')) throw new Error('Expected a package executable name');
  execute(join(directory,'bin',executable),['--version']);
}
`;
