# Custom tasks and aliases

Declare tasks alongside resources, using the same imported fragments and
platform/machine conditions:

```ts
import { defineConfig, task } from "@dovocode/workstation";

export default defineConfig({
  tasks: {
    test: task("pnpm", ["test"], { description: "Run project tests" }),
    build: task("pnpm", ["build"], { cwd: "app" }),
  },
  aliases: { t: "test", b: "build" },
});
```

```sh
workstation --list-tasks
workstation test
workstation t -- --watch
workstation --machine studio build
```

A task invocation does not install resources or write the lock, manifest, or
ownership state. It evaluates the configuration and executes only the selected
command. Without a task name, Workstation reconciles the setup as usual.

Task commands run directly without shell interpolation. Extra arguments are
appended unchanged. For shell pipelines, explicitly declare a shell command
such as `task("bash", ["-lc", "first-command && second-command"])`.
Output is collected and printed when the command finishes; its exit code is
returned by the CLI. These tasks are not a streaming interactive terminal.

Working directories default to the entry point's directory; relative `cwd`
values resolve there and `~` expands to home. `environment` overrides inherited
environment entries. Later fragments override task names. Aliases can chain;
cycles, missing targets, and task/alias name collisions are rejected.

Place Workstation's own flags before the task name. All arguments after it
belong to the task; one optional `--` separator is removed. `help` is reserved.
Task aliases are CLI shortcuts, not executable symlinks or shell aliases; use
the symlink and shell helpers for those separately.
