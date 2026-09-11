import type { ResolvedResource, Runner } from "../api/types.js";
import { resourceId } from "../config/identity.js";
import { requireSuccess } from "./shared.js";

/** Refresh APT and Homebrew metadata once per selected backend before upgrade pin resolution. */
export async function refreshPackageMetadata(
  resources: readonly ResolvedResource[],
  selection: true | readonly string[],
  runner: Runner,
): Promise<void> {
  const selected = selection === true ? undefined : new Set(selection);
  const managers = new Set(resources.flatMap(resource =>
    resource.kind === "package" && (!selected || selected.has(resourceId(resource))) ? [resource.manager] : []));
  if (managers.has("apt")) {
    await requireSuccess(runner, "sudo", ["apt-get", "update", "-o", "APT::Update::Error-Mode=any"], { streamOutput: true });
  }
  if (managers.has("brew") || managers.has("brew-cask")) {
    await requireSuccess(runner, "brew", ["update"], { streamOutput: true });
  }
}
