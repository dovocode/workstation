import { lstat, mkdir, readlink, symlink, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { SymlinkResource } from "../api/types.js";
import { isMissingFile, type Inspection } from "./shared.js";

/** Compare a destination's symlink target with the resolved source without following the link. */
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
    const matches = actual === resource.source;
    return {
      present: true,
      matches,
      ...(matches ? {} : { conflict: `${resource.target} points to ${actual}` }),
    };
  } catch (error) {
    if (isMissingFile(error)) return { present: false, matches: false };
    throw error;
  }
}

/** Create parent directories and a missing link after checking the source and conflicts. */
export async function installSymlink(resource: SymlinkResource): Promise<void> {
  const inspection = await inspectSymlink(resource);
  if (inspection.conflict) throw new Error(inspection.conflict);
  if (inspection.matches) return;
  await lstat(resource.source).catch((error: unknown) => {
    if (isMissingFile(error)) throw new Error(`Symlink source does not exist: ${resource.source}`);
    throw error;
  });
  await mkdir(dirname(resource.target), { recursive: true });
  await symlink(resource.source, resource.target);
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
