---
title: Build your developer workstation
sidebar_label: A complete developer setup
---

This walkthrough combines the individual helpers into one setup: Node and pnpm,
Git and jq, a tracked Git configuration, private development defaults, runtime
activation, and explicit project tasks. You will see both the configuration and
how to verify each part after applying it.

Use this for a **new setup project**. If you already manage your machine with
Workstation, add the relevant declarations to that configuration and preserve its
existing identity and state. Do not introduce a second owner for the same targets.

## 1. Prepare the project

After [installing Workstation](getting-started.md), create this layout:

```sh
mkdir -p workstation-setup/dotfiles workstation-setup/examples/app
cd workstation-setup
workstation init
```

Create `dotfiles/gitconfig`:

```ini
[init]
    defaultBranch = main
[pull]
    ff = only
[fetch]
    prune = true
```

Add your existing Git preferences and identity if you want this to replace your
current configuration. Before using a symlink at `~/.gitconfig`, move any existing
regular file aside yourself and retain a copy. Workstation will not overwrite a
regular file to create a symlink. If you already maintain Git settings elsewhere,
omit the symlink declaration below.

Create `examples/app/package.json` so the example task has a real project to run:

```json
{
  "name": "workstation-demo-app",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
```

Create `examples/app/example.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

test("the selected Node runtime can execute the project", () => {
  assert.equal(typeof process.versions.node, "string");
});
```

The example project has no external dependencies. In a real app, keep using its
normal install, test, and build commands.

## 2. Declare the complete setup

Replace `workstation.config.ts` with:

```ts
import {
  bash, configure, darwin, defineConfig, files, linux, machine,
  shell, symlink, task, tools, zsh,
} from "@dovocode/workstation";

const versions = { node: "26.8.1", pnpm: "12.3.4" };

export default defineConfig([
  configure(({ configDir, home }) => ({
    id: "developer-workstation",
    resources: [
      tools.mise(versions),
      tools.system(["git", "jq"]),
      files.mise("~/.config/mise/config.toml", versions),
      symlink("dotfiles/gitconfig", "~/.gitconfig"),
      files.dotenv(`${configDir}/examples/app/.env`, {
        APP_ENV: "development",
        PORT: "3000",
      }),
    ],
    tasks: {
      "runtime:version": task("mise", ["--cd", home, "exec", "--", "node", "--version"], {
        description: "Print the globally selected Node version",
      }),
      "app:test": task("mise", ["exec", "--", "pnpm", "test"], {
        cwd: "examples/app",
        description: "Run the example app's tests",
      }),
    },
    aliases: { t: "app:test" },
  })),
  darwin({ resources: [
    zsh.zshrc([
      shell.prependPath(shell.home(".local/bin")),
      shell.when(shell.condition.commandExists("mise"), [
        shell.eval(shell.command("mise", ["activate", "zsh"])),
      ]),
      shell.export("EDITOR", "vi"),
      shell.alias("ll", "ls -lah"),
    ]),
  ] }),
  linux({ resources: [
    bash.bashProfile([
      shell.prependPath(shell.home(".local/bin")),
      shell.source(shell.home(".bashrc"), { ifExists: true }),
    ]),
    bash.bashrc([
      shell.prependPath(shell.home(".local/bin")),
      shell.when(shell.condition.commandExists("mise"), [
        shell.eval(shell.command("mise", ["activate", "bash"])),
      ]),
      shell.export("EDITOR", "vi"),
      shell.alias("ll", "ls -lah"),
    ]),
  ] }),
  machine("studio", { resources: [tools.mise({ go: "latest" })] }),
]);
```

### Why these declarations are separate

- `tools.mise` installs runtimes. `files.mise` selects the exact resolved versions.
  Neither alone initializes an already running terminal.
- `tools.system` uses Homebrew on macOS or the detected Linux backend. This works
  here because `git` and `jq` are suitable names on the intended distributions;
  package names are not translated automatically.
- `symlink` keeps the tracked file live. Editing its source immediately affects Git.
- The dotenv target explicitly uses `configDir` because relative file targets
  otherwise resolve under your home, not the setup checkout.
