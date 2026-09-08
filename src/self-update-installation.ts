import { realpath, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { Runner } from "./api/types.js";

const PACKAGE = "@dovocode/workstation";

export interface JavaScriptUpdate {
  readonly command: "npm" | "pnpm";
  readonly args: readonly string[];
  readonly location: string;
}

/** Resolve the running CLI to a proven global installation; never infer ownership from cwd. */
export async function resolveJavaScriptUpdate(runner: Runner, entry = process.argv[1]): Promise<JavaScriptUpdate> {
  if (!entry) throw new Error("Cannot locate the running Workstation CLI.");
  const cli = await realpath(entry);
  const packageRoot = dirname(dirname(cli));
  const metadata: unknown = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  if (!isRecord(metadata) || metadata.name !== PACKAGE || cli !== join(packageRoot, "dist", "cli.js")) {
    throw unsupportedInstallation(cli);
  }

  const npm = await resolveNpmUpdate(packageRoot, cli);
  if (npm) return npm;
  const pnpm = await resolvePnpmUpdate(runner, entry, cli);
  if (pnpm) return pnpm;
  throw unsupportedInstallation(cli);
}

/** Verify npm's global layout and bin link before selecting its explicit prefix. */
async function resolveNpmUpdate(packageRoot: string, cli: string): Promise<JavaScriptUpdate | undefined> {
  const modules = dirname(dirname(packageRoot));
  if (basename(modules) !== "node_modules" || basename(dirname(modules)) !== "lib") return;
  const prefix = dirname(dirname(modules));
  if (!await resolvesTo(join(prefix, "bin", "workstation"), cli)) return;
  return {
    command: "npm", args: ["install", "--global", "--prefix", prefix, `${PACKAGE}@latest`],
    location: packageRoot,
  };
}

/** Match pnpm's global inventory to both the invocation and its canonical package path. */
async function resolvePnpmUpdate(runner: Runner, entry: string, cli: string): Promise<JavaScriptUpdate | undefined> {
  if (!cli.split("/").includes("node_modules")) return;
  const result = await queryPnpm(runner);
  if (result === undefined) return;
  const installs: unknown = JSON.parse(result);
  if (!Array.isArray(installs)) throw new Error("pnpm returned an invalid global installation inventory.");
  for (const install of installs) {
    const candidate = pnpmCandidate(install);
    if (!candidate) continue;
    if (await belongsToInstallation(entry, candidate.project) && await resolvesTo(join(candidate.package, "dist", "cli.js"), cli)) {
      return { command: "pnpm", args: ["update", "--global", "--latest", PACKAGE], location: candidate.package };
    }
  }
}

/** Validate one inventory record and exclude linked or non-versioned dependencies. */
function pnpmCandidate(install: unknown): { readonly project: string; readonly package: string } | undefined {
  if (!isRecord(install) || typeof install.path !== "string" || !isAbsolute(install.path) || !isRecord(install.dependencies)) return;
  const dependency = install.dependencies[PACKAGE];
  if (!isRecord(dependency) || typeof dependency.path !== "string" ||
    !isAbsolute(dependency.path) || typeof dependency.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+]|$)/.test(dependency.version)) return;
  return { project: install.path, package: dependency.path };
}

/** Verify the invocation belongs to the global project, not a local link into the same store. */
async function belongsToInstallation(entry: string, installation: string): Promise<boolean> {
  const target = await realpath(installation);
  for (let directory = dirname(resolve(entry)); directory !== dirname(directory); directory = dirname(directory)) {
    if (await resolvesTo(directory, target)) return true;
  }
  return false;
}

/** Query the active pnpm installation, tolerating only an absent executable. */
async function queryPnpm(runner: Runner): Promise<string | undefined> {
  try {
    const result = await runner.run("pnpm", ["list", "--global", "--json"], { streamOutput: false });
    if (result.exitCode !== 0) throw new Error(`Cannot verify the pnpm global installation: ${result.stderr.trim() || result.stdout.trim() || "inventory query failed"}. No update was performed.`);
    return result.stdout;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Compare canonical paths while treating missing candidate installations as non-matches. */
async function resolvesTo(candidate: string, target: string): Promise<boolean> {
  try {
    return await realpath(candidate) === target;
  } catch (error) {
    if (isRecord(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) return false;
    throw error;
  }
}

/** Narrow external JSON and filesystem errors without trusting their structure. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Explain how to update an installation whose owning global manager cannot be verified. */
function unsupportedInstallation(cli: string): Error {
  return new Error(`Cannot safely self-update Workstation at ${cli}. No matching supported global installation was found. For a local dependency, update @dovocode/workstation in its project with that project's package manager. For a source checkout or linked install, update and rebuild the source. Otherwise use the package manager and environment that installed this CLI. No global package was installed.`);
}
