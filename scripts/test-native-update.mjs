/* global process, console */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
const native = resolve(process.argv[2] ?? join(packageRoot, "dist", "bin", `workstation-${process.platform}-${process.arch}`));
const root = await mkdtemp(join(tmpdir(), "workstation-native-update-"));
try {
  const bin = join(root, "bin");
  const cwd = join(root, "project");
  await mkdir(bin);
  await mkdir(cwd);
  const installed = join(bin, "installed-workstation");
  await copyFile(native, installed);
  await chmod(installed, 0o755);
  await symlink(installed, join(bin, "workstation"));
  const preload = join(root, "release.cjs");
  // An up-to-date fixture exercises real SEA detection without downloads or replacement.
  await writeFile(preload, [
    'const assert = require("node:assert/strict");',
    'globalThis.fetch = async (url) => {',
    '  assert.equal(url, "https://api.github.com/repos/dovocode/workstation/releases/latest");',
    `  return new Response(JSON.stringify({ tag_name: ${JSON.stringify(`v${version}`)} }));`,
    '};',
  ].join("\n"));
  const options = {
    cwd, encoding: "utf8", timeout: 30000,
    env: { ...process.env, PATH: bin, NODE_OPTIONS: `--require ${JSON.stringify(preload)}` },
  };
  const expected = `Workstation ${version} is already the latest version.`;
  assert.equal(execFileSync("workstation", ["update"], options).trim(), expected);
  // Match the reported failure: a same-name directory makes argv[1] resolve to user data.
  await mkdir(join(cwd, "workstation"));
  assert.equal(execFileSync("workstation", ["update"], options).trim(), expected);
  assert.equal(execFileSync(installed, ["update"], options).trim(), expected);
  console.log("Native self-update passed through PATH, a symlink, and an absolute path without package metadata.");
} finally {
  await rm(root, { recursive: true, force: true });
}
