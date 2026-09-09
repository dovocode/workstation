import { lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nativeAssetName, selfUpdate } from "../src/self-update.js";
import { ProcessRunner } from "../src/resources/runner.js";

const originalArgv = [...process.argv];
const originalExecPath = process.execPath;
const originalBinary = "#!/bin/sh\nprintf 'original version\\n'\n";
const replacementBinary = "#!/bin/sh\n[ \"$1\" = \"--help\" ] || exit 1\nprintf 'replacement help\\n'\n";
let root: string;

beforeEach(async () => {
  vi.spyOn(process, "getBuiltinModule").mockReturnValue({ ...process.getBuiltinModule("node:sea"), isSea: () => true });
  root = await realpath(await mkdtemp(join(tmpdir(), "workstation-native-files-")));
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  Object.defineProperty(process, "execPath", { value: originalExecPath });
  process.argv = [...originalArgv];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

/** Simulate a running downloaded binary while retaining real filesystem and child-process operations. */
async function installedBinary(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, originalBinary, { mode: 0o755 });
  Object.defineProperty(process, "execPath", { value: path });
  process.argv[1] = path;
}

/** Supply fixture release bytes without accessing GitHub or downloading a real release. */
function release(binary = replacementBinary): void {
  const downloadUrl = "https://example.invalid/workstation";
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === downloadUrl) return new Response(binary);
    if (url === "https://api.github.com/repos/dovocode/workstation/releases/latest") {
      return new Response(JSON.stringify({
        tag_name: "v999.0.0",
        assets: [{ name: nativeAssetName(process.platform, process.arch), browser_download_url: downloadUrl }],
      }));
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
}

it.each(["home/.local/bin/workstation", "custom tools/renamed-workstation"])(
  "updates the curl/manual installation at %s without touching another copy",
  async (location) => {
    const executable = join(root, location);
    const other = join(root, "other-workstation");
    await writeFile(other, originalBinary);
    await installedBinary(executable);
    // A relative invocation must still identify the same native executable.
    process.argv[1] = relative(process.cwd(), executable);
    release();
    const runner = new ProcessRunner();
    const run = vi.spyOn(runner, "run");
    await selfUpdate(runner);
    expect(await readFile(executable, "utf8")).toBe(replacementBinary);
    expect((await stat(executable)).mode & 0o777).toBe(0o755);
    expect(await readFile(other, "utf8")).toBe(originalBinary);
    expect(run).toHaveBeenCalledExactlyOnceWith(`${executable}.update-${process.pid}`, ["--help"], { streamOutput: false });
    await expect(stat(`${executable}.update-${process.pid}`)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("updates a manually placed executable through a symlink chain and preserves both links", async () => {
  const executable = join(root, "manual install/workstation-custom");
  await installedBinary(executable);
  const inner = join(root, "inner");
  const outer = join(root, "outer");
  await symlink(executable, inner);
  await symlink(inner, outer);
  Object.defineProperty(process, "execPath", { value: inner });
  process.argv[1] = outer;
  release();
  await selfUpdate(new ProcessRunner());
  expect(await readFile(executable, "utf8")).toBe(replacementBinary);
  expect((await lstat(inner)).isSymbolicLink()).toBe(true);
  expect((await lstat(outer)).isSymbolicLink()).toBe(true);
  expect(await realpath(outer)).toBe(executable);
});

it("retains the existing custom-path binary and removes the download when startup validation fails", async () => {
  const executable = join(root, "custom/workstation");
  await installedBinary(executable);
  release("#!/bin/sh\nprintf 'broken release' >&2\nexit 1\n");
  await expect(selfUpdate(new ProcessRunner())).rejects.toThrow("broken release");
  expect(await readFile(executable, "utf8")).toBe(originalBinary);
  await expect(stat(`${executable}.update-${process.pid}`)).rejects.toMatchObject({ code: "ENOENT" });
});
