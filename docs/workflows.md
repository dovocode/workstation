---
title: "Everyday workflows"
sidebar_label: "Everyday workflows"
---

# Everyday workflows

Run commands from the setup directory unless they include `--config`. Inspect a
plan before applying a changed declaration whenever prerequisites already exist.
A first build can bootstrap supported managers; a plan cannot.

## Add a resource to an existing setup

1. Add the declaration to `resources` or the appropriate platform/machine fragment.
2. Run `workstation plan` and review resource IDs, actions, and removal reasons.
3. Run `workstation build --no-remove` to reject a plan containing removals.
4. Run `workstation status` and review the source and lock diff before committing.

`--no-remove` is a removal guard, not a dry run: builds can still install
prerequisites, prepare repositories, write pins, and apply allowed changes.
A `forget` action retains the resource and is not blocked by this option.

## Share one setup across machines

Use shared fragments for common tools and conditional fragments for differences:

```ts
import { defineConfig, darwin, linux, machine, tools } from "@dovocode/workstation";

export default defineConfig([
  { resources: [tools.mise({ node: "lts" })] },
  darwin({ resources: [tools.brew(["git"]), tools.brewCask(["ghostty"])] }),
  linux({ resources: [tools.system(["git"])] }),
  machine("studio", { resources: [tools.mise(["go"])] }),
]);
```

```sh
workstation build --machine studio
workstation --machine studio status
```

Use the same selector on subsequent commands. An override does not simulate a
different OS or change the user home. Lock targets are per machine; commits can
contain pins for several machines. Resolve shared lock merge conflicts before
running another build. See [configuration](configuration.md) for module composition
and last-declaration-wins overrides.

## Upgrade packages or refresh only the lock

Choose the command by the intended effect:

| Goal | Command |
| --- | --- |
| Reapply existing pins | `workstation build` |
| Refresh all configured packages and apply everything | `workstation upgrade` |
| Refresh one package and reconcile everything | `workstation upgrade package:mise:node` |
| Refresh pins for review without applying resources | `workstation lock update` |
| Refresh selected pins without applying | `workstation lock update package:mise:node` |
| Apply only if existing lock declarations remain valid | `workstation build --frozen-lockfile` |
| Update Workstation itself | `workstation update` |

For a reviewable package update:

```sh
workstation lock update package:mise:node
git diff -- workstation.lock
workstation plan --frozen-lockfile
workstation build --frozen-lockfile --no-remove
workstation status
```

Selectors still apply: `lts` may resolve to a newer LTS, while an exact version
stays exact. Unselected unchanged pins are retained; new or changed declarations
still need resolution. Unknown IDs fail. Obtain IDs from `plan`/`status` or the
[resource ID table](configuration.md#dependencies-and-resource-ids).

`upgrade` applies the full setup, including files, removals, and post-apply hooks.
It refreshes selected APT/Homebrew metadata after repository preparation. A lock
update requires existing managers and does not prepare missing repositories.
`--frozen-lockfile` cannot be combined with `upgrade`. Backend availability still
limits whether a historical pin can be installed; see [capabilities](resources.md#backend-capabilities).

## Bring existing dotfiles under management

Choose a policy before the first build:

| Desired result | Declaration |
| --- | --- |
| Keep a file linked to a tracked source | `symlink(source, target)` |
| Own the entire generated document, saving the original | `files.json(...)` or another format with default `overwrite` |
| Reject a different unmanaged document | Generated file with `ifExists: "update"` |
| Leave any existing document alone | Generated file with `ifExists: "ignore"` |
| Manage only a marked section | `files.inject(...)` |
| Manage selected environment keys | `files.dotenv(...)` |
| Seed settings an application will subsequently edit | `provision(..., { type: "copy-file", seed: true, ... })` |

For symlinks, manually move an existing regular target aside before applying;
Workstation refuses to overwrite it. For injection, add one pair of unique
markers to the existing file first. For mutable app preferences, seed a regular
file rather than repeatedly overwriting the app's edits.

See [file recipes](files.md) for removal behavior and
[copy migration](provisioning.md#copy-or-seed-application-settings) for converting
legacy symlinks while preserving current content.

## Remove something you no longer want

Remove its declaration, inspect `workstation plan`, then run `workstation build`
without `--no-remove`. Owned packages/files/services are removed according to their
resource policies; original files may be restored. Adopted resources are generally
forgotten and left installed. Provision operations are always retained.

Do not rename a resource merely to bypass an ownership conflict. A changed target
can mean removal of the old target plus creation of the new one. Modified managed
content can block removal; inspect the change and preserve wanted edits first.
Application data, caches, and package dependencies are not a universal cleanup scope.

## Move or rename a configuration

For a **new** setup, `id: "personal-workstation"` in `defineConfig` provides a
stable state identity across checkout moves. The lock still lives beside the
entry point. IDs should be unique to the intended setup.

For an **existing** setup, find its resolved `stateFile` using the
[embedded API](embedding.md#inspect-the-resolved-configuration). Preserve that
exact path with an explicit `stateFile` before moving the checkout. Keep the
same machine selector and move the source imports and lock with the entry point.
Verify the new location with `status` and `plan` before applying.

Adding an `id` to an already managed configuration also changes the default state
namespace. Do not do so as a cosmetic edit. Keep backups/state intact; copying only
the lock does not carry ownership. A different machine should keep its own state.

## Recover after a failed or interrupted build

Read the first failing action, correct its cause, and rerun the original build.
Verified earlier actions stay applied; batches can partially succeed. The pending
journal preserves intended ownership across interrupted creates/updates.

If a guard reports an active run, wait. After a crash, inspect the exact guard's
recorded process and remove only that stale guard once the owner has stopped.
Do not delete `state.json`, `pending.json`, or history to make an error disappear.
See [troubleshooting](troubleshooting.md) and [interruption recovery](managed-setup.md#state-and-interrupted-runs).

## Roll back a supported update

```sh
workstation history
workstation rollback RUN
workstation rollback RUN --apply
```

Replace `RUN` with an identifier printed by history. Preview must succeed before
applying. For another entry point, put `--config PATH` before `rollback`.

Snapshots support eligible updates to previously managed generated files and
exactly pinned mise packages. They do not support arbitrary package backends,
resource creation/removal, injection changes, policy changes, provision operations,
or application data. External edits or unrelated drift can block restoration.

Rollback creates its own recovery snapshot and leaves the TypeScript source and
lock untouched. Align those inputs with your intended restored setup before the
next build, otherwise it can reapply the newer declaration. See
[rollback details](operations.md#snapshot-rollback).
