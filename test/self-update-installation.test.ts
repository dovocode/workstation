import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveJavaScriptUpdate } from "../src/self-update-installation.js";

let root: string;
const runner = { run: vi.fn() };
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "workstation-update-")));
  runner.run.mockReset();
  runner.run.mockResolvedValue({ exitCode: 0, stdout: "[]", stderr: "" });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

/** Create a package fixture without installing or executing any real package manager. */
async function packageAt(directory: string): Promise<string> {
  await mkdir(join(directory, "dist"), { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "@dovocode/workstation" }));
  const cli = join(directory, "dist", "cli.js");
  await writeFile(cli, "");
  return cli;
}

/** Create a bin link or package link, including its parent directory. */
async function link(target: string, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await symlink(target, path);
}

/** Return pnpm's top-level global inventory for one installed package. */
function inventory(path: string, dependencyPath: string, version = "0.3.0"): void {
  runner.run.mockResolvedValue({
    exitCode: 0, stderr: "",
    stdout: JSON.stringify([{ path, dependencies: { "@dovocode/workstation": { path: dependencyPath, version } } }]),
  });
}

it("targets the running npm prefix even through multiple symlinks", async () => {
  const prefix = join(root, "custom node");
  const location = join(prefix, "lib/node_modules/@dovocode/workstation");
  const cli = await packageAt(location);
  const bin = join(prefix, "bin/workstation");
  await link(cli, bin);
  const alias = join(root, "bin/workstation");
  await link(bin, alias);
  expect(await resolveJavaScriptUpdate(runner, alias)).toEqual({
    command: "npm", args: ["install", "--global", "--prefix", prefix, "@dovocode/workstation@latest"], location,
  });
  expect(runner.run).not.toHaveBeenCalled();
});

it("rejects source checkouts and globally linked source without calling npm", async () => {
  const cli = await packageAt(join(root, "source"));
  const globalPackage = join(root, "prefix/lib/node_modules/@dovocode/workstation");
  await link(dirname(dirname(cli)), globalPackage);
  const bin = join(root, "prefix/bin/workstation");
  await link(join(globalPackage, "dist/cli.js"), bin);
  await expect(resolveJavaScriptUpdate(runner, cli)).rejects.toThrow("update and rebuild the source");
  await expect(resolveJavaScriptUpdate(runner, bin)).rejects.toThrow("Cannot safely self-update");
  expect(runner.run).not.toHaveBeenCalled();
});

it("rejects local dependencies even when another global package with the same name exists", async () => {
  const local = await packageAt(join(root, "project/node_modules/@dovocode/workstation"));
  const globalRoot = join(root, "pnpm/global/5");
  const globalPackage = join(globalRoot, "node_modules/@dovocode/workstation");
  await packageAt(globalPackage);
  inventory(globalRoot, globalPackage);
  await expect(resolveJavaScriptUpdate(runner, local)).rejects.toThrow("For a local dependency");
  expect(runner.run).toHaveBeenCalledExactlyOnceWith("pnpm", ["list", "--global", "--json"], { streamOutput: false });
});

it.each(["global/5", "global/v11/install-hash"])("recognizes pnpm's %s installation through its package symlink", async (layout) => {
  const globalRoot = join(root, "pnpm", layout);
  const storedPackage = join(root, "pnpm/global/store/node_modules/@dovocode/workstation");
  await packageAt(storedPackage);
  const globalPackage = join(globalRoot, "node_modules/@dovocode/workstation");
  await link(storedPackage, globalPackage);
  inventory(globalRoot, storedPackage);
  expect(await resolveJavaScriptUpdate(runner, join(globalPackage, "dist/cli.js"))).toEqual({
    command: "pnpm", args: ["update", "--global", "--latest", "@dovocode/workstation"], location: storedPackage,
  });
});

it("rejects a local link to the same pnpm store package as the global installation", async () => {
  const globalRoot = join(root, "pnpm/global/5");
  const storedPackage = join(root, "pnpm/global/store/node_modules/@dovocode/workstation");
  await packageAt(storedPackage);
  await link(storedPackage, join(globalRoot, "node_modules/@dovocode/workstation"));
  const localPackage = join(root, "project/node_modules/@dovocode/workstation");
  await link(storedPackage, localPackage);
  inventory(globalRoot, storedPackage);
  await expect(resolveJavaScriptUpdate(runner, join(localPackage, "dist/cli.js"))).rejects.toThrow("Cannot safely self-update");
});

it("rejects pnpm link dependencies instead of replacing their source", async () => {
  const globalRoot = join(root, "pnpm/global/5");
  const cli = await packageAt(join(globalRoot, "node_modules/@dovocode/workstation"));
  inventory(globalRoot, dirname(dirname(cli)), "link:../../source");
  await expect(resolveJavaScriptUpdate(runner, cli)).rejects.toThrow("Cannot safely self-update");
});

it("does not treat an npm-shaped local tree without its global bin link as global", async () => {
  const cli = await packageAt(join(root, "project/lib/node_modules/@dovocode/workstation"));
  await expect(resolveJavaScriptUpdate(runner, cli)).rejects.toThrow("Cannot safely self-update");
});

it("reports inventory failures without falling back to npm", async () => {
  const cli = await packageAt(join(root, "project/node_modules/@dovocode/workstation"));
  runner.run.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "global directory unavailable" });
  await expect(resolveJavaScriptUpdate(runner, cli)).rejects.toThrow("global directory unavailable");
  runner.run.mockRejectedValueOnce(Object.assign(new Error("missing pnpm"), { code: "ENOENT" }));
  await expect(resolveJavaScriptUpdate(runner, cli)).rejects.toThrow("Cannot safely self-update");
  expect(runner.run.mock.calls.every(([command]) => command === "pnpm")).toBe(true);
});

it("rejects malformed inventory before any installer command", async () => {
  const cli = await packageAt(join(root, "project/node_modules/@dovocode/workstation"));
  runner.run.mockResolvedValueOnce({ exitCode: 0, stdout: "{}", stderr: "" });
  await expect(resolveJavaScriptUpdate(runner, cli)).rejects.toThrow("invalid global installation inventory");
});

it("rejects unexpected package identities", async () => {
  const cli = await packageAt(join(root, "source"));
  await writeFile(join(root, "source/package.json"), '{"name":"another-package"}');
  await expect(resolveJavaScriptUpdate(runner, cli)).rejects.toThrow("Cannot safely self-update");
  expect(runner.run).not.toHaveBeenCalled();
});
