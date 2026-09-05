import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { files } from "../src/api/config.js";
import { jsonc } from "../src/api/jsonc.js";
import { renderGeneratedFile } from "../src/rendering/structured-file.js";
import { readManifest, writeManifest } from "../src/persistence/manifest.js";
import { applyPlan } from "../src/reconciliation/apply.js";
import type { ResolvedConfig, Runner } from "../src/api/types.js";

describe("JSONC builder", () => {
  it("composes comments, optional groups, nested values, and automatic commas", () => {
    const doc = jsonc.concat(
      jsonc.comment("Editor settings\nShared by both machines"),
      jsonc.object([
        jsonc.comment("Appearance"),
        jsonc.property("theme", "dark"),
        [false, null, undefined, jsonc.blank()],
        jsonc.property("editor", jsonc.object([
          jsonc.property('font"size', 14),
          jsonc.comment("Last comment"),
        ])),
        jsonc.property("extensions", jsonc.array([
          jsonc.comment("Enabled extensions"), jsonc.value("typescript"), jsonc.value(null),
        ])),
      ]),
    );
    const output = renderGeneratedFile(files.jsonc("settings.jsonc", doc));
    expect(output).toContain('  // Appearance\n  "theme": "dark",\n\n');
    expect(output).toContain('    "font\\"size": 14\n    // Last comment');
    const parsed = ts.parseConfigFileTextToJson("settings.jsonc", output);
    expect(parsed.error).toBeUndefined();
    expect(parsed.config).toEqual({ theme: "dark", editor: { 'font"size': 14 }, extensions: ["typescript", null] });
  });

  it("handles trailing comments on composed property values without swallowing commas", () => {
    const output = renderGeneratedFile(files.jsonc("settings.jsonc", jsonc.object([
      jsonc.property("a", jsonc.concat(jsonc.value(1), jsonc.comment("trailing"))),
      jsonc.property("b", 2),
    ])));
    const parsed = ts.parseConfigFileTextToJson("settings.jsonc", output);
    expect(parsed.error).toBeUndefined();
    expect(parsed.config).toEqual({ a: 1, b: 2 });
  });

  it("rejects invalid command placement and non-JSON numbers", () => {
    expect(() => jsonc.concat(jsonc.comment("No root"))).toThrow("exactly one value");
    expect(() => jsonc.concat(jsonc.value(1), jsonc.value(2))).toThrow("exactly one value");
    expect(() => jsonc.object([jsonc.value(1)])).toThrow("objects require properties");
    expect(() => jsonc.array([jsonc.property("x", 1)])).toThrow("arrays require values");
    expect(() => jsonc.value({ invalid: Infinity })).toThrow("finite");
  });

  it("round-trips comments through manifests and updates/restores files using local state", async () => {
    const root = await mkdtemp(join(tmpdir(), "workstation-jsonc-"));
    const target = join(root, "settings.jsonc");
    await writeFile(target, "// original\n{}\n");
    const config: ResolvedConfig = {
      context: { machine: "test", hostname: "test", platform: "linux", home: root, configDir: root },
      stateFile: join(root, "state.json"),
      resources: [files.jsonc(target, jsonc.concat(jsonc.comment("First"), jsonc.object([])))],
    };
    const runner: Runner = { async run() { throw new Error("No commands expected"); } };
    const manifest = join(root, "config.toml");
    await writeManifest(manifest, config);
    expect(await readManifest(manifest)).toEqual(config);
    await applyPlan(await readManifest(manifest), runner);
    expect(await readFile(target, "utf8")).toBe("// First\n{}\n");
    expect(await applyPlan(config, runner)).toEqual([]);
    await applyPlan({ ...config, resources: [files.jsonc(target, jsonc.concat(jsonc.comment("Second"), jsonc.object([])))] }, runner);
    expect(await readFile(target, "utf8")).toBe("// Second\n{}\n");
    await applyPlan({ ...config, resources: [] }, runner);
    expect(await readFile(target, "utf8")).toBe("// original\n{}\n");
  });
});
