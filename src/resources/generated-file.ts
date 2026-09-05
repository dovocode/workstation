import { lstat, mkdir, readFile, readlink, rename, symlink, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { renderGeneratedFile } from "../rendering/structured-file.js";
import type { GeneratedFileResource, OriginalFile, ResolvedResource } from "../api/types.js";
import { atomicWrite, isMissingFile, type Inspection } from "./shared.js";

/** Compare rendered content and permissions while respecting the existing-file policy. */
export async function inspectGeneratedFile(resource: GeneratedFileResource): Promise<Inspection> {
  try {
    const stats = await lstat(resource.target);
    if (!stats.isFile()) {
      if (resource.ifExists === "ignore") return { present: true, matches: true };
      if (resource.ifExists === "overwrite" && stats.isSymbolicLink()) {
        return { present: true, matches: false };
      }
      return { present: true, matches: false, conflict: `${resource.target} is not a regular file` };
    }
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
    if (isMissingFile(error)) return { present: false, matches: false };
    throw error;
  }
}

/** Write generated content atomically, rejecting conflicts not permitted by ownership or policy. */
export async function installGeneratedFile(resource: GeneratedFileResource, managed = false): Promise<void> {
  const inspection = await inspectGeneratedFile(resource);
  if (inspection.matches) return;
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
  if (originalFile) {
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
        return;
      }
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }
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
