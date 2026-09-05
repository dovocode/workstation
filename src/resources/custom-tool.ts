import { chmod, lstat, mkdir, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import type { ResolvedResource, Runner } from "../api/types.js";
import { isMissingFile, requireSuccess, type Inspection } from "./shared.js";

/** Inspect the executable target and hash its current bytes for drift detection. */
export async function inspectCustomTool(resource: ResolvedResource & { kind: "custom-tool" }): Promise<Inspection> {
  try {
    const stats = await lstat(resource.target);
    if (!stats.isFile()) {
      return { present: true, matches: false, conflict: `${resource.target} is not a regular file` };
    }
    return {
      present: true,
      matches: true,
      installedHash: createHash("sha256").update(await readFile(resource.target)).digest("hex"),
    };
  } catch (error) {
    if (isMissingFile(error)) return { present: false, matches: false };
    throw error;
  }
}

/** Build into a temporary output, mark it executable, and atomically replace the target. */
export async function installCustomTool(
  resource: ResolvedResource & { kind: "custom-tool" },
  runner: Runner,
): Promise<void> {
  await mkdir(dirname(resource.target), { recursive: true });
  const output = `${resource.target}.${process.pid}.workstation.tmp`;
  await unlink(output).catch((error: unknown) => {
    if (!isMissingFile(error)) throw error;
  });
  const variables = { source: resource.source, output, target: resource.target };
  /** Expand source, output, and target placeholders in custom build arguments. */
  const replace = (value: string) =>
    value.replaceAll("{source}", variables.source).replaceAll("{output}", variables.output).replaceAll("{target}", variables.target);
  try {
    await requireSuccess(
      runner,
      resource.build.command,
      (resource.build.args ?? []).map(replace),
      {
        ...(resource.build.cwd ? { cwd: replace(resource.build.cwd) } : {}),
        ...(resource.build.environment
          ? { environment: Object.fromEntries(Object.entries(resource.build.environment).map(([key, value]) => [key, replace(value)])) }
          : {}),
      },
    );
    const stats = await lstat(output).catch((error: unknown) => {
      if (isMissingFile(error)) {
        throw new Error(`Custom tool build did not create {output}: ${resource.name}`);
      }
      throw error;
    });
    if (!stats.isFile()) throw new Error(`Custom tool output is not a regular file: ${output}`);
    await chmod(output, 0o755);
    await rename(output, resource.target);
  } finally {
    await unlink(output).catch(() => undefined);
  }
}

/** Remove an executable only when its bytes still match the recorded installation hash. */
export async function removeCustomTool(
  resource: ResolvedResource & { kind: "custom-tool" },
  installedHash?: string,
): Promise<void> {
  const inspection = await inspectCustomTool(resource);
  if (!inspection.present) return;
  if (!installedHash || inspection.installedHash !== installedHash) {
    throw new Error(`Refusing to remove changed custom tool: ${resource.target}`);
  }
  await unlink(resource.target);
}
