import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import * as api from "../src/index.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

/** Create a config project outside the repository's dependency-resolution tree. */
async function fixture(): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), "workstation-bundled-config-"));
  roots.push(root);
  return { root, path: join(root, "config.ts") };
}

it("loads bundled helpers in a config and nested TypeScript fragment without node_modules", async () => {
  const { root, path } = await fixture();
  await writeFile(join(root, "fragment.ts"), 'import { task } from "@dovocode/workstation"; export default task("echo", ["literal"]);');
  await writeFile(path, 'import { defineConfig } from "@dovocode/workstation"; import hello from "./fragment.ts"; export default defineConfig({ tasks: { hello } });');
  const result = await api.loadConfig(path, "test", api);
  expect(result.tasks?.hello?.command).toBe("echo");
  expect(result.tasks?.hello?.args).toEqual(["literal"]);
});

it("keeps an installed project version authoritative", async () => {
  const { root, path } = await fixture();
  const installed = join(root, "node_modules", "@dovocode", "workstation");
  await mkdir(installed, { recursive: true });
  await writeFile(join(installed, "package.json"), JSON.stringify({ name: "@dovocode/workstation", type: "module", exports: "./index.js" }));
  await writeFile(join(installed, "index.js"), 'export const projectMarker = "installed-version";');
  await writeFile(path, 'import { projectMarker } from "@dovocode/workstation"; export default { tasks: { hello: { command: "echo", args: [projectMarker] } } };');
  expect((await api.loadConfig(path, "test", api)).tasks?.hello?.args).toEqual(["installed-version"]);
});

it("does not resolve missing third-party dependencies from the bundled API", async () => {
  const { path } = await fixture();
  await writeFile(path, 'import addon from "missing-workstation-test-addon"; export default addon;');
  await expect(api.loadConfig(path, "test", api)).rejects.toThrow("missing-workstation-test-addon");
});
