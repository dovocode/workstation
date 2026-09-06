import { spawn } from "node:child_process";
import type { CommandResult, Runner, RunOptions } from "../api/types.js";

/** Run child processes directly, inheriting stdin and capturing stdout/stderr. No implicit shell is used. */
export class ProcessRunner implements Runner {
  /** Opt into command progress and streaming; verbose also prints captured query output. */
  constructor(private readonly logging: { readonly progress?: boolean; readonly verbose?: boolean } = {}) {}

  /** Print resource progress only when logging is enabled. */
  report(message: string): void {
    if (this.logging.progress || this.logging.verbose) process.stderr.write(`  ${message}\n`);
  }

  /** Execute a command directly and return captured output and its exit code; spawn failures reject. */
  async run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<CommandResult> {
    const started = Date.now();
    if (this.logging.progress || this.logging.verbose) {
      process.stderr.write(`  $ ${[command, ...args].map((value) => /^[\w./:@=+-]+$/.test(value) ? value : JSON.stringify(value)).join(" ")}${options?.cwd ? ` (in ${options.cwd})` : ""}\n`);
    }
    const stream = this.logging.verbose || (this.logging.progress && options?.streamOutput);
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
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        if (stream) process.stdout.write(chunk);
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
        if (stream || this.logging.progress) process.stderr.write(chunk);
      });
      child.once("error", reject);
      child.once("close", (exitCode) => {
        if (this.logging.progress || this.logging.verbose) {
          process.stderr.write(`  -> exit ${exitCode ?? 1} (${((Date.now() - started) / 1000).toFixed(1)}s)\n`);
        }
        resolve({ exitCode: exitCode ?? 1, stdout, stderr });
      });
    });
  }
}
