# @dovocode/workstation

Declare your workstation in TypeScript. Install packages through mise,
Homebrew, or APT; generate configuration and shell files; manage services;
build custom tools; and run named tasks.

The package is `@dovocode/workstation`. The executable is **`workstation`**.

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
workstation --list-tasks
workstation t -- --watch    # Run only the named task
```

Generated files overwrite by default, retaining originals in private state
for restoration. Existing matching resources are adopted rather than owned.
The committed `workstation.lock` records package versions per machine.

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
