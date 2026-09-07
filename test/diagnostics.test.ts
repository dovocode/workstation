import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { diagnose, inspectStatus } from "../src/diagnostics.js";
import { writeState } from "../src/persistence/state.js";
import { fingerprint, resourceId } from "../src/config/identity.js";
import type { ResolvedConfig, Runner } from "../src/api/types.js";

it("uses recorded exact versions without resolving new pins and reports missing managers", async () => {
  const root = await mkdtemp(join(tmpdir(), "workstation-diagnostics-"));
  const resource = { kind: "package", manager: "mise", name: "node", version: "lts", lockedVersion: "22.0.0" } as const;
  const id = resourceId(resource);
  const config: ResolvedConfig = { context: { home: root, configDir: root, platform: "linux", machine: "test", hostname: "test" }, stateFile: join(root, "state.json"), resources: [{ kind: "package", manager: "mise", name: "node", version: "lts" }] };
  await writeState(config.stateFile, { version: 1, machine: "test", resources: { [id]: { id, resource, fingerprint: fingerprint(resource), owned: false } } });
  const calls: unknown[] = [];
  const runner: Runner = { async run(command, args) { calls.push([command, ...args]); return { exitCode: 0, stdout: "/installed/node", stderr: "" }; } };
  expect(await inspectStatus(config, runner)).toEqual([{ id, status: "converged" }]);
  expect(calls).toEqual([["mise", "where", "node@22.0.0"]]);
  expect((await diagnose(config, root))[0]).toBe("MISSING mise (mise)");
  expect(await inspectStatus({ ...config, resources: [] }, runner)).toEqual([{ id, status: "removed-declaration" }]);
});
