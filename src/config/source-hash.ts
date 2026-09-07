import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { resolve } from "node:path";

/** Hash a source tree deterministically, including file contents and symlink targets. */
export async function hashSource(path: string): Promise<string> {
  const hash = createHash("sha256");
  await addPathToHash(hash, path, ".");
  return hash.digest("hex");
}

/** Visit one source entry and its sorted children, recording entry type and relative path. */
async function addPathToHash(
  hash: ReturnType<typeof createHash>,
  path: string,
  relativePath: string,
): Promise<void> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink()) {
    hash.update(`link\0${relativePath}\0${await readlink(path)}\0`);
    return;
  }
  if (stats.isFile()) {
    hash.update(`file\0${relativePath}\0`);
    hash.update(await readFile(path));
    return;
  }
  if (!stats.isDirectory()) throw new Error(`Unsupported custom tool source entry: ${path}`);
  hash.update(`directory\0${relativePath}\0`);
  const entries = (await readdir(path, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    await addPathToHash(hash, resolve(path, entry.name), `${relativePath}/${entry.name}`);
  }
}
