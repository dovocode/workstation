import type { LaunchAgentResource } from "../api/types.js";

/** Serialize a LaunchAgent declaration as an XML property list without writing or loading it. */
export function renderLaunchAgent(resource: LaunchAgentResource): string {
  const args = resource.args ?? [];
  const environment = Object.entries(resource.environment ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${escapeXml(resource.label)}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    `    <string>${escapeXml(resource.program)}</string>`,
    ...args.map((argument) => `    <string>${escapeXml(argument)}</string>`),
    "  </array>",
  ];
  if (resource.runAtLoad ?? true) lines.push("  <key>RunAtLoad</key>", "  <true/>");
  if (resource.keepAlive ?? false) lines.push("  <key>KeepAlive</key>", "  <true/>");
  if (environment.length > 0) {
    lines.push("  <key>EnvironmentVariables</key>", "  <dict>");
    for (const [key, value] of environment) {
      lines.push(`    <key>${escapeXml(key)}</key>`, `    <string>${escapeXml(value)}</string>`);
    }
    lines.push("  </dict>");
  }
  if (resource.stdoutPath) {
    lines.push(
      "  <key>StandardOutPath</key>",
      `  <string>${escapeXml(resource.stdoutPath)}</string>`,
    );
  }
  if (resource.stderrPath) {
    lines.push(
      "  <key>StandardErrorPath</key>",
      `  <string>${escapeXml(resource.stderrPath)}</string>`,
    );
  }
  lines.push("</dict>", "</plist>", "");
  return lines.join("\n");
}

/** Escape XML metacharacters in property-list keys and values. */
function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
