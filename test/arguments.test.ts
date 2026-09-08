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

it("parses upgrade selections and flags in either position", () => {
  expect(parseArguments(["--config", "/tmp/config.ts", "upgrade", "package:mise:node", "--no-remove", "package:brew:jq", "--machine", "laptop", "-v"], display)).toMatchObject({
    upgrade: true, upgradeIds: ["package:mise:node", "package:brew:jq"],
    config: "/tmp/config.ts", machine: "laptop", noRemove: true, verbose: true,
  });
});

it.each([
  ["upgrade", "--frozen-lockfile"], ["upgrade", "build"], ["plan", "upgrade"],
  ["upgrade", "init"], ["update", "upgrade"], ["upgrade", "--list-tasks"],
  ["upgrade", "hello"], ["upgrade", "--invalid"], ["upgrade", "upgrade"],
])("rejects incompatible upgrade invocation %j", (...args) => {
  expect(() => parseArguments(args, display)).toThrow();
});
