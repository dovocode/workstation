import type { SystemdServiceResource } from "../api/types.js";

/** Render unit, service, and install sections with scope-appropriate defaults. */
export function renderSystemdService(resource: SystemdServiceResource): string {
  const description = resource.description ?? resource.name;
  const restart = resource.restart ?? "on-failure";
  const wantedBy = resource.wantedBy ?? (resource.scope === "user" ? "default.target" : "multi-user.target");
  if (description.includes("\n") || description.includes("\r")) {
    throw new Error("systemd descriptions cannot contain newlines");
  }
  if (!/^[A-Za-z0-9_.@-]+\.(?:target|service)$/.test(wantedBy)) {
    throw new Error(`Invalid systemd WantedBy unit: ${wantedBy}`);
  }
  const environment = Object.entries(resource.environment ?? {}).map(
    ([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`Invalid systemd environment variable: ${key}`);
      }
      return `Environment=${quote(`${key}=${value}`)}`;
    },
  );
  return [
    "[Unit]",
    `Description=${description}`,
    "",
    "[Service]",
    `ExecStart=${[resource.program, ...(resource.args ?? [])].map(quote).join(" ")}`,
    ...environment,
    `Restart=${restart}`,
    "",
    "[Install]",
    `WantedBy=${wantedBy}`,
    "",
  ].join("\n");
}

/** Quote a literal according to the target renderer's escaping rules. */
function quote(value: string): string {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t")}"`;
}
