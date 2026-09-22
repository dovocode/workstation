import { task } from "./tasks.js";
import { nestedCommand, type EnvironmentTaskOptions, type NestedWorkstationOptions } from "./environments.js";
import type { TaskDefinition } from "./types.js";

/** Host-side Cua tooling; use executables from the same Python environment. */
export interface CuaTaskOptions extends EnvironmentTaskOptions {
  readonly cli?: string;
  /** Interpreter with cua-sandbox installed; defaults to python3. */
  readonly python?: string;
}

/** Local image launch settings delegated to Cua's supported runtime selection. */
export interface CuaCreateOptions extends CuaTaskOptions {
  /** Force a VM for Linux images, which otherwise default to a container. */
  readonly vm?: boolean;
  readonly cpus?: number;
  readonly memory?: string;
  readonly disk?: string;
}

/** Reject empty, flag-like, or control-containing CLI values. */
function value(text: string): string {
  if (!text || text.startsWith("-") || /[\0\r\n]/.test(text)) throw new Error("Invalid Cua value");
  return text;
}

/** Select exactly one local sandbox. */
function sandbox(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) throw new Error("Invalid Cua sandbox name");
  return name;
}

/** Keep runtime settings separate from the host task's execution options. */
function hostOptions(options: CuaTaskOptions): EnvironmentTaskOptions {
  return { ...(options.cwd === undefined ? {} : { cwd: options.cwd }), ...(options.environment === undefined ? {} : { environment: options.environment }), ...(options.description === undefined ? {} : { description: options.description }) };
}

/** Construct a Cua CLI invocation with explicit local targeting. */
function lifecycle(operation: string, name: string, options: CuaTaskOptions = {}, extra: readonly string[] = []): TaskDefinition {
  return task(value(options.cli ?? "cua"), ["sandbox", operation, "--local", ...extra, sandbox(name)], hostOptions(options));
}

// Connections are scoped to one explicit local sandbox; no global `cua do` target is changed.
const computerScript = `import asyncio, json, shlex, sys
from pathlib import Path
from cua_sandbox import Sandbox

async def main():
    name, action, payload = sys.argv[1:4]
    args = json.loads(payload)
    if action == "exec":
        args.extend(sys.argv[4:])
    elif len(sys.argv) != 4:
        raise ValueError("This Cua action does not accept extra arguments")
    async with Sandbox.connect(name, local=True) as sb:
        if action == "exec":
            result = await sb.shell.run(shlex.join(args), timeout=120)
            print(result.stdout, end="")
            print(result.stderr, end="", file=sys.stderr)
            return result.returncode
        if action == "screenshot":
            data = await sb.screen.screenshot(format="png")
            with Path(args[0]).open("xb") as output:
                output.write(data)
            print(args[0])
        elif action == "click":
            await sb.mouse.click(args[0], args[1], button=args[2])
        elif action == "type":
            await sb.keyboard.type(args[0])
        elif action == "key":
            await sb.keyboard.keypress(args)
        elif action == "scroll":
            await sb.mouse.scroll(args[0], args[1], scroll_x=args[2], scroll_y=args[3])
    return 0

sys.exit(asyncio.run(main()))
`;

/** Invoke the Sandbox SDK using data arguments rather than interpolated Python or a mutable global target. */
function computer(name: string, operation: string, args: readonly (string | number)[], options: CuaTaskOptions = {}): TaskDefinition {
  return task(value(options.python ?? "python3"), ["-c", computerScript, sandbox(name), operation, JSON.stringify(args)], hostOptions(options));
}

/** Validate screenshot-pixel coordinates. */
function coordinate(number: number): number {
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("Invalid Cua coordinate");
  return number;
}

