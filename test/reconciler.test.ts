import { chmod, lstat, mkdtemp, mkdir, readFile, readlink, symlink as createSymlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyPlan, createPlan } from "../src/reconciliation/apply.js";
import { fingerprint, resourceId } from "../src/config/load.js";
import { writeState } from "../src/persistence/state.js";
import type { CommandResult, ResolvedConfig, Runner } from "../src/api/types.js";

class UnusedRunner implements Runner {
  async run(): Promise<CommandResult> {
    throw new Error("Runner should not be used by symlink tests");
  }
}

class SequenceRunner implements Runner {
  readonly calls: Array<{ command: string; args: readonly string[] }> = [];

  constructor(private readonly results: CommandResult[]) {}

  async run(command: string, args: readonly string[]): Promise<CommandResult> {
    this.calls.push({ command, args });
    const result = this.results.shift();
    if (!result) throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    return result;
  }
}

async function makeFixture(): Promise<{
  readonly root: string;
  readonly source: string;
  readonly target: string;
  readonly stateFile: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "workstation-test-"));
  const source = join(root, "source");
  const target = join(root, "home", "target");
  await writeFile(source, "managed\n");
  return { root, source, target, stateFile: join(root, "state", "state.json") };
}

function config(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  resources: ResolvedConfig["resources"],
): ResolvedConfig {
  return {
    context: {
      machine: "test-machine",
      hostname: "test-machine",
      platform: "linux",
      home: join(fixture.root, "home"),
      configDir: fixture.root,
    },
    resources,
    stateFile: fixture.stateFile,
  };
}

