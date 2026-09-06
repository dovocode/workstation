# @dovocode/workstation

Declare your workstation in TypeScript. Install packages through mise,
Homebrew, APT, DNF, YUM, pacman, Flatpak, or the Mac App Store; generate configuration and shell files; manage services;
build custom tools; and run named tasks.

The package is `@dovocode/workstation`. The executable is **`workstation`**.
See [CHANGELOG.md](CHANGELOG.md) for release changes and known issues.

On macOS, Homebrew and mise are recommended. On Linux, install mise and use
your distro's APT, DNF, YUM, or pacman; `tools.system(...)` detects the available backend.
See [setup and installation instructions](docs/getting-started.md).

## Build from source

```sh
git clone https://github.com/dovocode/workstation.git
cd workstation
corepack pnpm install --frozen-lockfile
corepack pnpm build
node dist/cli.js --help
```

This repository contains the reusable package only. It does not contain a
personal workstation configuration. Create `workstation.config.ts` in your
own setup project and make this package available there (for local development,
use a pnpm link or a tarball produced by `pnpm pack`). No npm release is implied
by the GitHub repository.

Run `workstation init` in your setup project to create a typed starter with
empty resources, machine sections, and an example task and alias. It never
overwrites an existing file or applies your setup. Use
`workstation init --config setup/workstation.config.ts` for another location.

```ts
import { defineConfig, files, jsonc, task, tools } from "@dovocode/workstation";

export default defineConfig({
  resources: [
    tools.mise({ node: "lts" }),
    files.jsonc("~/.config/example/settings.jsonc", jsonc.object([
      jsonc.comment("Shared preferences"),
      jsonc.property("theme", "dark"),
    ])),
  ],
  tasks: { test: task("pnpm", ["test"], { description: "Run tests" }) },
  aliases: { t: "test" },
});
```

```sh
workstation                 # Execute the declared setup
workstation --verbose       # Include raw inspection and version-query output
workstation --list-tasks
workstation t -- --watch    # Run only the named task
```

Generated files overwrite by default, retaining originals in private state
for restoration. Existing matching resources are adopted rather than owned.
The committed `workstation.lock` records package versions per machine.
Compatible package operations run in native batches, with each result verified
and saved individually. See [batching and recovery](docs/operations.md#native-package-batches).

Runs report configuration loading, version resolution, resource inspections,
commands with exit codes and elapsed time, and completed actions. Package changes
and tasks stream their output live. Use `--verbose` (`-v`) to also show raw query
output. Embedded `ProcessRunner` usage stays silent unless logging is enabled.

## Documentation

- [Full usage guide](docs/README.md)
- [Tasks and aliases](docs/tasks.md)
- [Configuration and machines](docs/configuration.md)
- [Locks and recovery](docs/operations.md)

Run `corepack pnpm run docs` and open `dist/docs/index.html` for the generated
API reference and guides. `corepack pnpm check` and `corepack pnpm test` validate
the package without applying a workstation configuration.

## Native binaries

GitHub Actions builds Linux and macOS executables for x64 and arm64. Download
the artifact for your platform from a successful build, extract it, and make
the executable available as `workstation` on PATH. Artifact archives may need
`chmod +x` after extraction. macOS builds are ad-hoc signed, not notarized.
The config's package import must still resolve in its project.

To build locally: `corepack pnpm build:native`. Outputs are under `dist/bin/`.
