import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectResource, installResource, removeResource } from "../src/resources/dispatch.js";
import type { CommandResult, RunOptions, Runner } from "../src/api/types.js";

class BuildRunner implements Runner {
  readonly calls: Array<{ command: string; args: readonly string[]; options?: RunOptions }> = [];

  async run(command: string, args: readonly string[], options?: RunOptions): Promise<CommandResult> {
    this.calls.push({ command, args, ...(options ? { options } : {}) });
    const outputIndex = args.indexOf("--output") + 1;
    const output = args[outputIndex];
    if (!output) return { exitCode: 1, stdout: "", stderr: "missing output" };
    await writeFile(output, "compiled tool\n");
    return { exitCode: 0, stdout: "", stderr: "" };
  }
}

describe("custom tools", () => {
  it("builds into an atomic output and only removes the installed artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "workstation-custom-tool-"));
    const source = join(root, "source");
    const target = join(root, "bin", "example");
    const resource = {
      kind: "custom-tool" as const,
      name: "example",
      source,
      sourceHash: "source-hash",
      target,
      build: {
        command: "compiler",
        args: ["{source}", "--output", "{output}"],
        cwd: "{source}",
      },
    };
    const runner = new BuildRunner();

    const installed = await installResource(resource, runner);
    expect(await readFile(target, "utf8")).toBe("compiled tool\n");
    expect(runner.calls[0]?.args[0]).toBe(source);
    expect(runner.calls[0]?.options?.cwd).toBe(source);

    const inspection = await inspectResource(resource, runner);
    expect(inspection.installedHash).toBe(installed.installedHash);
    await removeResource(resource, runner, undefined, undefined, installed.installedHash);
    await expect(readFile(target, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
