---
title: "Troubleshooting"
---

# Troubleshooting

[Handbook](README.md) · [CLI reference](cli.md) · [Troubleshooting](troubleshooting.md)

Start with the exact configuration and machine selector used by the failing run:

```sh
workstation --config /absolute/path/workstation.config.ts doctor
workstation --config /absolute/path/workstation.config.ts status
workstation plan --config /absolute/path/workstation.config.ts --verbose
```

Add `--machine NAME` before `doctor`/`status` if the original build used an override.
`doctor` checks package-backend executables on PATH and reports their limitations;
it is not a complete application, network, credential, or service health check.
`status` compares live resources with saved declarations and pins. A plan may query
version metadata and execute declared read-only probes, so it can require networking.

## Understand status output

| Status | Meaning | Next step |
| --- | --- | --- |
| `converged` | Saved declaration matches and inspection succeeds | No resource action needed |
| `untracked` | Declaration has no saved state | Plan the first create/adopt |
| `declaration-changed` | Source differs from saved declaration | Review the intended edit and plan |
| `drifted` | Live inspection differs from saved state | Inspect external edits or missing/stopped resources |
| `removed-declaration` | State still tracks something no longer declared | Plan removal/forget |
| `error` | Inspection failed | Fix the reported command, permission, or backend problem |

Status exits 1 for anything other than all-converged. This is useful for monitoring;
it does not mean that every difference is an unexpected failure. Plans with changes
still exit 0. CLI task commands return their command's exit code.

## Configuration cannot be found or imported

Discovery checks `workstation.config.ts` in the current directory and does not walk
parents. Use `--config PATH` to select an entry point elsewhere. Put global options
before `status`, `doctor`, `lock`, `history`, `rollback`, or a task name.

Built-in imports work through the CLI's bundled API when no local package resolves.
An installed local Workstation package takes precedence, so update it if a helper
is missing despite a newer executable. Third-party packages need explicit project
installation. Embedded file loading uses normal project resolution.

Factories must be synchronous. Ensure the default export produces at least one
configuration object and put platform-only resources behind `darwin`/`linux`.
A missing symlink/custom-tool/copy source must be fixed at its config-relative path.

## A package manager or runtime is missing

Builds can bootstrap mise and Homebrew. Plans, status, and lock updates do not
install prerequisites. APT, DNF, YUM, pacman, Flatpak, and mas need an existing
installation. Install optional Flatpak/MAS backends before resolving their packages;
adding the backend as a package in that same first build is insufficient.

CLI tasks using `node`, `npm`, `npx`, or `pnpm` have selected-task bootstrap;
embedded `client.task()` does not. Custom commands and custom-tool compilers need
their own prerequisites. Run Workstation as the target user, with sudo available
for individual privileged operations, rather than running the whole CLI as root.

## A frozen pin or repository version is unavailable

`Frozen lock cannot resolve …` means the machine target lacks an unchanged entry
for a declaration. Run a deliberate lock update, review the diff, then retry the
frozen build. A plan does not save newly resolved pins.

A valid lock does not guarantee that a remote still serves its versions. Homebrew
and pacman require available metadata to match; Flatpak fresh installs require the
remote's current commit. See [backend capabilities](resources.md#backend-capabilities).
Use `workstation upgrade package:MANAGER:NAME` to deliberately select a new allowed
version and reconcile, or `lock update` to review pins before applying.

For APT/Homebrew metadata failures, inspect the failing repository and network or
signature error. An upgrade stops on refresh failure. For pacman, maintain the
system through its normal full-upgrade process before refreshing Workstation pins.
For npm tools, verify the registry/authentication configuration used by `npm view`.
Do not change an exact version selector expecting `upgrade` to ignore it.

## A file conflicts or managed content changed

An `update` policy rejects different unmanaged content. Choose an intentional
migration or `overwrite` if replacing it with an original backup is the desired
behavior. Symlinks refuse regular file/directory targets. Injection requires exactly
one ordered marker pair. Dotenv rejects unsupported quoting and duplicate keys.

