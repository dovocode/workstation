import { afterEach, describe, expect, it, vi } from "vitest";
import { ProcessRunner } from "../src/resources/runner.js";

afterEach(() => vi.restoreAllMocks());

describe("process output", () => {
  it("streams mutation output once while retaining captured results and exit status", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await new ProcessRunner({ progress: true }).run(process.execPath,
      ["-e", 'process.stdout.write("working"); process.stderr.write("warning"); process.exitCode = 7'],
      { streamOutput: true });
    expect(result).toEqual({ stdout: "working", stderr: "warning", exitCode: 7 });
    expect(stdout.mock.calls.map(([chunk]) => chunk).join("")).toBe("working");
    expect(stderr.mock.calls.map(([chunk]) => chunk).join("")).toContain("-> exit 7");
  });

  it("captures query output without printing it by default", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await new ProcessRunner({ progress: true }).run(process.execPath, ["-e", 'process.stdout.write("metadata"); process.stderr.write("query diagnostic")']);
    expect(result.stdout).toBe("metadata");
    expect(result.stderr).toBe("query diagnostic");
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it("streams raw query output in verbose mode", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await new ProcessRunner({ verbose: true }).run(process.execPath, ["-e", 'process.stdout.write("metadata")']);
    expect(stdout).toHaveBeenCalledWith("metadata");
  });
});
