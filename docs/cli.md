---
title: "CLI reference"
sidebar_label: "CLI commands"
---

# CLI reference

| Invocation | Behavior |
| --- | --- |
| `workstation`, `help`, `--help` | Help without configuration loading |
| `workstation --version` | Package version |
| `workstation init` | Create starter without overwriting |
| `workstation build` | Resolve pins and reconcile |
| `workstation upgrade [IDs...]` | Refresh package pins and reconcile, including declared npm tools |
| `workstation plan` | Preview without Workstation persistence writes |
| `workstation status` | Inspect recorded pins and drift |
| `workstation doctor` | Check executables and explain backend limits |
| `workstation history` | List configuration-scoped snapshots |
| `workstation rollback RUN` | Preview supported restoration |
| `workstation rollback RUN --apply` | Apply supported restoration |
| `workstation lock update [IDs...]` | Refresh all or selected package pins |
| `workstation update` | Self-update native or global npm installation |
| `workstation --list-tasks` | List tasks and aliases |
| `workstation TASK -- ARGS...` | Run task with literal arguments |

Put global options before task-style commands: for example,
`workstation --config /project/setup.ts rollback RUN --apply`. After a task name,
remaining arguments belong to the task. Build/plan accept `--config`, `--machine`,
`--verbose`, and `--frozen-lockfile`. `build --no-remove` rejects remove actions,
not ownership-only forget actions. Self-update rejects configuration/build options.

Status returns 1 for drift, errors, changed or untracked declarations. Doctor returns
1 for missing commands. Task exit status is preserved. Other failures return 1;
successful commands return 0. Plans with proposed changes still succeed. JSON output
is not yet implemented. Use `--verbose` for command traces and detailed inspections.

See [architecture](architecture.md) for implementation boundaries and
[environment tasks](environments.md) for Docker and sandbox integrations.

`upgrade` includes npm tools declared with `tools.mise`, such as
`"npm:@example/cli": "latest"` or `"npm:t3[allow_builds=node-pty]": "nightly"`.
It resolves npm tags against the registry, updates their concrete lock versions,
and installs the new versions through mise. A plain `build` retains existing
pins. To upgrade just one npm tool:

```sh
workstation upgrade package:mise:npm:@example/cli
```

Only declared packages are managed; unrelated global npm installations and
project `package.json` dependencies are outside this command's scope.

## Option placement examples

```sh
workstation build --config /path/setup.ts --machine studio --no-remove
workstation plan --config /path/setup.ts --frozen-lockfile
workstation --config /path/setup.ts --machine studio status
workstation --config /path/setup.ts --verbose doctor
workstation --config /path/setup.ts lock update package:mise:node
workstation --config /path/setup.ts history
workstation --config /path/setup.ts rollback RUN --apply
workstation --config /path/setup.ts --list-tasks
workstation --config /path/setup.ts test -- --watch
```

Replace paths, task names, and `RUN` with your actual configuration values.
`build`, `plan`, and `upgrade` parse global options alongside the command. The
other command names use task-style parsing: flags after their name become command
arguments and may be rejected. Put global flags before those names consistently.
`--config=PATH` is not supported; use separate arguments.

## Choosing a read-only command

| Command | Resolves new versions? | Runs resource inspections? | Writes Workstation data? |
| --- | --- | --- | --- |
| `--help`, `--version` | No | No configuration loading | No |
| `--list-tasks` | No | No; loads configuration | No |
| `doctor` | No | Package command availability and state validation | No |
| `status` | No | Recorded declarations and live state | No |
| `plan` | If needed, unless frozen | Yes | No |
| `history` | No | Reads recovery identifiers | No |
| `rollback RUN` | May query exact mise availability | Restoration preconditions | No |
| `lock update` | Yes | Version queries | Lock only |

Executable configuration can perform its own side effects during loading. Read-only
provision checks must really be read-only, and native metadata queries may maintain
their own caches. Planning does not install missing managers or repositories.

## Output and failures

Builds show loading, version resolution, inspections, planned changes, and results.
`--verbose`/`-v` includes command traces, per-resource inspection detail, query
output, and exit timings. Mutations and CLI tasks stream output. Machine-readable
JSON output is not implemented; use the embedded API for structured results.

`--no-remove` rejects actual removal actions during build/upgrade, but permits
ownership-only forget actions. Although the parser accepts it for `plan`, it does
not filter or reject that plan's output. It is not a general no-mutation switch.
A failed build can have completed earlier actions; inspect the failure and rerun
after fixing its cause. See [recovery](workflows.md#recover-after-a-failed-or-interrupted-build).
