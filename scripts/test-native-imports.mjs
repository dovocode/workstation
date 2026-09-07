/* global process, console */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const native = resolve(process.argv[2] ?? join(packageRoot, "dist", "bin", `workstation-${process.platform}-${process.arch}`));
const root = await mkdtemp(join(tmpdir(), "workstation-native-imports-"));
try {
  await mkdir(join(root, "node_modules", "@dovocode"), { recursive: true });
  await symlink(packageRoot, join(root, "node_modules", "@dovocode", "workstation"), "dir");
  await mkdir(join(root, "node_modules", "fixture-esm"));
  await writeFile(join(root, "node_modules", "fixture-esm", "package.json"), JSON.stringify({ name: "fixture-esm", type: "module", exports: "./index.mjs" }));
  await writeFile(join(root, "node_modules", "fixture-esm", "index.mjs"), 'export const description = await Promise.resolve("async external ESM");\n');
  await writeFile(join(root, "fragment.ts"), 'export default await Promise.resolve(["hello"]);\n');
  await writeFile(join(root, "config.ts"), [
    'import { defineConfig, task } from "@dovocode/workstation";',
    'import { description } from "fixture-esm";',
    'const { default: args } = await import("./fragment.ts");',
    'export default defineConfig({ tasks: { hello: task("echo", args, { description }) } });',
  ].join("\n"));
  const args = ["--config", join(root, "config.ts"), "--list-tasks"];
  const options = { cwd: root, encoding: "utf8", env: { ...process.env, JITI_NATIVE_MODULES: '["fixture-esm"]', JITI_FS_CACHE: "false" } };
  // Listing evaluates the fixture but never bootstraps, reconciles, or uses user state.
  assert.equal(execFileSync(process.execPath, [join(packageRoot, "dist", "cli.js"), ...args], options).trim(), "hello  async external ESM");
  assert.equal(execFileSync(native, args, options).trim(), "hello  async external ESM");
  console.log("JavaScript and native config imports passed (library, nested TypeScript, async ESM).");
} finally {
  await rm(root, { recursive: true, force: true });
}
