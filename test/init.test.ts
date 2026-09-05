import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { initConfig } from "../src/config/init.js";
import { loadConfig } from "../src/config/load.js";

const directories: string[] = [];

/** Allocate an isolated directory that is removed after each test. */
async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "workstation-init-"));
  directories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it("creates a loadable starter without writing setup state", async () => {
  const root = await temporaryDirectory();
  const path = join(root, "nested", "workstation.config.ts");
  expect(await initConfig(path)).toBe(path);
  const config = await loadConfig(path, "studio");
  expect(config.resources).toEqual([]);
  expect(config.tasks?.hello?.command).toBe("echo");
  expect(config.aliases?.hi).toBe("hello");
  expect(await readdir(join(root, "nested"))).toEqual(["workstation.config.ts"]);
});

it("preserves an existing configuration", async () => {
  const root = await temporaryDirectory();
  const path = join(root, "workstation.config.ts");
  await writeFile(path, "existing content");
  await expect(initConfig(path)).rejects.toThrow("already exists");
  expect(await readFile(path, "utf8")).toBe("existing content");
});

it("refuses even a dangling symlink", async () => {
  const root = await temporaryDirectory();
  const path = join(root, "workstation.config.ts");
  await symlink(join(root, "missing.ts"), path);
  await expect(initConfig(path)).rejects.toThrow("already exists");
  expect(await readdir(root)).toEqual(["workstation.config.ts"]);
});
