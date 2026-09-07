import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createWorkstation, files, type Context } from "../src/index.js";

it("supports inline config through the public entry point with isolated plan, build and status", async () => {
  const root = await mkdtemp(join(tmpdir(), "workstation-client-"));
  const context: Context = { home: root, configDir: root, machine: "test", hostname: "test", platform: "linux" };
  const actions: string[] = [];
  const client = createWorkstation({ configPath: join(root, "inline.ts"), context,
    config: { resources: [files.dotenv(".env", { PORT: "3000" })] },
    runner: { async run() { throw new Error("Unexpected process"); } },
    onAction: (action) => actions.push(action.type),
  });
  expect(await client.plan()).toHaveLength(1);
  await expect(readFile(join(root, ".env"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(join(root, "workstation.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  await client.build();
  expect(actions).toEqual(["create"]);
  expect(await readFile(join(root, ".env"), "utf8")).toBe("PORT='3000'\n");
  expect(await client.build({ frozen: true })).toEqual([]);
  expect(await client.status()).toMatchObject([{ status: "converged" }]);
});

it("loads a project's file and returns task results without exiting the host", async () => {
  const root = await mkdtemp(join(tmpdir(), "workstation-client-file-"));
  const path = join(root, "workstation.config.ts");
  await writeFile(path, 'export default { resources: [], tasks: { test: { command: "echo", args: ["literal"] } } };');
  const client = createWorkstation({ configPath: path, runner: { async run(command, args) {
    expect(command).toBe("echo");
    expect(args).toEqual(["literal", "$(untouched)"]);
    return { exitCode: 7, stdout: "result", stderr: "failure" };
  } } });
  expect(await client.task("test", ["$(untouched)"])).toEqual({ exitCode: 7, stdout: "result", stderr: "failure" });
});
