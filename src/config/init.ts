import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const starter = `import type { ConfigDefinition } from "@dovocode/workstation";

export default {
  // Add shared tools, files, shell configuration, and services here.
  resources: [],

  // Keys match the short hostname, or the --machine override.
  machines: {
    // studio: [],
    // macbook: [],
  },

  // Run with: workstation hello (or workstation hi).
  tasks: {
    hello: { command: "echo", args: ["Hello from workstation!"] },
  },
  aliases: { hi: "hello" },
} satisfies ConfigDefinition;
`;

/** Create a starter entry point exclusively; never load a setup or replace an existing file or symlink. */
export async function initConfig(path = "workstation.config.ts"): Promise<string> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(target, starter, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(`Configuration already exists: ${target}. No changes made.`, { cause: error });
    }
    throw error;
  }
  return target;
}
