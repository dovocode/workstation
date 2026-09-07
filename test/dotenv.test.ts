import { mkdtemp, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { files } from "../src/api/config.js";
import { mergeDotenv } from "../src/rendering/dotenv.js";
import { applyPlan } from "../src/reconciliation/apply.js";
import type { ResolvedConfig, Runner } from "../src/api/types.js";

it("preserves comments, CRLF, export prefixes and unrelated values without expanding commands", () => {
  const text = "# app\r\nexport PORT=3000 # keep\r\nOTHER=untouched\r\n";
  const values = { PORT: "4000", LITERAL: "$(whoami) $HOME" };
  const result = mergeDotenv(text, values);
  expect(result).toBe("# app\r\nexport PORT='4000' # keep\r\nOTHER=untouched\r\nLITERAL='$(whoami) $HOME'\r\n");
  expect(mergeDotenv(result, values)).toBe(result);
  expect(() => mergeDotenv("X=1\nX=2\n", { X: "3" })).toThrow("Duplicate");
  expect(() => mergeDotenv("X='unfinished\n", { X: "3" })).toThrow("quoting");
});

it("merges, converges and restores owned keys while retaining outside edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "workstation-dotenv-"));
  const target = join(root, ".env");
  await writeFile(target, "PORT=3000\nOTHER=keep\n");
  const config: ResolvedConfig = { context: { home: root, configDir: root, platform: "linux", machine: "test", hostname: "test" }, stateFile: join(root, "state.json"), resources: [files.dotenv(target, { PORT: "4000", NEW: "value" })] };
  const runner: Runner = { async run() { throw new Error("Unexpected external command"); } };
  await applyPlan(config, runner);
  expect((await stat(target)).mode & 0o777).toBe(0o600);
  expect(await applyPlan(config, runner)).toEqual([]);
  await writeFile(target, "PORT='4000'\nOTHER=edited\nNEW='value'\n");
  await applyPlan({ ...config, resources: [] }, runner);
  expect(await readFile(target, "utf8")).toBe("PORT=3000\nOTHER=edited\n");
});
