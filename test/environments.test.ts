import { expect, it } from "vitest";
import { docker, sbx, microsandbox, createWorkstation } from "../src/index.js";

it("builds nested workstation invocations consistently across runtimes", () => {
  for (const [runtime, prefix] of [[docker, ["exec", "dev"]], [sbx, ["exec", "dev"]], [microsandbox, ["exec", "dev", "--"]]] as const) {
    const nested = runtime.workstation("dev", { config: "/workspace/my config.ts", machine: "guest", frozen: true, noRemove: true }, { cwd: "/host/project" });
    expect(nested.args).toEqual([...prefix, "workstation", "build", "--config", "/workspace/my config.ts", "--machine", "guest", "--frozen-lockfile", "--no-remove"]);
    expect(nested.cwd).toBe("/host/project");
    expect(runtime.workstation("dev", { config: "/guest/$(literal).ts", plan: true, executable: "/opt/workstation" }).args).toEqual([...prefix, "/opt/workstation", "plan", "--config", "/guest/$(literal).ts"]);
    expect(() => runtime.workstation("dev", { config: "--help" })).toThrow("Invalid");
    expect(() => runtime.workstation("--all", { config: "/guest/config.ts" })).toThrow("Invalid");
  }
});

it("dispatches nested builds from codebase usage and returns guest failures", async () => {
  const client = createWorkstation({ config: { tasks: { setup: sbx.workstation("dev", { config: "/workspace/guest.ts" }) } }, runner: { async run(command, args) {
    expect(command).toBe("sbx");
    expect(args).toEqual(["exec", "dev", "workstation", "build", "--config", "/workspace/guest.ts"]);
    return { exitCode: 7, stdout: "", stderr: "guest build failed" };
  } } });
  expect((await client.task("setup")).exitCode).toBe(7);
});

it("constructs explicit runtime operations without shell interpolation or implicit destructive flags", () => {
  expect(docker.run("dev", "alpine:3.22", ["echo", "$(literal)"], { removeOnExit: true }).args).toEqual(["run", "--name", "dev", "--rm", "alpine:3.22", "echo", "$(literal)"]);
  expect(docker.compose("dev", "compose.yaml", "down").args).toEqual(["compose", "--project-name", "dev", "--file", "compose.yaml", "down"]);
  expect(sbx.create("dev", "claude", ".").args).toEqual(["create", "--name", "dev", "claude", "."]);
  expect(microsandbox.exec("dev", ["python", "-c", "print('hi')"]).args).toEqual(["exec", "dev", "--", "python", "-c", "print('hi')"]);
  expect(() => docker.remove("--all")).toThrow("Invalid");
  expect(() => sbx.create("dev", "--help", ".")).toThrow("Invalid");
});

it("runs sandbox tasks through the embedded client and preserves exit status", async () => {
  const client = createWorkstation({ config: { tasks: { sandbox: microsandbox.create("dev", "python:3.12") } }, runner: { async run(command, args) {
    expect(command).toBe("msb");
    expect(args).toEqual(["create", "--name", "dev", "python:3.12"]);
    return { exitCode: 9, stdout: "", stderr: "runtime unavailable" };
  } } });
  expect((await client.task("sandbox")).exitCode).toBe(9);
});
