import type { ResolvedResource, Runner } from "../api/types.js";
import { requireSuccess } from "./shared.js";

/** Identify npm dist-tag requests while leaving numeric selectors and other mise backends alone. */
export function npmDistTagSpec(resource: ResolvedResource): string | undefined {
  if (resource.kind !== "package" || resource.manager !== "mise" || !resource.name.startsWith("npm:")) return undefined;
  const selector = resource.version ?? "latest";
  if (!/^[A-Za-z_][A-Za-z0-9._-]*$/.test(selector)) return undefined;
  // Inline mise backend options are not part of the npm package name.
  const name = resource.name.slice(4).split("[")[0];
  return `${name}@${selector}`;
}

/** Let npm resolve its own tags and registry/auth configuration, then lock the concrete version. */
export async function resolveNpmDistTag(spec: string, runner: Runner): Promise<string> {
  const result = await requireSuccess(runner, "npm", ["view", spec, "version", "--json"]);
  let version: unknown;
  try {
    version = JSON.parse(result.stdout);
  } catch (cause) {
    throw new Error(`npm view ${spec} did not report a valid version`, { cause });
  }
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(version)) {
    throw new Error(`npm view ${spec} did not report a concrete version`);
  }
  return version;
}