/** Cua project integration for explicitly invoked local sandbox and computer-use tasks. */
export const cua = {
  /** Launch a named local sandbox from a Cua image. Runtime installation remains explicit. */
  create(name: string, image: string, options: CuaCreateOptions = {}): TaskDefinition {
    const { vm, cpus, memory, disk, cli = "cua" } = options;
    if (cpus !== undefined && (!Number.isSafeInteger(cpus) || cpus < 1)) throw new Error("Invalid Cua CPU count");
    for (const size of [memory, disk]) if (size !== undefined && !/^[1-9][0-9]*(?:MB|GB|M|G)$/i.test(size)) throw new Error("Cua sizes require explicit MB or GB units");
    return task(value(cli), ["sandbox", "launch", "--local", "--name", sandbox(name), ...(vm ? ["--vm"] : []), ...(cpus === undefined ? [] : ["--cpu", String(cpus)]), ...(memory ? ["--memory", memory] : []), ...(disk ? ["--disk", disk] : []), value(image)], hostOptions(options));
  },
  /** Inspect one local sandbox as JSON. */
  status(name: string, options?: CuaTaskOptions): TaskDefinition { return lifecycle("info", name, options, ["--json"]); },
  /** Suspend a local sandbox using the selected runtime's capabilities. */
  suspend(name: string, options?: CuaTaskOptions): TaskDefinition { return lifecycle("suspend", name, options); },
  /** Resume a suspended local sandbox. */
  resume(name: string, options?: CuaTaskOptions): TaskDefinition { return lifecycle("resume", name, options); },
  /** Restart the named local sandbox. */
  restart(name: string, options?: CuaTaskOptions): TaskDefinition { return lifecycle("restart", name, options); },
  /** Open Cua's display viewer for one local sandbox. */
  vnc(name: string, options?: CuaTaskOptions): TaskDefinition { return lifecycle("vnc", name, options); },
  /** Explicitly delete the named local sandbox and its data without an interactive prompt. */
  remove(name: string, options?: CuaTaskOptions): TaskDefinition { return lifecycle("delete", name, options, ["--force"]); },
  /** Execute literal arguments using the sandbox's POSIX shell; appended task arguments are also quoted. */
  exec(name: string, command: readonly [string, ...string[]], options?: CuaTaskOptions): TaskDefinition {
    if (!command.length || !command[0] || command.some(argument => argument.includes("\0"))) throw new Error("Invalid Cua guest command");
    return computer(name, "exec", command, options);
  },
  /** Reconcile or plan using Workstation already installed inside a local Linux/macOS sandbox. */
  workstation(name: string, guest: NestedWorkstationOptions, options?: CuaTaskOptions): TaskDefinition { return cua.exec(name, nestedCommand(guest), options); },
  /** Save a PNG screenshot to a new host file; existing files are not overwritten. */
  screenshot(name: string, output: string, options?: CuaTaskOptions): TaskDefinition { return computer(name, "screenshot", [value(output)], options); },
  /** Click a pixel in the named sandbox's desktop. */
  click(name: string, x: number, y: number, button: "left" | "right" | "middle" = "left", options?: CuaTaskOptions): TaskDefinition {
    if (!["left", "right", "middle"].includes(button)) throw new Error("Invalid Cua mouse button");
    return computer(name, "click", [coordinate(x), coordinate(y), button], options);
  },
  /** Type literal text inside one sandbox. */
  type(name: string, text: string, options?: CuaTaskOptions): TaskDefinition {
    if (text.includes("\0")) throw new Error("Invalid Cua text");
    return computer(name, "type", [text], options);
  },
  /** Press a key or key combination, using Cua's key names. */
  key(name: string, keys: readonly [string, ...string[]], options?: CuaTaskOptions): TaskDefinition {
    if (!keys.length) throw new Error("Cua key combination cannot be empty");
    return computer(name, "key", keys.map(value), options);
  },
  /** Scroll at a desktop coordinate; signed deltas follow the Cua SDK. */
  scroll(name: string, x: number, y: number, deltaX: number, deltaY: number, options?: CuaTaskOptions): TaskDefinition {
    if (![deltaX, deltaY].every(Number.isSafeInteger)) throw new Error("Invalid Cua scroll delta");
    return computer(name, "scroll", [coordinate(x), coordinate(y), deltaX, deltaY], options);
  },
};
