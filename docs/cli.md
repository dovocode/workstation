# CLI reference

| Invocation | Behavior |
| --- | --- |
| `workstation`, `help`, `--help` | Help without configuration loading |
| `workstation --version` | Package version |
| `workstation init` | Create starter without overwriting |
| `workstation build` | Resolve pins and reconcile |
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
