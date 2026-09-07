import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { lockConfig } from "../src/persistence/lock.js";
import type { ResolvedConfig, Runner } from "../src/api/types.js";

it("refreshes selected pins and keeps other existing pins without querying them", async () => {
  const root = await mkdtemp(join(tmpdir(), "workstation-pins-"));
  const config: ResolvedConfig = { context: { home: root, configDir: root, machine: "test", hostname: "test", platform: "linux" }, stateFile: join(root, "state.json"), resources: ["node", "go"].map((name) => ({ kind: "package", manager: "mise", name, version: "latest" })) };
  const calls: string[] = [];
  let version = "1.0.0";
  const runner: Runner = { async run(command, args) { calls.push(`${command} ${args.join(" ")}`); return { exitCode: 0, stdout: version, stderr: "" }; } };
  const path = join(root, "config.ts");
  await lockConfig(path, config, runner);
  calls.length = 0;
  version = "2.0.0";
  const result = await lockConfig(path, config, runner, { refresh: ["package:mise:node"] });
  expect(calls).toEqual(["mise latest node@latest"]);
  expect(result.config.resources).toMatchObject([{ lockedVersion: "2.0.0" }, { lockedVersion: "1.0.0" }]);
  await expect(lockConfig(path, config, runner, { refresh: ["package:mise:typo"] })).rejects.toThrow("Unknown package");
});
