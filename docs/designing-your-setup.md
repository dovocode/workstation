---
title: Design a setup you can maintain
sidebar_label: Choose the right building blocks
---

Start with declarations for the parts of your workstation you actually want to
maintain. Add more after the first build converges and you understand how removal
works. A small configuration that you trust is easier to extend than a bootstrap
script that changes everything at once.

## Resource, task, hook, or check?

| Requirement | Use | When it runs |
| --- | --- | --- |
| A package/file/service should exist in a known state | A resource helper | Build inspects and changes it when necessary |
| A local source change should rebuild an executable | `customTool` | Source fingerprint changes or artifact is missing |
| I want to invoke a command myself | A named `task` | Only when the task is selected |
| A command should run after every successful build | `afterApply` with `task` | After reconciliation, including no-change builds |
| An installation should be probed and repaired when unhealthy | `provision` with `type: "check"` | Probe during inspection; repair during apply if needed |
| An app needs initial defaults but should edit them afterward | Provision `copy-file` with `seed: true` | Seed when missing; preserve an existing regular file |

Do not put package installation in an unconditional hook if a package resource
already provides pinning, inspection, verification, and removal. Do not put login
or pairing into a health-check repair: those operations need explicit user intent
and often cannot be repeated unattended.

## Own only as much of a file as you need

Suppose you want to set `EDITOR` in an existing `.zshrc`:

- If the entire file is described by your setup, use `zsh.zshrc`.
- If you also edit it by hand, add one marked region and use `files.inject`.
- If it should be the live contents of a tracked file, use `symlink` after explicitly
  moving aside any existing regular target.

For app settings, decide whether the declaration or the application should be
responsible for future edits. A full generated file may undo edits made in the app.
A seed lets the app take over. Dotenv merge is a third choice when only certain
keys should be maintained while other values remain local.

See the [file-policy table](files.md#pick-the-existing-file-policy) before taking
over a target. Two declarations for the same resolved file do not merge; the later
one replaces the earlier declaration.

## Compose by responsibility, then override by machine

A practical layout is:

```text
setup/
  workstation.config.ts
  workstation.lock
  config/
    common.ts
    macos.ts
    linux.ts
  dotfiles/
    gitconfig
  tools/
    hello/
      hello.sh
```

Keep shared choices in `common.ts`; separate OS-specific package names and shell
preferences only when needed. Keep a machine override small: add a tool or replace
a complete declaration. Objects are not deep-merged, so a replacement must include
all settings that should remain.

```ts
import { defineConfig, darwin, linux } from "@dovocode/workstation";
import common from "./config/common.ts";
import macos from "./config/macos.ts";
import linuxSetup from "./config/linux.ts";

export default defineConfig([
  common,
  darwin(macos),
  linux(linuxSetup),
]);
```

This is a composition template: create those modules and export fragments from them.
Every fragment shares the entry point's `configDir`. Moving a declaration into
`config/common.ts` does not change a source such as `dotfiles/gitconfig` into
`config/dotfiles/gitconfig`.

## Make dependencies describe real relationships

Use `dependsOn` when an operation requires the converged output of another
resource, especially repository → package, settings → service, or package → health
check. Use stable resolved IDs, not display names or target paths without the
`file:` prefix.

A generated service depending on a settings file restarts when that file changes.
A checked provision resource depending on a package is re-evaluated after the package
changes. `restartOnChange: true` can force the check's repair command after a dependency
change even if the probe now succeeds. Avoid adding dependency edges between unrelated
packages: it limits batching and obscures why an order is necessary.

## Separate workstation setup from application setup

Use Workstation for the shared runtimes, shell configuration, and machine services.
Keep an application's own `package.json`, migrations, databases, and credentials in
its existing project workflow. A named task can invoke that workflow from the correct
`cwd`; it should not duplicate its dependency state in your workstation config.

Similarly, Docker and sandbox helpers are explicit lifecycle tasks. A host build
does not create containers automatically. Guest setup runs the guest's own Workstation
and keeps its own state. See [environment tasks](environments.md).

## Grow in verifiable steps

1. Make a file-only configuration and confirm a second build converges.
2. Add runtimes and generated activation; check versions in a new terminal.
3. Add platform-specific tools and apps; review the lock diff.
4. Bring existing files under management with deliberate policies.
5. Add services and explicit dependencies; inspect the process and logs.
6. Add health checks only for failures you can detect and repair meaningfully.
7. Keep optional project operations as named tasks.

For every step, decide how you will confirm success and what should happen on
removal. The [developer workstation walkthrough](developer-workstation.md) puts
these choices together into a concrete configuration.
