import { afterEach, beforeEach, expect, it, vi } from "vitest";
import metadata from "../package.json" with { type: "json" };
const files = vi.hoisted(() => ({
  chmod: vi.fn(), rename: vi.fn(), rm: vi.fn(), writeFile: vi.fn(),
}));
vi.mock("node:fs/promises", () => files);
import { nativeAssetName, selfUpdate } from "../src/self-update.js";

const originalArgv = [...process.argv];
const runner = { run: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks();
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
  expect(runner.run).toHaveBeenCalledWith("npm", ["install", "--global", "@dovocode/workstation@latest"], { streamOutput: true });
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
  expect(runner.run).toHaveBeenCalledWith(`${process.execPath}.update-${process.pid}`, ["--help"], { streamOutput: false });
  expect(files.rename).toHaveBeenCalledWith(`${process.execPath}.update-${process.pid}`, process.execPath);
  files.rename.mockClear();
  runner.run.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "invalid executable" });
  await expect(selfUpdate(runner)).rejects.toThrow("invalid executable");
  expect(files.rename).not.toHaveBeenCalled();
  expect(files.rm).toHaveBeenCalledWith(`${process.execPath}.update-${process.pid}`, { force: true });
});