Before restoring or removing a changed managed file, preserve wanted external edits.
Do not delete state to force adoption: state contains original backups and ownership.
A custom executable changed outside Workstation is also a conflict; inspect its
provenance instead of overwriting an unknown artifact. Keep custom-tool build outputs
outside the hashed source tree to avoid perpetual rebuilds.

## A service is installed but not usable

Inspect the service manager and application logs:

```sh
# Linux user service; use your declared name.
systemctl --user status example-worker.service
journalctl --user -u example-worker.service -n 100 --no-pager

# macOS user LaunchAgent; use your declared label.
launchctl print "gui/$(id -u)/dev.example.worker"
```

A missing Linux user bus needs a valid user session. Lingering is a separate
provision operation; it is not automatically enabled by `systemdService`.
macOS user agents need the current user's GUI login domain. Ensure executables and
service environment paths are explicit; interactive shell activation does not run
inside the service automatically.

Workstation checks runtime activation, but an active process may still be unable
to serve requests. Use a read-only application health probe with a conditional
repair resource for that case. Startup readiness may lag activation. See
[services](services.md) and [health checks](provisioning.md#check-and-repair-an-initialized-application).

## A run holds a guard or recovery is ambiguous

The error names the exact guard directory. Read its `owner.json` and inspect the
recorded PID/start time. If that process is active, wait for it. After confirming
it has stopped, remove only that stale guard and rerun the original command.
Guards are not automatically broken by elapsed time.

Keep `pending.json`, ownership state, and snapshots intact. If interrupted work
cannot be unambiguously verified, inspect the target and journal together before
manual recovery. Failed batches can leave some packages installed and checkpointed;
fix the backend error and rerun rather than assuming the batch changed nothing.
See [managed setup recovery](managed-setup.md#state-and-interrupted-runs).

## Two configurations claim the same resource

An `already registered to …` error points to the other state namespace. Find the
configuration that owns it and decide which should manage it. Remove/forget the
resource through the original configuration's successful reconciliation before
transferring management. Generated-file removal can restore originals; owned package
removal can uninstall it, so inspect that plan before proceeding.

If this is the same setup moved to another checkout, preserve its original
`stateFile` and machine selector instead of creating another owner. A claim registry
is not a replacement for ownership backups and cannot discover all legacy state.

## Rollback is refused or history is empty

Snapshots are created for builds with actions; no-action builds do not provide
new recovery points. History is scoped to the selected state namespace, so check
config path, `id`, explicit `stateFile`, and machine selection.

Preview reports unsupported changes or unsafe drift. Snapshot rollback is limited
to eligible generated-file updates and exact mise updates; it is not a complete
machine restore. Keep the snapshot and inspect the conflict. Do not bypass external
edit checks by deleting state. See [rollback](operations.md#snapshot-rollback).

## A task or hook fails

Arguments run literally: `$HOME`, pipes, `&&`, and wildcards are not expanded by
an implicit shell. Use `cwd` for working directories and `environment` for overrides;
explicitly declare `bash -lc` or another shell when shell syntax is intended.
Workstation streams CLI task output but does not allocate a terminal/PTY for it.

Hooks run in order after successful reconciliation, even on no-change builds.
A failing hook stops later hooks and returns failure; applied resources stay in
place. Make hooks safe to repeat before retrying. Use `customTool` for builds that
should run only after source changes, and checked resources for conditional repair.

## Self-update refuses the installation

Invoke the specific native binary you intend to update; its resolved directory
must be writable. Global npm/pnpm updates require verification that the running
CLI belongs to that installation. Local dependencies, linked packages, source
checkouts, and unknown installations must be updated through their owning project
or build flow. Self-update does not create a fallback global npm installation.

## Report a reproducible issue

Include the Workstation version, OS/architecture, command, machine override,
minimal configuration, resource IDs, and relevant error/verbose output. Explain
whether the failure happened during query, apply, verification, or recovery.
Redact private values and paths as needed. Do not attach complete state, manifests,
backups, or history by default: they may contain plaintext file contents or secrets.
