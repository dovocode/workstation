# Custom tasks and aliases

Declare tasks alongside resources, using the same imported fragments and
platform/machine conditions:

```ts
import { defineConfig, task } from "@dovocode/workstation";

export default defineConfig({
  tasks: {
    test: task("pnpm", ["test"], { description: "Run project tests" }),
    "build-app": task("pnpm", ["build"], { cwd: "app" }),
  },
  aliases: { t: "test", b: "build-app" },
});
```

```sh
workstation --list-tasks
workstation test
workstation t -- --watch
workstation --machine studio build-app
```

A task invocation does not install resources or write the lock, manifest, or
ownership state. It evaluates the configuration and executes only the selected
command. Run `workstation build` to reconcile the setup.

Task commands run directly without shell interpolation. Extra arguments are
appended unchanged. For shell pipelines, explicitly declare a shell command
such as `task("bash", ["-lc", "first-command && second-command"])`.
Output is collected and printed when the command finishes; its exit code is
returned by the CLI. These tasks are not a streaming interactive terminal.

## Post-apply scripts

Use `afterApply` for commands that must run after `workstation build` or
`workstation upgrade` successfully reconciles resources:

```ts
import { defineConfig, task } from "@dovocode/workstation";

export default defineConfig({
  afterApply: [
    task("echo", ["Workstation reconciliation complete"], {
      description: "Report successful reconciliation",
    }),
  ],
});
```

Hooks use the same command options as tasks: literal arguments, a working
directory relative to the configuration entry point (defaulting to that
directory), and environment overrides. Use an explicit shell for shell syntax.
Hooks from imported and platform/machine fragments append in declaration order.
They are validated before applying resources and saved in the resolved manifest.

Hooks run sequentially and stream output, including on successful runs with no
resource changes. Write them to be safe to repeat. The first failure stops later
hooks and makes the command fail; already-applied resources remain in place.
Hooks do not run if reconciliation fails, or during `plan`, tasks, diagnostics,
lock updates, or rollback. The embedded client's `build()` also runs them.

Keep source-based builds in `customTool` so source changes control rebuilding.
Use managed resources for service activation and health checks.
Use a post-apply script for follow-up work such as reporting successful reconciliation.

Working directories default to the entry point's directory; relative `cwd`
values resolve there and `~` expands to home. `environment` overrides inherited
environment entries. Later fragments override task names. Aliases can chain;
cycles, missing targets, and task/alias name collisions are rejected.

Place Workstation's own flags before the task name. All arguments after it
belong to the task; one optional `--` separator is removed. `help` and `init` are reserved.
Task aliases are CLI shortcuts, not executable symlinks or shell aliases; use
the symlink and shell helpers for those separately.
