import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import metadata from "../package.json" with { type: "json" };
const files = vi.hoisted(() => ({
  chmod: vi.fn(), rename: vi.fn(), rm: vi.fn(), writeFile: vi.fn(),
}));
vi.mock("node:fs/promises", () => files);
const installation = vi.hoisted(() => vi.fn());
vi.mock("../src/self-update-installation.js", () => ({ resolveJavaScriptUpdate: installation }));
import { nativeAssetName, selfUpdate } from "../src/self-update.js";

const originalArgv = [...process.argv];
const runner = { run: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks();
  installation.mockResolvedValue({ command: "npm", args: ["install", "--global", "--prefix", "/custom/node", "@dovocode/workstation@latest"], location: "/custom/node/lib/node_modules/@dovocode/workstation" });
  runner.run.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  vi.spyOn(console, "log").mockImplementation(() => { });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  process.argv = [...originalArgv];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("uses a runner for JavaScript updates and propagates installer failures", async () => {
  process.argv[1] = "/not-the-native-executable.js";
  await selfUpdate(runner);
  expect(runner.run).toHaveBeenCalledWith("npm", ["install", "--global", "--prefix", "/custom/node", "@dovocode/workstation@latest"], { streamOutput: true });
  runner.run.mockResolvedValueOnce({ exitCode: 9, stdout: "", stderr: "permission denied" });
  await expect(selfUpdate(runner)).rejects.toThrow("permission denied");
  expect(files.writeFile).not.toHaveBeenCalled();
});

it("does not replace an up-to-date native executable", async () => {
  process.argv[1] = process.execPath;
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ tag_name: `v${metadata.version}` })));
  await selfUpdate(runner);
  expect(files.rename).not.toHaveBeenCalled();
  expect(runner.run).not.toHaveBeenCalled();
});

it("verifies a downloaded executable before replacement and cleans up on verification failure", async () => {
  process.argv[1] = process.execPath;
  const release = { tag_name: "v999.0.0", assets: [{ name: nativeAssetName(process.platform, process.arch), browser_download_url: "https://example.invalid/workstation" }] };
  vi.mocked(fetch).mockImplementation(async (url) => String(url).endsWith("/latest")
    ? new Response(JSON.stringify(release)) : new Response("fake binary bytes"));
  await selfUpdate(runner);
  expect(files.writeFile).toHaveBeenCalledOnce();
  expect(runner.run).toHaveBeenCalledWith(`${realpathSync(process.execPath)}.update-${process.pid}`, ["--help"], { streamOutput: false });
  expect(files.rename).toHaveBeenCalledWith(`${realpathSync(process.execPath)}.update-${process.pid}`, realpathSync(process.execPath));
  files.rename.mockClear();
  runner.run.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "invalid executable" });
  await expect(selfUpdate(runner)).rejects.toThrow("invalid executable");
  expect(files.rename).not.toHaveBeenCalled();
  expect(files.rm).toHaveBeenCalledWith(`${realpathSync(process.execPath)}.update-${process.pid}`, { force: true });
});

it("stops unsupported installations before downloads or mutations", async () => {
  process.argv[1] = "/project/dist/cli.js";
  installation.mockRejectedValueOnce(new Error("Cannot safely self-update"));
  await expect(selfUpdate(runner)).rejects.toThrow("Cannot safely self-update");
  expect(runner.run).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(files.writeFile).not.toHaveBeenCalled();
});

it("uses the verified pnpm channel without falling back to npm on failure", async () => {
  process.argv[1] = "/pnpm/global/node_modules/@dovocode/workstation/dist/cli.js";
  installation.mockResolvedValueOnce({ command: "pnpm", args: ["update", "--global", "--latest", "@dovocode/workstation"], location: "/pnpm/global" });
  runner.run.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "registry unavailable" });
  await expect(selfUpdate(runner)).rejects.toThrow("registry unavailable");
  expect(runner.run).toHaveBeenCalledExactlyOnceWith("pnpm", ["update", "--global", "--latest", "@dovocode/workstation"], { streamOutput: true });
});

it("replaces the native symlink target rather than overwriting the link", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "workstation-native-update-")));
  const target = join(root, "workstation");
  const alias = join(root, "alias");
  writeFileSync(target, "original executable");
  symlinkSync(target, alias);
  const originalExecPath = process.execPath;
  try {
    Object.defineProperty(process, "execPath", { value: alias });
    process.argv[1] = alias;
    const release = { tag_name: "v999.0.0", assets: [{ name: nativeAssetName(process.platform, process.arch), browser_download_url: "https://example.invalid/workstation" }] };
    vi.mocked(fetch).mockImplementation(async (url) => String(url).endsWith("/latest")
      ? new Response(JSON.stringify(release)) : new Response("replacement"));
    await selfUpdate(runner);
    expect(files.rename).toHaveBeenCalledExactlyOnceWith(`${target}.update-${process.pid}`, target);
    expect(realpathSync(alias)).toBe(target);
    expect(installation).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(process, "execPath", { value: originalExecPath });
    rmSync(root, { recursive: true, force: true });
  }
});
