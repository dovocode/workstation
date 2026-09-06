import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, resolve } from "node:path";

/** Detect the distro package manager on PATH, preferring APT, DNF, YUM, then pacman. */
export async function detectLinuxManager(searchPath = process.env.PATH ?? ""): Promise<"apt" | "dnf" | "yum" | "pacman"> {
  for (const [manager, command] of [["apt", "apt-get"], ["dnf", "dnf"], ["yum", "yum"], ["pacman", "pacman"]] as const) {
    for (const directory of searchPath.split(delimiter).filter(Boolean)) {
      const path = resolve(directory, command);
      try {
        await access(path, constants.X_OK);
        if ((await stat(path)).isFile()) return manager;
      } catch (error) {
        if (!(error instanceof Error && "code" in error &&
          ["ENOENT", "ENOTDIR", "EACCES"].includes(String(error.code)))) throw error;
      }
    }
  }
  throw new Error("No supported Linux package manager found on PATH (apt-get, dnf, yum, pacman). Install one or set managers.linux explicitly.");
}
