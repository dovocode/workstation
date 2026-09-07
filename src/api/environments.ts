import { task } from "./tasks.js";
import type { TaskDefinition } from "./types.js";

/** Host-side task settings; environment values are not implicitly forwarded into guests. */
export type EnvironmentTaskOptions = Omit<TaskDefinition, "command" | "args">;

/** Guest-side reconciliation settings. Paths refer to the guest, never the host. */
export interface NestedWorkstationOptions {
  /** Guest configuration path; must already exist inside the environment. */
  readonly config: string;
  /** Guest executable on PATH or an explicit executable path. */
  readonly executable?: string;
  /** Explicit guest machine selection, independent of the host selection. */
  readonly machine?: string;
  /** Inspect only; does not bootstrap or apply guest resources. */
  readonly plan?: boolean;
  /** Require existing guest package pins. */
  readonly frozen?: boolean;
  /** Reject removal actions in a guest build. */
  readonly noRemove?: boolean;
}

/** Construct a literal nested invocation shared by all runtime adapters. */
function nestedCommand(options: NestedWorkstationOptions): [string, ...string[]] {
  return [positional(options.executable ?? "workstation", "guest executable"), options.plan ? "plan" : "build",
    "--config", positional(options.config, "guest configuration"),
    ...(options.machine === undefined ? [] : ["--machine", positional(options.machine, "guest machine")]),
    ...(options.frozen ? ["--frozen-lockfile"] : []), ...(options.noRemove ? ["--no-remove"] : [])];
}

/** Require a positional value that cannot be interpreted as a CLI flag. */
function positional(value: string, label: string): string {
  if (!value || value.startsWith("-") || /[\0\r\n]/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

/** Require a named runtime instance instead of broad selectors or flag-like identifiers. */
function instance(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) throw new Error("Invalid environment name");
  return value;
}

/** Explicit Docker task declarations. These do not participate in resource ownership or rollback. */
export const docker = {
  /** Reconcile or plan a configuration inside an existing container using its own Workstation. */
  workstation(name: string, guest: NestedWorkstationOptions, host?: EnvironmentTaskOptions): TaskDefinition {
    return docker.exec(name, nestedCommand(guest), host);
  },
  /** Run a named container with an optional literal guest command. No privileged mounts are added. */
  run(name: string, image: string, command: readonly string[] = [], options: EnvironmentTaskOptions & { readonly detach?: boolean; readonly removeOnExit?: boolean; readonly envFiles?: readonly string[] } = {}): TaskDefinition {
    const { detach, removeOnExit, envFiles = [], ...host } = options;
    return task("docker", ["run", "--name", instance(name), ...(detach ? ["--detach"] : []), ...(removeOnExit ? ["--rm"] : []), ...envFiles.flatMap((file) => ["--env-file", positional(file, "environment file")]), positional(image, "image"), ...command], host);
  },
  /** Execute a literal argument vector in an existing container. */
  exec(name: string, command: readonly [string, ...string[]], options?: EnvironmentTaskOptions): TaskDefinition {
    return task("docker", ["exec", instance(name), ...command], options);
  },
  /** Stop only the named container. */
  stop(name: string, options?: EnvironmentTaskOptions): TaskDefinition { return task("docker", ["stop", instance(name)], options); },
  /** Remove only the named stopped container; no force or volume deletion is enabled. */
  remove(name: string, options?: EnvironmentTaskOptions): TaskDefinition { return task("docker", ["rm", instance(name)], options); },
  /** Run a Compose project operation with an explicit project identity and file. Down retains named volumes. */
  compose(project: string, file: string, operation: "up" | "down" | "ps" | "logs" | "pull", options?: EnvironmentTaskOptions): TaskDefinition {
    if (!["up", "down", "ps", "logs", "pull"].includes(operation)) throw new Error("Unsupported Compose operation");
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw new Error("Invalid Compose project name");
    return task("docker", ["compose", "--project-name", project, "--file", positional(file, "Compose file"), operation, ...(operation === "up" ? ["--detach"] : [])], options);
  },
};

/** Docker Sandboxes uses the standalone sbx CLI. Install and authenticate it separately. */
export const sbx = {
  /** Reconcile or plan a configuration inside an existing Docker Sandbox. */
  workstation(name: string, guest: NestedWorkstationOptions, host?: EnvironmentTaskOptions): TaskDefinition {
    return sbx.exec(name, nestedCommand(guest), host);
  },
  /** Create a named agent sandbox for an explicit host workspace without attaching. */
  create(name: string, agent: string, workspace: string, options?: EnvironmentTaskOptions): TaskDefinition {
    return task("sbx", ["create", "--name", instance(name), positional(agent, "agent"), positional(workspace, "workspace")], options);
  },
  /** Execute commands inside an existing sandbox; arguments are not interpreted by a host shell. */
  exec(name: string, command: readonly [string, ...string[]], options?: EnvironmentTaskOptions): TaskDefinition {
    return task("sbx", ["exec", instance(name), ...command], options);
  },
  /** Stop the named sandbox. */
  stop(name: string, options?: EnvironmentTaskOptions): TaskDefinition { return task("sbx", ["stop", instance(name)], options); },
  /** Remove the named sandbox without forcing active-session deletion. */
  remove(name: string, options?: EnvironmentTaskOptions): TaskDefinition { return task("sbx", ["rm", instance(name)], options); },
};

/** Microsandbox lifecycle tasks using the documented msb CLI (0.6.8 interface). */
export const microsandbox = {
  /** Reconcile or plan a configuration inside an existing Microsandbox microVM. */
  workstation(name: string, guest: NestedWorkstationOptions, host?: EnvironmentTaskOptions): TaskDefinition {
    return microsandbox.exec(name, nestedCommand(guest), host);
  },
  /** Create a named microVM from an OCI image. */
  create(name: string, image: string, options?: EnvironmentTaskOptions): TaskDefinition {
    return task("msb", ["create", "--name", instance(name), positional(image, "image")], options);
  },
  /** Execute a literal command inside the named microVM. */
  exec(name: string, command: readonly [string, ...string[]], options?: EnvironmentTaskOptions): TaskDefinition {
    return task("msb", ["exec", instance(name), "--", ...command], options);
  },
  /** Remove the explicitly named microVM, including its disk, using msb's documented force removal. */
  remove(name: string, options?: EnvironmentTaskOptions): TaskDefinition { return task("msb", ["rm", "--force", instance(name)], options); },
};
