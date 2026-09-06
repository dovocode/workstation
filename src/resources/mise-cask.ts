import { lstat, mkdtemp, readFile, readdir, realpath, rename, readlink, symlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parse } from "smol-toml";
import type { ResolvedPackageResource, Runner } from "../api/types.js";
import { isMissingFile, requireSuccess } from "./shared.js";
import { readInstalledBrewVersion } from "./brew-info.js";

export interface MiseCask {
  readonly path: string;
  readonly version: string;
  readonly apps: readonly string[];
  readonly fonts: readonly string[];
  readonly links: readonly { readonly path: string; readonly target: string }[];
}

/** Recognize one app/font/binary mise cask installation without trusting arbitrary receipt paths. */
export async function inspectMiseCask(resource: ResolvedPackageResource, runner: Runner): Promise<MiseCask | undefined> {
  const result = await requireSuccess(runner, "brew", ["--caskroom", resource.name]);
  const path = result.stdout.trim();
  if (!isAbsolute(path) || basename(path) !== resource.name.split("/").at(-1) || dirname(path) === path) {
    throw new Error(`Homebrew returned an invalid cask directory for ${resource.name}`);
  }
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return undefined;
    const entries = await readdir(path, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0]?.isDirectory()) return undefined;
    const version = entries[0].name;
    const receiptPath = join(path, version, ".mise-cask.toml");
    if (!(await lstat(receiptPath)).isFile()) return undefined;
    const receipt = parse(await readFile(receiptPath, "utf8"));
    if (receipt.schema_version !== 3 || receipt.version !== version ||
      !Array.isArray(receipt.apps) || !Array.isArray(receipt.fonts) || !Array.isArray(receipt.binaries) ||
      receipt.apps.length + receipt.fonts.length + receipt.binaries.length === 0 ||
      !["flight_directories", "generic", "pkg_ids"].every((key) =>
        Array.isArray(receipt[key]) && receipt[key].length === 0)) return undefined;
    const apps: string[] = [];
    for (const app of receipt.apps) {
      if (typeof app !== "string" || !isAbsolute(app) || !app.endsWith(".app") || resolve(app) !== app) return undefined;
      // The receipt must point to a real app outside Caskroom through a matching staging symlink.
      const staged = join(path, version, basename(app));
      if (!(await lstat(staged)).isSymbolicLink() || await realpath(staged) !== await realpath(app) ||
        !(await lstat(app)).isDirectory() || app.startsWith(`${dirname(path)}/`)) return undefined;
      apps.push(app);
    }
    const fonts: string[] = [];
    for (const font of receipt.fonts) {
      if (typeof font !== "string" || !isAbsolute(font) || resolve(font) !== font ||
        !/\.(ttf|otf|ttc|dfont)$/i.test(font) || !dirname(font).endsWith("/Library/Fonts") ||
        font.startsWith(`${dirname(path)}/`) || !(await lstat(font)).isFile()) return undefined;
      const staged = join(path, version, basename(font));
      // mise copies font files instead of creating app-style staging symlinks.
      if (!(await lstat(staged)).isFile() ||
        !(await readFile(staged)).equals(await readFile(font))) return undefined;
      fonts.push(font);
    }
    const links: Array<{ path: string; target: string }> = [];
    const linkRoots = [await realpath(join(path, version)), ...await Promise.all(apps.map((app) => realpath(app)))];
    if (!Array.isArray(receipt.completions)) return undefined;
    for (const completion of [...receipt.binaries, ...receipt.completions]) {
      if (typeof completion !== "string" || !isAbsolute(completion) ||
        resolve(completion) !== completion || completion.startsWith(`${path}/`) ||
        !(await lstat(completion)).isSymbolicLink()) return undefined;
      const target = await readlink(completion);
      const destination = await realpath(completion);
      if (!resolve(dirname(completion), target).startsWith(`${path}/${version}/`) ||
        !linkRoots.some((root) => destination.startsWith(`${root}/`))) return undefined;
      links.push({ path: completion, target });
    }
    return { path, version, apps: [...new Set(apps)], fonts: [...new Set(fonts)], links };
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

