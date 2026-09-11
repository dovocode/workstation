---
title: Your workstation, defined in TypeScript
slug: /
sidebar_label: Start here
---

Workstation turns a TypeScript configuration into a working macOS or Linux setup:
development runtimes, command-line tools, desktop applications, configuration
files, shell startup, and background services. Keep the inputs in Git, review the
changes, and run `workstation build` whenever the machine needs to match them.

## Start with a working setup

**New to Workstation?** Follow these guides in order. Each introduces the next
piece only after you have something working.

| Step | What you will learn | What you will have afterward |
| --- | --- | --- |
| **1. [Understand the model](concepts.md)** | Declarations, pins, ownership, and reconciliation | Know what a build will change and what it will preserve |
| **2. [Install Workstation](getting-started.md)** | Native executable, required managers, and configuration loading | A working `workstation` command |
| **3. [Build your first configuration](tutorial.md)** | Preview, create, update, run a task, and remove | A verified file-only setup you can safely explore |
| **4. [Build a developer workstation](developer-workstation.md)** | Combine packages, activation, dotfiles, platform differences, and tasks | A useful configuration you can adapt to your own machines |

The native executable includes its runtime. You can use built-in configuration
helpers without installing Node.js or creating a JavaScript project first.
Install the package locally when you want editor types or a pinned library version.

## What does a configuration look like?

```ts
import { defineConfig, files, task, tools } from "@dovocode/workstation";

const versions = { node: "lts", pnpm: "12.3.4" };

export default defineConfig({
  resources: [
    tools.mise(versions),
    files.mise("~/.config/mise/config.toml", versions),
    files.json("~/.config/example/settings.json", { theme: "dark" }),
  ],
  tasks: {
    hello: task("echo", ["Your setup is ready"], {
      description: "An explicit command, separate from reconciliation",
    }),
  },
});
```

This declares tools to install, a mise file that selects their exact locked
versions, a generated settings file, and a named command. A declaration describes
the desired result. It does not install anything merely because you imported it.

```sh
workstation build   # Prepare supported managers, resolve pins, apply the setup
workstation status  # Check recorded declarations against the machine
workstation hello   # Run only the explicit task
```

If the managers already exist, run `workstation plan` before a build to inspect
proposed changes. Generated files overwrite differing content by default and save
the original for restoration. Review existing files before adapting this example;
[choose a file policy](files.md#pick-the-existing-file-policy) when you only want
to manage a section or selected keys.

## Make it your own

Start with the change you actually want to make:

| Goal | Read next |
| --- | --- |
| Use one setup across your laptop and desktop | [Configuration, machines, and paths](configuration.md) |
| Choose the right abstraction for automation | [Design your setup](designing-your-setup.md) |
| Install runtimes, CLI tools, and desktop applications | [Packages and runtimes](resources.md) |
| Generate settings or bring dotfiles under management | [Files and existing content](files.md) |
| Make installed tools available in new terminals | [Shells and activation](shells.md) |
| Build your own executable from local source | [Custom tools](custom-tools.md) |
| Keep a background process running | [Services](services.md) |
| Configure repositories, seed app settings, and repair installations | [Provisioning](provisioning.md) |

## Use it every day

A build is not just a one-time installer. Run it after an intentional configuration
change or to reconcile a machine that has drifted. Keep your package pins stable
until you choose to refresh them.

- **[Everyday workflows](workflows.md):** add a machine, upgrade selected packages,
  migrate dotfiles, move your checkout, and remove old declarations.
- **[Ownership and recovery](operations.md):** understand what is adopted, what is
  removed, where originals live, and when snapshot rollback is possible.
- **[Troubleshooting](troubleshooting.md):** interpret diagnostics and recover without
  losing the state needed to restore your original files.

## Go further

Use [tasks and aliases](tasks.md) for explicit project commands and
[post-apply hooks](tasks.md#post-apply-scripts) for repeatable follow-up work.
Use [Docker and sandbox tasks](environments.md) to control separate environments,
or [embed the client](embedding.md) in your own TypeScript application.

The [CLI reference](cli.md) provides exact command and option behavior.
The [generated API reference](https://dovocode.github.io/workstation/api/) lists
public helpers and types. Read [architecture](architecture.md) and
[development](development.md) when extending Workstation itself.

## Know the boundary

Workstation manages declared resources. It does not capture an entire machine,
back up application databases, purchase App Store software, or automatically
revert every package-manager transaction. Keep configuration and locks in Git;
keep ownership state and original-file backups private. Authentication and
application initialization remain explicit operations.
