import { runCli } from "./cli/run.js";

runCli(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`workstation: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
