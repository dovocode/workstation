---
title: "Custom tasks and aliases"
sidebar_label: "Tasks, aliases & hooks"
---

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
CLI task output streams live and is also captured; its exit code is returned
by the CLI. Stdin is inherited, but stdout/stderr are pipes and no PTY is allocated.
Programs requiring a full interactive terminal may behave differently.

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
belong to the task; one optional `--` separator is removed. All built-in command
names are reserved, including `help`, `init`, `build`,
`upgrade`, `plan`, `status`, `doctor`, `history`, `rollback`, `lock`, and `update`.
Task aliases are CLI shortcuts, not executable symlinks or shell aliases; use
the symlink and shell helpers for those separately.

## Runtime bootstrap and embedded tasks

A selected CLI task whose command is `node`, `npm`, `npx`, or `pnpm` prepares its
pinned runtime through mise (Node.js 26.8.1 and, for pnpm, pnpm 12.3.4). Merely
declaring the task does not install those runtimes during a file-only build.
Other task executables must already be available. Embedded `client.task()` and
`runTask()` do not perform this CLI bootstrap; provide prerequisites explicitly.

## Working directory and environment example

```ts
import { defineConfig, task } from "@dovocode/workstation";

export default defineConfig({
  tasks: {
    test: task("pnpm", ["test"], {
      cwd: "projects/app",
      environment: { NODE_ENV: "test" },
      description: "Test the app from its project directory",
    }),
  },
  aliases: { t: "test", quick: "t" },
});
```

`projects/app` is relative to the configuration entry point. Run
`workstation --config /path/setup.ts quick -- --watch` to append `--watch` to
`pnpm test`. A task argument named `--config` belongs to the task when it appears
after the task name. Environment values override inherited entries only for that
process; no `.env` file is loaded automatically.
