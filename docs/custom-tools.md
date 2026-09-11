---
title: Build and manage custom executables
sidebar_label: Custom tools
---

Use `customTool` when you have local source code that should produce one executable.
Workstation hashes the source, builds a staged output, installs it atomically,
and records its hash. A source change triggers rebuilding; an unchanged setup
should converge without rerunning the compiler.

## Start with a working shell tool

Create `tools/hello/hello.sh` relative to your configuration entry point:

```sh
#!/bin/sh
printf 'Hello from my managed tool\n'
```

Declare it in `workstation.config.ts`:

```ts
import { configure, customTool, defineConfig, task } from "@dovocode/workstation";

export default defineConfig(configure(({ home }) => ({
  resources: [customTool("hello", {
    source: "tools/hello",
    target: "~/.local/bin/workstation-hello",
    build: { command: "cp", args: ["{source}/hello.sh", "{output}"] },
  })],
  tasks: {
    hello: task(`${home}/.local/bin/workstation-hello`, [], {
      description: "Run the installed custom executable",
    }),
  },
})));
```

```sh
workstation plan
workstation build
workstation hello
workstation build
```

The first build installs an executable with `0755` permissions. The task prints
the greeting. A repeat build should converge. Edit the message in the source,
run `plan` and `build` again, and the next invocation prints the new message.
Add `~/.local/bin` to your [shell PATH](shells.md) to call the executable directly.

## Build a compiled tool

For a Go project with a `go.mod` and main package in `tools/worker`:

```ts
import { configure, customTool, defineConfig, files, tools } from "@dovocode/workstation";

const versions = { go: "latest" };

export default defineConfig(configure(({ home }) => ({ resources: [
  tools.mise(versions),
  files.mise("~/.config/mise/config.toml", versions),
  {
    ...customTool("worker", {
      source: "tools/worker",
      target: "~/.local/bin/example-worker",
      build: {
        command: "mise",
        args: ["--cd", home, "exec", "--", "go", "build", "-C", "{source}", "-o", "{output}", "."],
      },
    }),
    dependsOn: ["package:mise:go", `file:${home}/.config/mise/config.toml`],
  },
] })));
```

This template requires real Go source. It generates the exact locked compiler
selection before building, and invokes mise from home so a source-local config
does not select a different compiler. `go build -C` then selects the source directory.
Include your other global tools in `versions` before replacing an existing mise
file. See [runtime activation](shells.md) for the installation/activation relationship.

## Understand the build contract

| Placeholder | Meaning |
| --- | --- |
| `{source}` | Absolute resolved source path |
| `{output}` | Temporary sibling path where the build must write its executable |
| `{target}` | Final installation path; useful as metadata, not the output to overwrite |

Placeholders expand in arguments, `cwd`, and `environment` values. They do not
expand in the command executable. Commands run without a shell; pass a shell
explicitly for pipelines or redirections. The build must successfully create a
regular file at `{output}`. Workstation sets executable permissions and renames
it into place. Failed builds do not count as successful installations.

## Keep builds repeatable

Source hashing includes files, directory structure, and symlink target text. It
does not apply `.gitignore`. Keep generated binaries, dependency caches, and other
mutable output outside the source tree; otherwise the build can change its own
fingerprint and trigger another rebuild.

Declare required compiler packages and use actual dependency IDs. `customTool`
does not automatically discover build tools or translate a shell command into an
activation environment. An arbitrary project-local version file can override your
global selection when a build runs there; choose `cwd` deliberately.

## Drift, removal, and limitations

An externally modified installed executable is detected against its saved hash
and blocks unsafe replacement. Investigate that change instead of deleting state.
Removing a declaration removes an owned unchanged artifact; an adopted executable
is retained according to ownership rules.

This helper manages one executable. Use a package backend for multi-file package
installations, or [provisioning](provisioning.md) for a verified retained vendor
installer. Use a named task when you simply want to run an arbitrary project build
on demand and do not need Workstation to own the output.
