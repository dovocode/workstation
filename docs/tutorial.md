---
title: "Your first working configuration"
sidebar_label: "Your first configuration"
---

# Your first working configuration

This walkthrough uses only generated files and one explicit task. It needs an
installed `workstation` executable and macOS or Linux; it installs no packages.
All generated content goes under `~/.config/workstation-demo`.

## 1. Create a setup project

```sh
mkdir workstation-demo
cd workstation-demo
workstation init
```

`init` creates `workstation.config.ts` and refuses to overwrite an existing file.
The CLI supplies built-in imports when the project has no installed Workstation
package. For editor type completion, install the package in your own project or
link a local build as described in [getting started](getting-started.md).

Replace the starter with:

```ts
import { defineConfig, files, jsonc, task } from "@dovocode/workstation";

export default defineConfig({
  resources: [
    files.json("~/.config/workstation-demo/settings.json", {
      theme: "dark",
      editor: { fontSize: 14 },
    }),
    files.jsonc("~/.config/workstation-demo/settings.jsonc", jsonc.object([
      jsonc.comment("Preferences managed by Workstation"),
      jsonc.property("formatOnSave", true),
    ])),
    files.dotenv("~/.config/workstation-demo/.env", {
      APP_ENV: "development",
      PORT: "3000",
    }),
  ],
  tasks: {
    hello: task("echo", ["Hello from Workstation"], {
      description: "Check task dispatch without applying resources",
    }),
  },
  aliases: { hi: "hello" },
});
```

These targets use the generated-file defaults: JSON/JSONC replace existing
content with an original backup, while dotenv merges declared keys with private
permissions. Choose an unused demo directory to see the creation flow.

## 2. Preview and apply

```sh
workstation plan
workstation build
workstation status
```

The first plan reports creates for absent targets. It does not save a lock or
state. The build writes the files and records ownership. Status should report
all three resources as converged and exit successfully.

```sh
cat "$HOME/.config/workstation-demo/settings.json"
workstation build
```

The file contains the declared settings. The second build should report that
Workstation is already converged. Inspect a file, then change `fontSize` in the
TypeScript source to `16`, run `plan`, and run `build` again: the JSON resource
updates while the other declarations remain unchanged.

## 3. Run an explicit task

```sh
workstation --list-tasks
workstation hi -- extra-argument
```

The command prints `Hello from Workstation extra-argument`. It runs only the
selected task; it does not reconcile the files. See [tasks](tasks.md) for working
directories, environment variables, Node task bootstrap, and argument placement.

## 4. Save the reproducible inputs

Keep `workstation.config.ts`, its imported files, and `workstation.lock` in your
setup repository. Do not commit private ownership state. To inspect this
configuration from another directory, use an absolute entry-point path:

```sh
workstation --config /absolute/path/workstation-demo/workstation.config.ts status
```

The default state namespace uses the configuration path and machine selector.
Moving this checkout changes that identity unless you deliberately preserve it;
see [moving a configuration](workflows.md#move-or-rename-a-configuration).

## 5. Remove the demo resources

Change `resources` to `[]`, keeping a valid `defineConfig` object, then run:

```sh
workstation plan
workstation build
workstation status
```

Unchanged owned JSON/JSONC files are removed. If the initial build replaced
existing files, their originals are restored instead. Dotenv merge removes its
managed keys and retains the file, including unrelated content. Empty parent
directories may remain. Removing a declaration from TypeScript alone does not
change the machine; the next build performs removal or forget actions.

## Next: install development tools

Add `tools` to the imports and add these entries to `resources`:

```ts
// Add inside resources; import tools from @dovocode/workstation.
tools.mise({ node: "lts", pnpm: "12.3.4" }),
files.mise("~/.config/mise/config.toml", { node: "lts", pnpm: "12.3.4" }),
```

`build` can bootstrap mise and then install the resolved versions. A first `plan`
requires mise to exist already. The generated mise file replaces existing global
mise settings, so include settings you want to keep before applying it. Configure
shell activation using the [shell guide](shells.md), then use the
[upgrade workflow](workflows.md#upgrade-packages-or-refresh-only-the-lock).
