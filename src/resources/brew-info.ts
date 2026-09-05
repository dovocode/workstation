import type { ResolvedPackageResource, Runner } from "../api/types.js";
import { requireSuccess } from "./shared.js";

/** Read the installed formula or cask version from Homebrew JSON metadata. */
export async function readInstalledBrewVersion(
  resource: ResolvedPackageResource,
  runner: Runner,
): Promise<string | undefined> {
  const document = await readBrewInfo(resource, runner);
  const item = brewItem(document, resource);
  const installed = item.installed;
  if (typeof installed === "string") return installed;
  if (Array.isArray(installed)) {
    const value = installed[0];
    if (typeof value === "string") return value;
    if (typeof value === "object" && value !== null && "version" in value) {
      return typeof value.version === "string" ? value.version : undefined;
    }
  }
  return undefined;
}

/** Read the current Homebrew version, including a formula's packaging revision. */
export async function readAvailableBrewVersion(
  resource: ResolvedPackageResource,
  runner: Runner,
): Promise<string> {
  const item = brewItem(await readBrewInfo(resource, runner), resource);
  const baseVersion =
    resource.manager === "brew-cask"
      ? item.version
      : typeof item.versions === "object" && item.versions !== null && "stable" in item.versions
        ? item.versions.stable
        : undefined;
  const version =
    resource.manager === "brew" &&
    typeof baseVersion === "string" &&
    typeof item.revision === "number" &&
    item.revision > 0
      ? `${baseVersion}_${item.revision}`
      : baseVersion;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`Homebrew did not report an available version for ${resource.name}`);
  }
  return version;
}

/** Query Homebrew JSON metadata and reject command or malformed-response failures. */
async function readBrewInfo(
  resource: ResolvedPackageResource,
  runner: Runner,
): Promise<Record<string, unknown>> {
  const flag = resource.manager === "brew-cask" ? "--cask" : "--formula";
  const result = await requireSuccess(runner, "brew", ["info", "--json=v2", flag, resource.name]);
  try {
    const value: unknown = JSON.parse(result.stdout);
    if (!isRecord(value)) throw new Error("Expected a JSON object");
    return value;
  } catch (error) {
    throw new Error(`Homebrew returned invalid JSON for ${resource.name}`, { cause: error });
  }
}

/** Select the formula or cask record from a Homebrew response. */
function brewItem(
  document: Record<string, unknown>,
  resource: ResolvedPackageResource,
): Record<string, unknown> {
  const collection = document[resource.manager === "brew-cask" ? "casks" : "formulae"];
  const value = Array.isArray(collection) ? collection[0] : undefined;
  if (!isRecord(value)) {
    throw new Error(`Homebrew did not report information for ${resource.name}`);
  }
  return value;
}

/** Narrow an unknown value to a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
