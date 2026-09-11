import { spawn } from "node:child_process";
import type { GeneratedFileResource } from "../api/types.js";
/** Parse candidate startup files before replacement. No startup code is executed. */
export async function validateShellContent(resource: GeneratedFileResource, content: string): Promise<void> {
  if (!["sh", "bash", "zsh"].includes(resource.format)) return;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(resource.format, ["-f", "-n"], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`Invalid ${resource.format} file ${resource.target}: ${stderr.trim()}`)));
    child.stdin.end(content);
  });
}
