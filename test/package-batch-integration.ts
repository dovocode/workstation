import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import type { ResolvedConfig, ResolvedPackageResource, Runner } from "../src/api/types.js";
import { applyPlan } from "../src/reconciliation/apply.js";
import { resolvePackageVersion } from "../src/resources/package-version.js";

/** Exercise actual native multi-target install/removal commands in an isolated backend. */
export async function verifyNativeBatch(declarations: readonly ResolvedPackageResource[], backend: Runner): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "workstation-native-batch-"));
  const resources: ResolvedPackageResource[] = [];
  for (const declaration of declarations) {
    const lockedVersion = await resolvePackageVersion(declaration, backend);
    resources.push({ ...declaration, ...(lockedVersion ? { lockedVersion } : {}) });
  }
  const mutations: string[][] = [];
  const runner: Runner = { async run(command, args, options) {
    if (options?.streamOutput) mutations.push([command, ...args]);
    return backend.run(command, args, options);
  } };
  const config: ResolvedConfig = { context: { machine: "integration", hostname: "integration", platform: "linux", home: root, configDir: root },
    stateFile: join(root, "state.json"), resources };
  expect((await applyPlan(config, runner)).map((action) => action.type)).toEqual(declarations.map(() => "create"));
  expect(mutations).toHaveLength(1);
  expect(await applyPlan(config, runner)).toEqual([]);
  expect((await applyPlan({ ...config, resources: [] }, runner)).map((action) => action.type)).toEqual(declarations.map(() => "remove"));
  expect(mutations).toHaveLength(2);
  expect(await applyPlan({ ...config, resources: [] }, runner)).toEqual([]);
}
