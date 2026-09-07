import { lstat, mkdir, mkdtemp, readlink, rename, rmdir, stat, symlink, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { SymlinkResource } from "../api/types.js";
import { isMissingFile, type Inspection } from "./shared.js";

/** Compare the source path and verify that a matching link actually resolves. */
export async function inspectSymlink(resource: SymlinkResource): Promise<Inspection> {
  try {
    const stats = await lstat(resource.target);
    if (!stats.isSymbolicLink()) {
      return {
        present: true,
        matches: false,
        conflict: `${resource.target} exists and is not a symbolic link`,
      };
    }
    const target = await readlink(resource.target);
    const actual = resolve(dirname(resource.target), target);
    const matches = actual === resource.source && await stat(resource.target).then(
      () => true,
      (error: unknown) => {
        if (isMissingFile(error)) return false;
        throw error;
      },
    );
    return {
      present: true,
      matches,
    };
  } catch (error) {
    if (isMissingFile(error)) return { present: false, matches: false };
    throw error;
  }
}

/** Create missing links or atomically replace different links, preserving non-link targets. */
export async function installSymlink(resource: SymlinkResource): Promise<void> {
  const inspection = await inspectSymlink(resource);
  if (inspection.conflict) throw new Error(inspection.conflict);
  if (inspection.matches) return;
  await lstat(resource.source).catch((error: unknown) => {
    if (isMissingFile(error)) throw new Error(`Symlink source does not exist: ${resource.source}`);
    throw error;
  });
  await mkdir(dirname(resource.target), { recursive: true });
  if (!inspection.present) {
    await symlink(resource.source, resource.target);
    return;
  }
  const temporary = await mkdtemp(join(dirname(resource.target), ".workstation-symlink-"));
  const replacement = join(temporary, "link");
  try {
    await symlink(resource.source, replacement);
    const current = await inspectSymlink(resource);
    if (current.conflict) throw new Error(current.conflict);
    await rename(replacement, resource.target);
  } finally {
    await unlink(replacement).catch((error: unknown) => {
      if (!isMissingFile(error)) throw error;
    });
    await rmdir(temporary);
  }
}

/** Unlink a managed symlink only when its destination still matches. */
export async function removeSymlink(resource: SymlinkResource): Promise<void> {
  const inspection = await inspectSymlink(resource);
  if (!inspection.present) return;
  if (!inspection.matches) {
    throw new Error(`Refusing to remove changed symlink: ${inspection.conflict ?? resource.target}`);
  }
  await unlink(resource.target);
}
