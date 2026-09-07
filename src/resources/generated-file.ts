import type { Stats } from "node:fs";
import { lstat, mkdir, readFile, readlink, rename, symlink, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { renderGeneratedFile } from "../rendering/structured-file.js";
import type { GeneratedFileResource, OriginalFile, ResolvedResource } from "../api/types.js";
import { atomicWrite, isMissingFile, type Inspection } from "./shared.js";
import { injectContent, injectionRange } from "./injection.js";
import { mergeDotenv, restoreDotenv } from "../rendering/dotenv.js";

/** Compare rendered content and permissions while respecting the existing-file policy. */
export async function inspectGeneratedFile(resource: GeneratedFileResource): Promise<Inspection> {
  try {
    const stats = await lstat(resource.target);
    if (resource.ifExists === "merge") { return await inspectDotenvFile(resource, stats); }
    if (resource.ifExists === "inject") { return await inspectInjectedFile(resource, stats); }
    if (!stats.isFile()) return inspectNonFile(resource, stats);
    const matches =
      (await readFile(resource.target, "utf8")) === renderGeneratedFile(resource) &&
      (stats.mode & 0o777) === (resource.mode ?? 0o644);
    if (matches || resource.ifExists === "ignore") return { present: true, matches: true };
    return {
      present: true,
      matches: false,
      ...(resource.ifExists === "update"
        ? { conflict: `${resource.target} exists with different content` }
        : {}),
    };
  } catch (error) {
    if (isMissingFile(error) && resource.ifExists !== "inject") return { present: false, matches: false };
    throw error;
  }
}

/** Write generated content atomically, rejecting conflicts not permitted by ownership or policy. */
export async function installGeneratedFile(resource: GeneratedFileResource, managed = false): Promise<void> {
  const inspection = await inspectGeneratedFile(resource);
  if (inspection.matches) return;
  if (resource.ifExists === "merge") { return installDotenvFile(resource, inspection); }
  if (resource.ifExists === "inject") { return installInjectedFile(resource); }
  if (inspection.conflict && !managed) throw new Error(inspection.conflict);
  if (inspection.present && managed) {
    const stats = await lstat(resource.target);
    if (!stats.isFile()) throw new Error(`Refusing to replace changed managed file: ${resource.target}`);
  }
  await mkdir(dirname(resource.target), { recursive: true });
  await atomicWrite(resource.target, renderGeneratedFile(resource), resource.mode ?? 0o644);
}

/** Remove unchanged managed content or restore the saved original file or symlink. */
export async function removeGeneratedFile(
  resource: GeneratedFileResource,
  originalFile?: OriginalFile,
): Promise<void> {
  if (resource.ifExists === "merge") { return restoreDotenvFile(resource, originalFile); }
  if (resource.ifExists === "inject") { return restoreInjectedFile(resource, originalFile); }
  if (originalFile && await originalAlreadyRestored(resource, originalFile)) return;
  const inspection = await inspectGeneratedFile({ ...resource, ifExists: "update" });
  if (inspection.present && !inspection.matches) {
    throw new Error(`Refusing to remove changed generated file: ${resource.target}`);
  }
  if (originalFile) {
    if (originalFile.kind === "file") {
      await atomicWrite(resource.target, originalFile.content, originalFile.mode);
    } else {
      const temporary = `${resource.target}.${process.pid}.tmp`;
      await unlink(temporary).catch((error: unknown) => {
        if (!isMissingFile(error)) throw error;
      });
      try {
        await symlink(originalFile.target, temporary);
        await rename(temporary, resource.target);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    }
  } else if (inspection.present) {
    await unlink(resource.target);
  }
}

/** Capture original bytes and permissions or a symlink target before generated-file replacement. */
export async function backupResource(resource: ResolvedResource): Promise<OriginalFile | undefined> {
  if (resource.kind !== "generated-file") return undefined;
  try {
    const stats = await lstat(resource.target);
    if (stats.isSymbolicLink()) {
      return { kind: "symlink", target: await readlink(resource.target) };
    }
    if (!stats.isFile()) throw new Error(`Cannot back up non-file target: ${resource.target}`);
    return {
      kind: "file",
      content: await readFile(resource.target, "utf8"),
      mode: stats.mode & 0o777,
    };
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

/** inspect the merge policy without affecting unowned content. */
async function inspectDotenvFile(resource: GeneratedFileResource, stats: Stats): Promise<Inspection> {
  if (resource.format !== "dotenv" || !stats.isFile()) throw new Error(`Dotenv merge requires a regular file: ${resource.target}`);
  const text = await readFile(resource.target, "utf8");
  return { present: true, matches: text === mergeDotenv(text, resource.value) && (stats.mode & 0o777) === (resource.mode ?? 0o600) };
}

/** inspect the inject policy without affecting unowned content. */
async function inspectInjectedFile(resource: GeneratedFileResource, stats: Stats): Promise<Inspection> {
  if (!stats.isFile()) throw new Error(`Injection requires a regular file: ${resource.target}`);
  const text = await readFile(resource.target, "utf8");
  return {
    present: true, matches: text === injectContent(text, resource) &&
      (resource.mode === undefined || (stats.mode & 0o777) === resource.mode)
  };
}

/** install the merge policy without affecting unowned content. */
async function installDotenvFile(resource: GeneratedFileResource, inspection: Inspection): Promise<void> {
  if (resource.format !== "dotenv") throw new Error("Merge is only supported for dotenv");
  const text = inspection.present ? await readFile(resource.target, "utf8") : "";
  await mkdir(dirname(resource.target), { recursive: true });
  await atomicWrite(resource.target, mergeDotenv(text, resource.value), resource.mode ?? 0o600);
  return;
}

/** install the inject policy without affecting unowned content. */
async function installInjectedFile(resource: GeneratedFileResource): Promise<void> {
  const stats = await lstat(resource.target);
  if (!stats.isFile()) throw new Error(`Injection requires a regular file: ${resource.target}`);
  await atomicWrite(resource.target, injectContent(await readFile(resource.target, "utf8"), resource), resource.mode ?? (stats.mode & 0o777));
  return;
}

/** restore the merge policy without affecting unowned content. */
async function restoreDotenvFile(resource: GeneratedFileResource, originalFile?: OriginalFile): Promise<void> {
  const inspection = await inspectGeneratedFile(resource);
  if (!inspection.present) return;
  if (!inspection.matches) throw new Error(`Refusing to restore changed dotenv keys: ${resource.target}`);
  if (originalFile && originalFile.kind !== "file") throw new Error("Dotenv original is not a regular file");
  const text = restoreDotenv(await readFile(resource.target, "utf8"), originalFile?.content ?? "", resource.value);
  await atomicWrite(resource.target, text, (await lstat(resource.target)).mode & 0o777);
  return;
}

/** restore the inject policy without affecting unowned content. */
async function restoreInjectedFile(resource: GeneratedFileResource, originalFile?: OriginalFile): Promise<void> {
  const inspection = await inspectGeneratedFile(resource);
  if (!inspection.matches) throw new Error(`Refusing to remove changed injection: ${resource.target}`);
  if (!originalFile || originalFile.kind !== "file") throw new Error(`Missing original injection backup: ${resource.target}`);
  const [start, end] = injectionRange(originalFile.content, resource);
  const text = await readFile(resource.target, "utf8");
  const stats = await lstat(resource.target);
  await atomicWrite(resource.target, injectContent(text, resource, originalFile.content.slice(start, end)), stats.mode & 0o777);
  return;
}

/** Apply conflict policy to directories and symlinks without reading their contents. */
function inspectNonFile(resource: GeneratedFileResource, stats: Stats): Inspection {

  if (resource.ifExists === "ignore") return { present: true, matches: true };
  if (resource.ifExists === "overwrite" && stats.isSymbolicLink()) {
    return { present: true, matches: false };
  }
  return { present: true, matches: false, conflict: `${resource.target} is not a regular file` };
}

/** Recognize an already restored backup without overwriting later user edits. */
async function originalAlreadyRestored(resource: GeneratedFileResource, originalFile: OriginalFile): Promise<boolean> {
  try {
    const stats = await lstat(resource.target);
    if (
      (originalFile.kind === "file" &&
        stats.isFile() &&
        (await readFile(resource.target, "utf8")) === originalFile.content) ||
      (originalFile.kind === "symlink" &&
        stats.isSymbolicLink() &&
        (await readlink(resource.target)) === originalFile.target)
    ) {
      return true;
    }
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  return false;
}
