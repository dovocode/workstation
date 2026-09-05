import { spawn } from "node:child_process";
import type { CommandResult, Runner, RunOptions } from "../api/types.js";

/** Run child processes directly, inheriting stdin and capturing stdout/stderr. No implicit shell is used. */
export class ProcessRunner implements Runner {
  /** Execute a command directly and return captured output and its exit code; spawn failures reject. */
  async run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<CommandResult> {
    return await new Promise((resolve, reject) => {
      const child = spawn(command, [...args], {
        cwd: options?.cwd,
        env: { ...process.env, ...options?.environment },
        stdio: ["inherit", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => (stdout += chunk));
      child.stderr.on("data", (chunk: string) => (stderr += chunk));
      child.once("error", reject);
      child.once("close", (exitCode) =>
        resolve({ exitCode: exitCode ?? 1, stdout, stderr }),
      );
    });
  }
}
