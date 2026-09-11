/* global process, console */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const native = resolve(process.argv[2] ?? `dist/bin/workstation-${process.platform}-${process.arch}`);
const root = await mkdtemp(join(tmpdir(), "workstation-standalone-"));
try {
  await writeFile(join(root, "fragment.ts"), `import { files } from "@dovocode/workstation"; export default files.json(${JSON.stringify(join(root, "generated.json"))}, { ready: true });`);
  await writeFile(join(root, "config.ts"), [
    'import { defineConfig, task } from "@dovocode/workstation";',
    'import resource from "./fragment.ts";',
    `export default defineConfig({ stateFile: ${JSON.stringify(join(root, "state.json"))}, resources: [resource], tasks: { test: task("pnpm", ["test"]) } });`,
  ].join("\n"));
  const options = { cwd: root, encoding: "utf8", timeout: 30000, env: { ...process.env, PATH: "", HOME: root, JITI_FS_CACHE: "false" } };
  const args = ["build", "--config", join(root, "config.ts"), "--machine", "standalone"];
  // No Node/pnpm executable on PATH; no package manifest or installed dependencies.
  execFileSync(native, args, options);
  assert.deepEqual(JSON.parse(await readFile(join(root, "generated.json"), "utf8")), { ready: true });
  assert.match(execFileSync(native, args, options), /already converged/);
  assert.equal((await readdir(root)).includes("node_modules"), false);
  // Private coordination state is expected; no runtime was installed.
  assert.equal((await readdir(join(root, ".local"))).includes("bin"), false);
  console.log("Standalone build converged without Node, pnpm, or installed config dependencies.");
} finally {
  await rm(root, { recursive: true, force: true });
}