describe("reconciliation ownership", () => {
  it.each([false, true])("repairs a normalized matching path through a missing directory (managed: %s)", async (managed) => {
    const files = await makeFixture();
    const resource = { kind: "symlink" as const, source: files.source, target: files.target };
    const runner = new UnusedRunner();
    if (managed) {
      await applyPlan(config(files, [resource]), runner);
      await unlink(files.target);
    } else {
      await mkdir(join(files.root, "home"), { recursive: true });
    }
    await createSymlink(`${files.root}/missing/../source`, files.target);
    await expect(readFile(files.target)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await applyPlan(config(files, [resource]), runner)).map((action) => action.type)).toEqual(["update"]);
    expect(await readlink(files.target)).toBe(files.source);
    expect(await readFile(files.target, "utf8")).toBe("managed\n");
    expect(await applyPlan(config(files, [resource]), runner)).toEqual([]);
  });

  it.each([false, true])("recreates a different pre-existing link (broken: %s) without taking ownership", async (broken) => {
    const files = await makeFixture();
    const oldSource = join(files.root, "old-source");
    if (!broken) await writeFile(oldSource, "old content");
    await mkdir(join(files.root, "home"), { recursive: true });
    await createSymlink(oldSource, files.target);
    const resource = { kind: "symlink" as const, source: files.source, target: files.target };
    const runner = new UnusedRunner();
    expect((await applyPlan(config(files, [resource]), runner)).map((action) => action.type)).toEqual(["update"]);
    expect(await readlink(files.target)).toBe(files.source);
    expect(await applyPlan(config(files, [resource]), runner)).toEqual([]);
    expect((await applyPlan(config(files, []), runner)).map((action) => action.type)).toEqual(["forget"]);
    expect(await readlink(files.target)).toBe(files.source);
    if (!broken) expect(await readFile(oldSource, "utf8")).toBe("old content");
  });

  it.each([false, true])("updates an existing link after its configured source changes (owned: %s)", async (owned) => {
    const files = await makeFixture();
    if (!owned) {
      await mkdir(join(files.root, "home"), { recursive: true });
      await createSymlink(files.source, files.target);
    }
    const resource = { kind: "symlink" as const, source: files.source, target: files.target };
    const runner = new UnusedRunner();
    await applyPlan(config(files, [resource]), runner);
    const newSource = join(files.root, "new-source");
    await writeFile(newSource, "replacement");
    await applyPlan(config(files, [{ ...resource, source: newSource }]), runner);
    expect(await readlink(files.target)).toBe(newSource);
    expect((await applyPlan(config(files, []), runner)).map((action) => action.type)).toEqual([owned ? "remove" : "forget"]);
  });

  it("repairs external link drift but refuses to delete that drift on declaration removal", async () => {
    const files = await makeFixture();
    const resource = { kind: "symlink" as const, source: files.source, target: files.target };
    const runner = new UnusedRunner();
    await applyPlan(config(files, [resource]), runner);
    await unlink(files.target);
    await createSymlink(join(files.root, "missing-old-source"), files.target);
    await expect(applyPlan(config(files, []), runner)).rejects.toThrow("Refusing to remove changed resource");
    await applyPlan(config(files, [resource]), runner);
    expect(await readlink(files.target)).toBe(files.source);
  });

  it("keeps an equivalent relative link unchanged and protects existing directories", async () => {
    const files = await makeFixture();
    await mkdir(join(files.root, "home"), { recursive: true });
    await createSymlink("../source", files.target);
    const resource = { kind: "symlink" as const, source: files.source, target: files.target };
    const runner = new UnusedRunner();
    await applyPlan(config(files, [resource]), runner);
    expect(await readlink(files.target)).toBe("../source");
    await unlink(files.target);
    await mkdir(files.target);
    await expect(applyPlan(config(files, [resource]), runner)).rejects.toThrow("not a symbolic link");
    expect((await lstat(files.target)).isDirectory()).toBe(true);
  });

  it("keeps the old mise version and state when installing its replacement fails", async () => {
    const files = await makeFixture();
    const resource = { kind: "package" as const, manager: "mise" as const, name: "node", version: "lts", lockedVersion: "22.0.0" };
    const id = resourceId(resource);
    const state = { version: 1 as const, machine: "test-machine", resources: {
      [id]: { id, resource, fingerprint: fingerprint(resource), owned: true, installedVersion: "22.0.0" },
    } };
    await writeState(files.stateFile, state);
    const absent = { exitCode: 1, stdout: "", stderr: "not installed" };
    const runner = new SequenceRunner([absent, absent, absent, { ...absent, stderr: "download failed" }]);
    await expect(applyPlan(config(files, [{ ...resource, lockedVersion: "24.0.0" }]), runner))
      .rejects.toThrow("download failed");
    expect(runner.calls.some(({ args }) => args[0] === "uninstall")).toBe(false);
    expect(JSON.parse(await readFile(files.stateFile, "utf8"))).toEqual(state);
  });

  it("recreates missing custom tools but rejects changed binaries even when source changes", async () => {
    const files = await makeFixture();
    const resource = {
      kind: "custom-tool" as const, name: "example", source: files.source,
      sourceHash: "original-source", target: files.target,
      build: { command: "compiler", args: ["{output}"] },
    };
    const id = resourceId(resource);
    await writeState(files.stateFile, {
      version: 1, machine: "test-machine",
      resources: { [id]: { id, resource, fingerprint: fingerprint(resource), owned: true, installedHash: "original-binary" } },
    });
    const runner = new UnusedRunner();
    expect(await createPlan(config(files, [resource]), runner)).toMatchObject([{ type: "create" }]);
    await mkdir(join(files.root, "home"), { recursive: true });
    await writeFile(files.target, "external binary");
    await expect(createPlan(config(files, [{ ...resource, sourceHash: "new-source" }]), runner))
      .rejects.toThrow("changed outside Workstation");
  });

  it("records declaration-only changes without rewriting an already matching file", async () => {
    const files = await makeFixture();
    const resource = {
      kind: "generated-file" as const, target: files.target,
      format: "zsh" as const, value: "managed\n", ifExists: "overwrite" as const,
    };
    const runner = new UnusedRunner();
    await applyPlan(config(files, [resource]), runner);
    const before = await lstat(files.target);
    const next = { ...resource, mode: 0o644 };
    await applyPlan(config(files, [next]), runner);
    expect((await lstat(files.target)).ino).toBe(before.ino);
    expect(await createPlan(config(files, [next]), runner)).toEqual([]);
    await applyPlan(config(files, []), runner);
    await expect(lstat(files.target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects overlapping runs and releases the guard after failure", async () => {
    const files = await makeFixture();
    await mkdir(`${files.stateFile}.lock`, { recursive: true });
    await expect(applyPlan(config(files, []), new UnusedRunner())).rejects.toThrow("Another Workstation run");
    await (await import("node:fs/promises")).rmdir(`${files.stateFile}.lock`);
    const resource = { kind: "symlink" as const, source: join(files.root, "missing"), target: files.target };
    await expect(applyPlan(config(files, [resource]), new UnusedRunner())).rejects.toThrow();
    await expect(applyPlan(config(files, []), new UnusedRunner())).resolves.toEqual([]);
  });

  it("preflights all removals before deleting any owned files", async () => {
    const files = await makeFixture();
    const first = { kind: "symlink" as const, source: files.source, target: files.target };
    const second = { ...first, target: `${files.target}-second` };
    const runner = new UnusedRunner();
    await applyPlan(config(files, [first, second]), runner);
    await unlink(second.target);
    await writeFile(second.target, "external replacement");
    await expect(applyPlan(config(files, []), runner)).rejects.toThrow("Refusing to remove changed resource");
    expect(await readlink(first.target)).toBe(files.source);
  });

  it("updates owned files without saving managed content as an original and converges", async () => {
    const files = await makeFixture();
    const resource = {
      kind: "generated-file" as const, target: files.target,
      format: "zsh" as const, value: "first\n", ifExists: "overwrite" as const,
    };
    const runner = new UnusedRunner();
    await applyPlan(config(files, [resource]), runner);
    const next = { ...resource, value: "second\n" };
    await applyPlan(config(files, [next]), runner);
    expect(await readFile(files.target, "utf8")).toBe("second\n");
    expect(await createPlan(config(files, [next]), runner)).toEqual([]);
    await applyPlan(config(files, []), runner);
    await expect(lstat(files.target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("repairs permissions and content atomically for owned update-policy files", async () => {
    const files = await makeFixture();
    const resource = {
      kind: "generated-file" as const, target: files.target,
      format: "zsh" as const, value: "first\n", ifExists: "update" as const, mode: 0o600,
    };
    const runner = new UnusedRunner();
    await applyPlan(config(files, [resource]), runner);
    await chmod(files.target, 0o644);
    expect(await createPlan(config(files, [resource]), runner)).toHaveLength(1);
    await applyPlan(config(files, [resource]), runner);
    expect((await lstat(files.target)).mode & 0o777).toBe(0o600);
    const next = { ...resource, value: "second\n" };
    await applyPlan(config(files, [next]), runner);
    expect(await readFile(files.target, "utf8")).toBe("second\n");
    expect(await createPlan(config(files, [next]), runner)).toEqual([]);
  });

  it("preserves the original backup when a managed replacement is recreated", async () => {
    const files = await makeFixture();
    await mkdir(join(files.root, "home"), { recursive: true });
    await writeFile(files.target, "original\n");
    const resource = {
      kind: "generated-file" as const, target: files.target,
      format: "zsh" as const, value: "managed\n", ifExists: "overwrite" as const,
    };
    const runner = new UnusedRunner();
    await applyPlan(config(files, [resource]), runner);
    await unlink(files.target);
    await applyPlan(config(files, [resource]), runner);
    await applyPlan(config(files, []), runner);
    expect(await readFile(files.target, "utf8")).toBe("original\n");
  });

  it("keeps an owned symlink intact when its replacement source is missing", async () => {
    const files = await makeFixture();
    const resource = { kind: "symlink" as const, source: files.source, target: files.target };
    const runner = new UnusedRunner();
    await applyPlan(config(files, [resource]), runner);
    await expect(applyPlan(config(files, [{ ...resource, source: join(files.root, "missing") }]), runner))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(await readlink(files.target)).toBe(files.source);
  });

  it("creates and later removes an owned symlink", async () => {
    const files = await makeFixture();
    const resource = { kind: "symlink" as const, source: files.source, target: files.target };
    const runner = new UnusedRunner();

    await applyPlan(config(files, [resource]), runner);
    expect(await readlink(files.target)).toBe(files.source);

    const removal = await createPlan(config(files, []), runner);
    expect(removal.map((action) => action.type)).toEqual(["remove"]);
    await applyPlan(config(files, []), runner);
    await expect(readlink(files.target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("records a matching pre-existing symlink as adopted and never removes it", async () => {
    const files = await makeFixture();
    await mkdir(join(files.root, "home"), { recursive: true });
    await createSymlink(files.source, files.target);
    const resource = { kind: "symlink" as const, source: files.source, target: files.target };
    const runner = new UnusedRunner();

    const adoption = await applyPlan(config(files, [resource]), runner);
    expect(adoption.map((action) => action.type)).toEqual(["adopt"]);
    const removal = await createPlan(config(files, []), runner);
    expect(removal.map((action) => action.type)).toEqual(["forget"]);
    await applyPlan(config(files, []), runner);
    expect(await readlink(files.target)).toBe(files.source);

    const state = JSON.parse(await readFile(files.stateFile, "utf8")) as { resources: object };
    expect(state.resources).toEqual({});
  });

  it("keeps a pre-existing cask adopted after upgrading it", async () => {
    const files = await makeFixture();
    const resource = {
      kind: "package" as const,
      manager: "brew-cask" as const,
      name: "ghostty",
      upgrade: { greedy: true, force: true },
    };
    const installed = { exitCode: 0, stdout: "ghostty\n", stderr: "" };
    const outdated = { exitCode: 0, stdout: "ghostty\n", stderr: "" };
    const current = { exitCode: 0, stdout: "", stderr: "" };
    const runner = new SequenceRunner([
      installed,
      outdated,
      installed,
      outdated,
      installed,
      outdated,
      current,
      installed,
      current,
    ]);

    const actions = await applyPlan(config(files, [resource]), runner);
    expect(actions.map((action) => action.type)).toEqual(["update"]);
    expect(runner.calls).toContainEqual({
      command: "brew",
      args: ["upgrade", "--cask", "--no-ask", "--greedy", "--force", "ghostty"],
    });

    const state = JSON.parse(await readFile(files.stateFile, "utf8")) as {
      resources: Record<string, { owned: boolean }>;
    };
    expect(state.resources["package:brew-cask:ghostty"]?.owned).toBe(false);
    await expect(createPlan(config(files, []), new UnusedRunner())).resolves.toMatchObject([
      { type: "forget" },
    ]);
  });

  it("restores a file replaced with the overwrite policy", async () => {
    const files = await makeFixture();
    await mkdir(join(files.root, "home"), { recursive: true });
    await writeFile(files.target, "personal configuration\n", { mode: 0o640 });
    const resource = {
      kind: "generated-file" as const,
      target: files.target,
      format: "json" as const,
      value: { managed: true },
      ifExists: "overwrite" as const,
      mode: 0o600,
    };
    const runner = new UnusedRunner();

    await applyPlan(config(files, [resource]), runner);
    expect(await readFile(files.target, "utf8")).toBe('{\n  "managed": true\n}\n');

    await applyPlan(config(files, []), runner);
    expect(await readFile(files.target, "utf8")).toBe("personal configuration\n");
  });

  it("restores a symlink replaced with the overwrite policy", async () => {
    const files = await makeFixture();
    await mkdir(join(files.root, "home"), { recursive: true });
    await createSymlink(files.source, files.target);
    const resource = {
      kind: "generated-file" as const,
      target: files.target,
      format: "zsh" as const,
      value: "export MANAGED=1\n",
      ifExists: "overwrite" as const,
    };
    const runner = new UnusedRunner();

    await applyPlan(config(files, [resource]), runner);
    expect(await readFile(files.target, "utf8")).toBe("export MANAGED=1\n");

    await applyPlan(config(files, []), runner);
    expect(await readlink(files.target)).toBe(files.source);
  });

  it("refuses to overwrite a conflicting target", async () => {
    const files = await makeFixture();
    await mkdir(join(files.root, "home"), { recursive: true });
    await writeFile(files.target, "personal\n");
    const resource = { kind: "symlink" as const, source: files.source, target: files.target };

    await expect(createPlan(config(files, [resource]), new UnusedRunner())).rejects.toThrow(
      "exists and is not a symbolic link",
    );
  });

  it("forgets an owned resource that was already removed manually", async () => {
    const files = await makeFixture();
    const resource = { kind: "symlink" as const, source: files.source, target: files.target };
    const runner = new UnusedRunner();
    await applyPlan(config(files, [resource]), runner);
    await (await import("node:fs/promises")).unlink(files.target);

    const removal = await createPlan(config(files, []), runner);
    expect(removal.map((action) => action.type)).toEqual(["forget"]);
    await expect(applyPlan(config(files, []), runner)).resolves.toHaveLength(1);
  });

  it("rejects state that cannot be safely reconciled", async () => {
    const files = await makeFixture();
    await mkdir(join(files.root, "state"), { recursive: true });
    await writeFile(
      files.stateFile,
      JSON.stringify({
        version: 1,
        machine: "test-machine",
        resources: {
          "package:apt:curl": {
            id: "package:apt:curl",
            fingerprint: "tampered",
            owned: true,
            resource: { kind: "package", manager: "apt", name: "sudo" },
          },
        },
      }),
    );

    await expect(createPlan(config(files, []), new UnusedRunner())).rejects.toThrow(
      "Unsupported or invalid state file",
    );
  });
});
