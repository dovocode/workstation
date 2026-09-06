import { readAvailableBrewVersion } from "./brew-info.js";
import { requireSuccess } from "./shared.js";
import type { ResolvedResource, Runner } from "../api/types.js";
import { resolveRpmVersion } from "./rpm.js";
import { resolvePacmanVersion } from "./pacman.js";
import { resolveFlatpakVersion } from "./flatpak.js";

/** Resolve package selectors; return no pin for non-packages and rolling latest casks. */
export async function resolvePackageVersion(
  resource: ResolvedResource,
  runner: Runner,
): Promise<string | undefined> {
  if (resource.kind !== "package") return undefined;
  switch (resource.manager) {
    case "mise": {
      const spec = `${resource.name}@${resource.version ?? "latest"}`;
      const result = await requireSuccess(runner, "mise", ["latest", spec]);
      const version = result.stdout.trim().split(/\s+/).at(-1);
      if (!version) throw new Error(`mise latest ${spec} did not report a version`);
      return version;
    }
    case "apt": {
      const result = await requireSuccess(runner, "apt-cache", ["policy", resource.name]);
      const candidate = /^\s*Candidate:\s*(\S+)\s*$/m.exec(result.stdout)?.[1];
      if (!candidate || candidate === "(none)") {
        throw new Error(`apt has no installation candidate for ${resource.name}`);
      }
      return candidate;
    }
    case "brew":
    case "brew-cask": {
      const version = await readAvailableBrewVersion(resource, runner);
      return version === "latest" ? undefined : version;
    }
    case "dnf":
    case "yum":
      return await resolveRpmVersion(resource, runner);
    case "system":
      throw new Error("System package manager must be resolved before locking");
    case "pacman":
      return await resolvePacmanVersion(resource, runner);
    case "flatpak":
      return await resolveFlatpakVersion(resource, runner);
    case "mas":
      return undefined;
  }
}