- The task uses `mise exec` so it does not depend on having opened a fresh activated
  shell. `cwd` locates the example application relative to the entry point.
- OS helpers select fragments. The `studio` fragment adds Go only when that exact
  machine selector is used; it does not generate global Go activation by itself.

This example chooses Zsh on macOS and Bash on Linux. Change that choice to match
the shell you actually use. It does not change your login shell.

### Existing shell and mise files

The shell helpers and global mise file replace the complete target, preserving an
original backup for restoration. Include your existing aliases, completion, prompt,
and mise settings before applying. To keep hand-edited shell content, use
[a marked injection region](files.md#manage-one-region-of-an-existing-file) instead.

The stable `id` is chosen before the first build. Adding it to an already managed
setup changes its default state namespace. See [identity and migration](workflows.md#move-or-rename-a-configuration).

## 3. Inspect prerequisites, then build

```sh
workstation doctor
```

Missing mise or Homebrew can be prepared by a build. Missing APT/DNF/YUM/pacman,
required shell interpreters, or sudo need your normal OS setup first. If required
managers already exist, inspect the changes:

```sh
workstation plan
```

A plan cannot bootstrap missing managers. Once you have reviewed the declarations
and any existing-file replacements, apply:

```sh
workstation build --no-remove
workstation status
workstation build
```

The first build resolves pins and creates/adopts resources. Status should converge.
The repeat build should need no resource changes. `--no-remove` guards removal
actions, not all mutations; this still installs packages and writes declared files.

To include the extra `studio` resource, use `--machine studio` consistently on
build, status, and later operations. Do not switch selectors merely to “try” them
against the same managed targets; choose the actual identity for this machine.

## 4. Verify the setup at its boundaries

| Verify | Command or check | Expected result |
| --- | --- | --- |
| Saved declarations | `workstation status` | All resources converged |
| Installed runtime selection | `workstation runtime:version` | `v26.8.1` for this example |
| Project command | `workstation t` | The example test passes |
| Git configuration | `git config --global --get pull.ff` | `only` |
| Shell activation | Open a new terminal, run `node --version` and `pnpm --version` | Versions match the global mise file unless a project overrides them |
| File privacy | Inspect `examples/app/.env` permissions | Owner read/write (`0600`) |

The `.env` file is not automatically loaded by your task or shell. Your application
must read it using its existing dotenv support, or you can pass explicit task
`environment` values. Do not source arbitrary dotenv files as shell code.

## 5. Make your first change

Change `PORT` to `4000`, preview, and apply:

```sh
workstation plan
workstation build --no-remove
```

Only the declared dotenv key should change. Unrelated keys are preserved. Next,
add a desktop app in the appropriate fragment, for example
`tools.brewCask(["ghostty"])` on macOS, and repeat the review/build/status cycle.
For Linux apps, [Flatpak](resources.md#flatpak-applications-linux) requires the CLI
and remote to exist before package resolution.

To adopt a moving Node selector, change the shared `versions.node` from `26.8.1`
to your desired selector and deliberately refresh the lock. Both installation
and the generated mise file then follow the same recorded resolution:

```sh
workstation lock update package:mise:node
git diff -- workstation.lock
workstation build --frozen-lockfile --no-remove
```

Keep the source changes and reviewed lock together in Git. Do not commit `.env`,
local ownership state, backups, or history. A normal build retains unchanged pins;
`upgrade` refreshes them within the selectors you declared.

## 6. Extend where it earns its place

- Add a [custom tool](custom-tools.md) when you maintain your own executable.
- Add a [service](services.md) with dependencies on the executable and its config.
- Add a [health check](provisioning.md#check-and-repair-an-initialized-application)
  when you have a meaningful probe and a repeatable repair.
- Add [explicit tasks](tasks.md) for tests, builds, login, or pairing.
- Split the entry point into [modules](designing-your-setup.md#compose-by-responsibility-then-override-by-machine)
  when distinct responsibilities become easier to maintain separately.

If you remove a declaration, preview its removal/forget behavior before applying.
Package resources, generated files, adopted links, and retained provisioning have
different lifecycles. The [operations guide](operations.md) explains those cases.
