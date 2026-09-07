import { expect, it } from "vitest";
import { parseArguments } from "../src/cli/arguments.js";
import { commands, isBuiltinCommand, commandHelp } from "../src/commands.js";
import { resolveTasks } from "../src/config/tasks.js";

const display = { help: (): never => { throw new Error("help displayed"); }, version: (): never => { throw new Error("version displayed"); } };

it("parses build controls, preserves task arguments and rejects incompatible commands", () => {
  expect(parseArguments(["build", "--config", "/tmp/example.ts", "--no-remove"], display)).toMatchObject({ build: true, noRemove: true, config: "/tmp/example.ts" });
  expect(parseArguments(["test", "--", "$(literal)", "--help"], display)).toMatchObject({ task: "test", taskArgs: ["$(literal)", "--help"] });
  expect(() => parseArguments(["build", "plan"], display)).toThrow("another command");
  expect(() => parseArguments(["--help"], display)).toThrow("help displayed");
});

it("keeps help and reserved task names aligned with the command registry", () => {
  const context = { home: "/tmp", configDir: "/tmp", machine: "test", hostname: "test", platform: "linux" } as const;
  for (const [name, command] of Object.entries(commands)) {
    expect(isBuiltinCommand(name)).toBe(true);
    expect(commandHelp()).toContain(command.usage);
    expect(() => resolveTasks({ tasks: { [name]: { command: "echo" } } }, context)).toThrow("reserved");
  }
  expect(isBuiltinCommand("toString")).toBe(false);
});
