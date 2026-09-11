---
title: How Workstation works
sidebar_label: Understand the model
---

Think of Workstation as a repeated comparison between **what you want**, **what is
on the machine**, and **what Workstation previously managed**. That third part is
why it can distinguish a tool it installed from one you already had.

## Configuration describes a result

A resource is a declaration such as “Node should use this version selector,”
“this JSON file should contain these settings,” or “this service should be running.”
Helpers return typed declarations. They do not perform installation themselves.

```ts
import { defineConfig, files } from "@dovocode/workstation";

export default defineConfig({ resources: [
  files.json("~/.config/example/settings.json", { theme: "dark" }),
] });
```

On a machine without the file, the plan contains a create. After a successful
build, another build should have no action for it. If you change the theme in
TypeScript, Workstation plans an update. If you remove the declaration, it plans
removal or forget according to the saved ownership and file policy.

Configuration is executable TypeScript. Factories can inspect the machine context
and compose fragments, but keep configuration evaluation free of side effects:
`plan`, `status`, and task listing need to load it too.

## The three inputs to a plan

| Input | Example | Why it matters |
| --- | --- | --- |
| Desired configuration | Node `lts`, settings with `theme: "dark"` | Defines what should exist |
| Live inspection | Installed Node version, actual file contents | Detects missing resources and drift |
| Recorded state | Ownership, applied version/hash, saved original | Determines whether update, deletion, or restoration is safe |

Workstation does not assume every existing resource belongs to it. Matching
pre-existing resources are **adopted**. Resources it creates are generally **owned**.
Some policies permit updates to adopted resources without taking removal ownership.

For example, an already matching symlink is adopted. Removing its declaration
later forgets it and leaves the link intact. A symlink created by Workstation can
be removed if it still matches the managed target. Provision operations are retained
regardless of ownership; their effects often include mutable data or account access.

## Learn the five plan actions

| Action | Meaning | Typical example |
| --- | --- | --- |
| `create` | Make an absent desired resource | Install a missing tool or write a new file |
| `adopt` | Record something already matching | Track an existing matching symlink |
| `update` | Converge a changed or drifted resource | Rewrite managed settings or change a package version |
| `remove` | Remove an owned resource or restore its original | Restore a file replaced by Workstation |
| `forget` | Stop recording ownership without removing the resource | Retain an adopted package or provisioned repository |

Read the **reason** as well as the action. An update can reflect changed source,
live drift, a package upgrade, or a dependency change. A remove can restore an
original file rather than simply delete a path.

## What happens during a build?

1. **Load and resolve:** evaluate the entry point, select platform/machine fragments,
   expand paths, validate declarations, and determine resource identities.
2. **Prepare:** hold the mutation guards, reserve claims, and prepare supported
   prerequisite managers and repositories needed by the configuration.
3. **Lock:** reuse matching pins or resolve missing/changed package declarations.
   A frozen build refuses to invent replacement entries.
4. **Plan:** inspect the live machine, compare it with desired and saved state,
   and order actions with dependencies.
5. **Apply and verify:** execute changes, inspect their results, and checkpoint
   successful actions. Compatible packages may share a native batch.
6. **Follow up:** run `afterApply` hooks in order after successful reconciliation,
   including on builds with no resource changes.

A later failure does not undo earlier successes. Workstation saves progress so a
rerun can continue after the cause is fixed. This is reconciliation with recovery
information, not an all-or-nothing transaction.

## Selectors and pins solve different problems

A selector expresses your upgrade policy, such as `node: "lts"`. A pin records
the exact version resolved for a machine. Ordinary builds reuse an unchanged pin,
so “LTS” does not mean “download the newest LTS on every run.”

Use `upgrade` to deliberately refresh allowed versions and reconcile, or
`lock update` to refresh and review pins before applying them. An exact selector
still selects that exact version during an upgrade. Backend repositories must
continue to make the recorded version available; a lock is not a package archive.

`files.mise` connects installation and activation: it renders your locked mise
versions into a configuration file. Merely installing a runtime does not change
the environment of the terminal that launched Workstation.

## Keep the right files in the right place

| Artifact | Keep in Git? | Role |
| --- | --- | --- |
| TypeScript configuration, imported modules, tool source | Yes | Reproducible intent |
| `workstation.lock` | Yes | Reviewed per-machine resolutions |
| Ownership state and original-file backups | No | Local ownership and restoration |
| Resolved manifest, pending journal, recovery snapshots | No | Local execution and recovery records; may contain private values |

By default, state identity depends on the absolute configuration path and machine
selector. For a new setup, choose a stable `id` before its first build if you expect
to move the checkout. For an existing setup, preserve its current state path rather
than accidentally starting a new ownership namespace.

## Pick the command for your intent

- **Inspect planned work:** `workstation plan`. Prerequisites must exist already.
- **Check drift against recorded state:** `workstation status`.
- **Converge the setup:** `workstation build`.
- **Refresh configured package versions and converge:** `workstation upgrade`.
- **Update the Workstation executable:** `workstation update`.
- **Run a named command:** `workstation TASK`.

Continue with [installation](getting-started.md), then try the
[file-only tutorial](tutorial.md). It demonstrates the lifecycle without needing
package-manager mutations.
