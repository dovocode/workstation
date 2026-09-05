import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";

describe("configuration composition", () => {
  it("follows imports, ignores nullish fragments, and lets later resources override", async () => {
    const root = await mkdtemp(join(tmpdir(), "workstation-config-test-"));
    await writeFile(
      join(root, "common.ts"),
      `export default { resources: [
        { kind: "package", manager: "mise", name: "node", version: "20" }
      ] };`,
    );
    await writeFile(
      join(root, "workstation.config.ts"),
      `import common from "./common.ts";
       export default [
         common,
         null,
         undefined,
         false,
         ({ machine }) => machine === "studio" ? {
           resources: [{ kind: "package", manager: "mise", name: "node", version: "22" }]
         } : undefined
       ];`,
    );

    const config = await loadConfig(join(root, "workstation.config.ts"), "studio");

    expect(config.resources).toEqual([
      { kind: "package", manager: "mise", name: "node", version: "22" },
    ]);
  });

  it("fingerprints custom tool source trees", async () => {
    const root = await mkdtemp(join(tmpdir(), "workstation-tool-config-test-"));
    const source = join(root, "tool");
    await mkdir(source);
    await writeFile(join(source, "main.go"), "package main\n");
    const configPath = join(root, "workstation.config.ts");
    await writeFile(
      configPath,
      `export default { resources: [{
        kind: "custom-tool",
        name: "example",
        source: "tool",
        target: "~/.local/bin/example",
        build: { command: "go", args: ["build", "-o", "{output}", "."] }
      }] };`,
    );

    const first = await loadConfig(configPath, "test");
    await writeFile(join(source, "main.go"), "package main\n// changed\n");
    const second = await loadConfig(configPath, "test");

    expect(first.resources[0]).toMatchObject({ kind: "custom-tool", source });
    expect(second.resources[0]).toMatchObject({ kind: "custom-tool", source });
    expect(first.resources[0]).not.toEqual(second.resources[0]);
  });
});