/** Back up mise staging and app/font artifacts, then let Homebrew create its own receipt. */
export async function migrateMiseCask(
  resource: ResolvedPackageResource,
  mise: MiseCask,
  runner: Runner,
): Promise<void> {
  // Keep backups outside Caskroom: Homebrew treats every child directory as a cask.
  const backup = await mkdtemp(join(dirname(dirname(mise.path)), `.workstation-mise-${basename(mise.path)}-`));
  runner.report?.(`Migrating ${resource.name} from mise to Homebrew; backups: ${backup}`);
  // ditto preserves macOS bundle metadata and extended attributes; plain recursive copies do not.
  for (const [index, app] of mise.apps.entries()) {
    await requireSuccess(runner, "/usr/bin/ditto", [app, join(backup, `app-${index}.app`)], { streamOutput: true });
  }
  for (const [index, font] of mise.fonts.entries()) {
    await requireSuccess(runner, "/usr/bin/ditto", [font, join(backup, `font-${index}`)], { streamOutput: true });
  }
  await rename(mise.path, join(backup, "original-cask"));
  try {
    await requireSuccess(runner, "brew", ["install", "--cask",
      resource.lockedVersion === mise.version ? "--adopt" : "--force", resource.name], {
      streamOutput: true,
      environment: { HOMEBREW_NO_AUTO_UPDATE: "1" },
    });
    const installed = await readInstalledBrewVersion(resource, runner);
    if (!installed || (resource.lockedVersion !== undefined && installed !== resource.lockedVersion)) {
      throw new Error(`Homebrew migration expected ${resource.lockedVersion ?? "an installed version"}; reported ${installed ?? "no installed version"}`);
    }
  } catch (error) {
    try {
      try {
        await rename(mise.path, join(backup, "failed-cask"));
      } catch (moveError) {
        if (!isMissingFile(moveError)) throw moveError;
      }
      await rename(join(backup, "original-cask"), mise.path);
      for (const [index, link] of mise.links.entries()) {
        try {
          const stat = await lstat(link.path);
          if (stat.isSymbolicLink()) {
            const current = await readlink(link.path);
            // Homebrew may have relinked to its own staging layout before a later artifact failed.
            // Preserve that link in the backup, but never overwrite an unrelated redirection.
            const destination = resolve(dirname(link.path), current);
            if (current !== link.target && [mise.path, ...mise.apps].some((root) => destination.startsWith(`${root}/`))) {
              await rename(link.path, join(backup, `failed-link-${index}`));
              await symlink(link.target, link.path);
            }
          }
        } catch (linkError) {
          if (!isMissingFile(linkError)) throw linkError;
          await symlink(link.target, link.path);
        }
      }
      // Homebrew can remove an adopted app when another artifact fails. Restore missing apps.
      for (const [index, app] of mise.apps.entries()) {
        try {
          await lstat(app);
        } catch (appError) {
          if (!isMissingFile(appError)) throw appError;
          await requireSuccess(runner, "/usr/bin/ditto", [join(backup, `app-${index}.app`), app], { streamOutput: true });
        }
      }
      for (const [index, font] of mise.fonts.entries()) {
        try {
          await lstat(font);
        } catch (fontError) {
          if (!isMissingFile(fontError)) throw fontError;
          await requireSuccess(runner, "/usr/bin/ditto", [join(backup, `font-${index}`), font], { streamOutput: true });
        }
      }
    } catch (restoreError) {
      throw new AggregateError([error, restoreError], `Migration and recovery failed for ${resource.name}. Backups: ${backup}`, { cause: restoreError });
    }
    throw new Error(`Migration failed for ${resource.name}: ${error instanceof Error ? error.message : String(error)}. Mise staging restored; artifact backups: ${backup}`, { cause: error });
  }
  runner.report?.(`Migrated ${resource.name} from mise to Homebrew. Backups: ${backup}. Remove brew-cask:${resource.name} from your mise configuration; do not run mise uninstall for this cask.`);
}
