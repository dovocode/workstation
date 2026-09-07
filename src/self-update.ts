import { chmod, rename, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import packageMetadata from "../package.json" with { type: "json" };
import type { Runner } from "./api/types.js";

const RELEASES_URL = "https://api.github.com/repos/dovocode/workstation/releases/latest";

interface LatestRelease {
  readonly tag_name?: unknown;
  readonly assets?: readonly { readonly name?: unknown; readonly browser_download_url?: unknown }[];
}

/** Update the current native executable, or the globally installed npm CLI. */
export async function selfUpdate(runner: Runner): Promise<void> {
  if (!isNativeExecutable()) {
    console.log("Updating the JavaScript CLI with npm...");
    await requireSuccess(runner, "npm", ["install", "--global", "@dovocode/workstation@latest"]);
    console.log("Workstation was updated through npm.");
    return;
  }

  const release = await fetchLatestRelease();
  const latest = requireString(release.tag_name, "latest release tag").replace(/^v/, "");
  if (latest === packageMetadata.version) {
    console.log(`Workstation ${packageMetadata.version} is already the latest version.`);
    return;
  }

  const assetName = nativeAssetName(process.platform, process.arch);
  const asset = release.assets?.find((candidate) => candidate.name === assetName);
  const downloadUrl = requireString(asset?.browser_download_url, `download URL for ${assetName}`);
  console.log(`Updating Workstation ${packageMetadata.version} to ${latest}...`);
  const response = await fetch(downloadUrl, { headers: { "User-Agent": "dovocode-workstation" } });
  if (!response.ok) throw new Error(`Could not download ${assetName}: HTTP ${response.status}`);

  const temporary = `${process.execPath}.update-${process.pid}`;
  try {
    await writeFile(temporary, new Uint8Array(await response.arrayBuffer()), { mode: 0o755 });
    await chmod(temporary, 0o755);
    await requireSuccess(runner, temporary, ["--help"], false);
    await rename(temporary, process.execPath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  console.log(`Workstation was updated to ${latest}.`);
}

/** Distinguish a Node SEA from a JavaScript CLI without relying on node:sea inside the embedded runtime. */
export function isNativeExecutable(argv1 = process.argv[1], execPath = process.execPath): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(execPath);
  } catch {
    return argv1 === execPath;
  }
}

/** Map Node platform names and architectures to published release asset names. */
export function nativeAssetName(platform: NodeJS.Platform, arch: string): string {
  if (platform !== "darwin" && platform !== "linux") throw new Error(`Self-update is unsupported on ${platform}`);
  const releaseArch = arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : undefined;
  if (!releaseArch) throw new Error(`Self-update is unsupported on ${arch}`);
  return `workstation-${platform}-${releaseArch}`;
}

/** Fetch and minimally validate GitHub's latest-release response. */
async function fetchLatestRelease(): Promise<LatestRelease> {
  const response = await fetch(RELEASES_URL, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "dovocode-workstation" },
  });
  if (!response.ok) throw new Error(`Could not check for updates: HTTP ${response.status}`);
  return await response.json() as LatestRelease;
}

/** Require a non-empty string from the remote release document. */
function requireString(value: unknown, description: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`GitHub did not provide the ${description}`);
  return value;
}

/** Run an update command and retain its useful failure output. */
async function requireSuccess(runner: Runner, command: string, args: readonly string[], streamOutput = true): Promise<void> {
  const result = await runner.run(command, args, { streamOutput });
  if (result.exitCode !== 0) {
    throw new Error(`Update command failed (${result.exitCode})${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
  }
}
