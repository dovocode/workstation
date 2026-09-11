import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lockConfig } from "../src/persistence/lock.js";
import type { CommandResult, ResolvedConfig, Runner } from "../src/api/types.js";

class RecordingRunner implements Runner {
  readonly calls: Array<{ command: string; args: readonly string[] }> = [];

  constructor(private readonly results: CommandResult[] = []) {}

  async run(command: string, args: readonly string[]): Promise<CommandResult> {
    this.calls.push({ command, args });
    const result = this.results.shift();
    if (!result) throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    return result;
  }
}

function config(root: string, machine = "macbook"): ResolvedConfig {
  return {
    context: {
      machine,
      hostname: `${machine}.local`,
      platform: "darwin",
      home: "/Users/test",
      configDir: root,
    },
    stateFile: join(root, "state.json"),
    resources: [
      { kind: "package", manager: "mise", name: "node", version: "lts" },
      { kind: "package", manager: "brew", name: "jq" },
      { kind: "package", manager: "brew-cask", name: "ghostty" },
      {
        kind: "generated-file",
        target: "/Users/test/.zshrc",
        format: "zsh",
        value: "alias ll='eza -la'\n",
        ifExists: "overwrite",
      },
    ],
  };
}

describe("workstation lock", () => {
  it("resolves versions once and reuses unchanged pins", async () => {
    const root = await mkdtemp(join(tmpdir(), "workstation-lock-test-"));
    const configPath = join(root, "workstation.config.ts");
    const runner = new RecordingRunner([
      { exitCode: 0, stdout: "24.20.0\n", stderr: "" },
      {
        exitCode: 0,
        stdout: JSON.stringify({ formulae: [{ versions: { stable: "1.8.1" } }] }),
        stderr: "",
      },
      {
        exitCode: 0,
        stdout: JSON.stringify({ casks: [{ version: "1.2.3" }] }),
        stderr: "",
      },
    ]);

    const first = await lockConfig(configPath, config(root), runner);
    expect(first.changed).toBe(true);
    expect(first.config.resources).toMatchObject([
      { name: "node", lockedVersion: "24.20.0" },
      { name: "jq", lockedVersion: "1.8.1" },
      { name: "ghostty", lockedVersion: "1.2.3" },
      { kind: "generated-file" },
    ]);
    expect(runner.calls).toEqual([
      { command: "mise", args: ["latest", "node@lts"] },
      { command: "brew", args: ["info", "--json=v2", "--formula", "jq"] },
      { command: "brew", args: ["info", "--json=v2", "--cask", "ghostty"] },
    ]);

    const unchangedRunner = new RecordingRunner();
    const second = await lockConfig(configPath, config(root), unchangedRunner);
    expect(second.changed).toBe(false);
    expect(second.config.resources).toEqual(first.config.resources);
    expect(unchangedRunner.calls).toEqual([]);

    const contents = await readFile(first.path, "utf8");
    expect(contents).toContain('machine = "macbook"');
    expect(contents).toContain('locked_version = "24.20.0"');
    expect(contents).toContain('id = "file:/Users/test/.zshrc"');
  });

  it("updates only a changed declaration and preserves other machines", async () => {
    const root = await mkdtemp(join(tmpdir(), "workstation-lock-test-"));
    const configPath = join(root, "workstation.config.ts");
    const initialResponses: CommandResult[] = [
      { exitCode: 0, stdout: "24.20.0\n", stderr: "" },
      {
        exitCode: 0,
        stdout: JSON.stringify({ formulae: [{ versions: { stable: "1.8.1" } }] }),
        stderr: "",
      },
      {
        exitCode: 0,
        stdout: JSON.stringify({ casks: [{ version: "1.2.3" }] }),
        stderr: "",
      },
    ];
    await lockConfig(configPath, config(root), new RecordingRunner(initialResponses));

    const studio = config(root, "studio");
    await lockConfig(configPath, { ...studio, resources: studio.resources.slice(3) }, new RecordingRunner());

    const beforeChange = config(root);
    const changed: ResolvedConfig = {
      ...beforeChange,
      resources: beforeChange.resources.map((resource) =>
        resource.kind === "package" && resource.manager === "mise"
          ? { ...resource, version: "24" }
          : resource,
      ),
    };
    const updateRunner = new RecordingRunner([
      { exitCode: 0, stdout: "24.21.0\n", stderr: "" },
    ]);
    const result = await lockConfig(configPath, changed, updateRunner);

    expect(updateRunner.calls).toEqual([{ command: "mise", args: ["latest", "node@24"] }]);
    expect(result.config.resources[0]).toMatchObject({ lockedVersion: "24.21.0" });
    const contents = await readFile(result.path, "utf8");
    expect(contents).toContain('machine = "macbook"');
    expect(contents).toContain('machine = "studio"');
  });

  it("pins APT candidates and leaves unversioned Homebrew casks floating", async () => {
    const root = await mkdtemp(join(tmpdir(), "workstation-lock-test-"));
    const configPath = join(root, "workstation.config.ts");
    const base = config(root);
    const linux: ResolvedConfig = {
      ...base,
      context: { ...base.context, machine: "server", hostname: "server", platform: "linux" },
      resources: [{ kind: "package", manager: "apt", name: "jq" }],
    };
    const apt = await lockConfig(
      configPath,
      linux,
      new RecordingRunner([
        { exitCode: 0, stdout: "jq:\n  Candidate: 1.7.1-3ubuntu0.1\n", stderr: "" },
      ]),
    );
    expect(apt.config.resources[0]).toMatchObject({ lockedVersion: "1.7.1-3ubuntu0.1" });

    const floating: ResolvedConfig = {
      ...base,
      context: { ...base.context, machine: "floating" },
      resources: [{ kind: "package", manager: "brew-cask", name: "rolling-app" }],
    };
    const brew = await lockConfig(
      configPath,
      floating,
      new RecordingRunner([
        {
          exitCode: 0,
          stdout: JSON.stringify({ casks: [{ version: "latest" }] }),
          stderr: "",
        },
      ]),
    );
    expect(brew.config.resources[0]).not.toHaveProperty("lockedVersion");
  });

  it("retains greedy cask pins until an explicit refresh", async () => {
    const root = await mkdtemp(join(tmpdir(), "workstation-lock-test-"));
    const configPath = join(root, "workstation.config.ts");
    const base = config(root);
    const greedy: ResolvedConfig = {
      ...base,
      resources: [
        {
          kind: "package",
          manager: "brew-cask",
          name: "ghostty",
          upgrade: { greedy: true, force: true },
        },
      ],
    };
    await lockConfig(
      configPath,
      greedy,
      new RecordingRunner([
        {
          exitCode: 0,
          stdout: JSON.stringify({ casks: [{ version: "1.2.3" }] }),
          stderr: "",
        },
      ]),
    );
    const unchanged = await lockConfig(configPath, greedy, new RecordingRunner([]));
    expect(unchanged.changed).toBe(false);
    const refreshed = await lockConfig(
      configPath,
      greedy,
      new RecordingRunner([
        {
          exitCode: 0,
          stdout: JSON.stringify({ casks: [{ version: "1.3.0" }] }),
          stderr: "",
        },
      ]),
      { refresh: true },
    );

    expect(refreshed.changed).toBe(true);
    expect(refreshed.config.resources[0]).toMatchObject({ lockedVersion: "1.3.0" });
  });
});
