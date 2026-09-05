import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readManifest, writeManifest } from "../src/persistence/manifest.js";
import type { ResolvedConfig } from "../src/api/types.js";

describe("resolved TOML manifest", () => {
  it("round-trips the executable configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "workstation-manifest-test-"));
    const path = join(root, "config.toml");
    const config: ResolvedConfig = {
      context: {
        machine: "studio",
        hostname: "studio.local",
        platform: "darwin",
        home: "/Users/test",
        configDir: "/repo",
      },
      stateFile: join(root, "state.json"),
      resources: [
        {
          kind: "package",
          manager: "brew-cask",
          name: "ghostty",
          lockedVersion: "1.2.3",
          upgrade: { greedy: true, force: true },
        },
        { kind: "symlink", source: "/repo/zshrc", target: "/Users/test/.zshrc" },
        {
          kind: "launch-agent",
          label: "dev.example.worker",
          program: "/opt/homebrew/bin/worker",
          args: ["serve"],
          environment: { PATH: "/opt/homebrew/bin:/usr/bin" },
          keepAlive: true,
          stdoutPath: "/Users/test/Library/Logs/worker.log",
        },
        {
          kind: "generated-file",
          target: "/Users/test/.config/example/config.jsonc",
          format: "jsonc",
          value: { enabled: true, optional: null },
          ifExists: "overwrite",
          mode: 0o600,
        },
        {
          kind: "systemd-service",
          name: "example.service",
          scope: "user",
          program: "/usr/bin/example",
          args: ["serve"],
          restart: "always",
        },
        {
          kind: "generated-file",
          target: "/Users/test/.zshrc",
          format: "zsh",
          value: "alias ll='eza -la'\n",
          ifExists: "overwrite",
          mode: 0o644,
        },
        {
          kind: "custom-tool",
          name: "keyhold",
          source: "/repo/tools/keyhold",
          sourceHash: "abc123",
          target: "/Users/test/.local/bin/keyhold",
          build: {
            command: "go",
            args: ["build", "-o", "{output}", "."],
            cwd: "{source}",
          },
        },
      ],
    };

    await writeManifest(path, config);

    expect(await readManifest(path)).toEqual(config);
    expect(await readFile(path, "utf8")).toContain('name = "ghostty"');
    expect(await readFile(path, "utf8")).toContain('locked_version = "1.2.3"');
  });
});
