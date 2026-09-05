# Getting started

## Prerequisites

- macOS or Linux; Node.js 22.13 or later for the JavaScript CLI.
- This package's pinned pnpm, invoked through Corepack.
- The package managers used by your configuration must already be available
  on PATH: mise, Homebrew, or APT. Workstation does not bootstrap them itself.
- Build tools required by custom executables must be available when their build runs.

The source package is built locally; this repository does not imply an npm release.
The following commands run from the repository root:

```sh
corepack pnpm install
corepack pnpm build
node dist/cli.js --help
```

## Your first configuration

Run `workstation init` to create `workstation.config.ts` in the current directory.
Use `workstation init --config setup/workstation.config.ts` for a custom path;
missing parent directories are created. Existing files and symlinks are never
overwritten. Initialization does not install dependencies, execute configuration,
or create a lock, manifest, or ownership state. The starter uses a type-only
import; make the package available in your project for editor types and helpers.

The starter includes empty shared and machine-specific resources plus a harmless
`hello` task and `hi` alias. Add resources using a default export like this:

```ts
import { defineConfig, files, tools } from "@dovocode/workstation";

export default defineConfig({
  resources: [
    tools.mise({ node: "lts" }),
    files.json("~/.config/example/settings.json", { enabled: true }),
  ],
});
```

Then execute it:

```sh
corepack pnpm workstation
```

This resolves package versions into `workstation.lock`, writes a private
resolved TOML manifest, and reconciles your machine. This repository does not contain a personal setup; create your own entry point.
Generated files overwrite by default and retain an original backup in local state.

## CLI reference

| Invocation | Behavior |
| --- | --- |
| `workstation init` | Create a starter configuration without applying it |
| `workstation init --config setup/workstation.config.ts` | Create a starter at a custom path |
| `workstation` | Execute `workstation.config.ts` in the current directory |
| `workstation --config /path/workstation.config.ts` | Use another entry point |
| `workstation --machine studio` | Override the machine name for configuration and state |
| `workstation --help` | Show help without loading or executing configuration |

Within this repository use `node dist/cli.js` in place
of `workstation` if it is not installed on PATH. Config discovery does not
walk parent directories. Unknown options fail.

Run as the target login user. APT mutations and system-scope systemd actions
invoke sudo for the individual privileged steps; do not run the entire CLI as root.

## Native executable

```sh
corepack pnpm build:native
```

The Node SEA build writes an executable for the current platform/architecture
under `dist/bin/`. It embeds Node and CLI dependencies.
Keep @dovocode/workstation available for `import ... from "@dovocode/workstation"` in
your configuration. The GitHub Actions workflow builds macOS and Linux artifacts for x64 and arm64 on native runners.
