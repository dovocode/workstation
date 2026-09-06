# @dovocode/workstation

Declare your workstation in TypeScript. Install packages through mise,
Homebrew, APT, DNF, YUM, pacman, Flatpak, or the Mac App Store; generate configuration and shell files; manage services;
build custom tools; and run named tasks.

The package is `@dovocode/workstation`. The executable is **`workstation`**.
See [CHANGELOG.md](CHANGELOG.md) for release changes and known issues.

On macOS, Homebrew and mise are recommended. Workstation installs them on demand
when the configuration needs them. On Linux it installs mise on demand and uses
your existing APT, DNF, YUM, or pacman; `tools.system(...)` detects the available backend.
See [setup and installation instructions](docs/getting-started.md).

## Install the native executable

The native executable needs no preinstalled Node.js, pnpm, mise, or Homebrew.
These commands install the latest release into `~/.local/bin` on macOS or Linux.

With curl:

```sh
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in x86_64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; esac
mkdir -p "$HOME/.local/bin"
curl -fL "https://github.com/dovocode/workstation/releases/latest/download/workstation-${os}-${arch}" \
  -o "$HOME/.local/bin/workstation"
chmod +x "$HOME/.local/bin/workstation"
```

With wget:

```sh
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in x86_64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; esac
mkdir -p "$HOME/.local/bin"
wget -O "$HOME/.local/bin/workstation" \
  "https://github.com/dovocode/workstation/releases/latest/download/workstation-${os}-${arch}"
chmod +x "$HOME/.local/bin/workstation"
```

Add the installation directory to your shell once, then verify it:

```sh
printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$HOME/.zshrc" # use ~/.bashrc for Bash
export PATH="$HOME/.local/bin:$PATH"
workstation --help
```

On macOS, if Gatekeeper blocks the unnotarized binary, explicitly remove its
download quarantine after reviewing the release you downloaded:

```sh
xattr -d com.apple.quarantine "$HOME/.local/bin/workstation"
```

## Build from source

Use Node.js 26.8.1 (pinned in `.node-version`) and pnpm 12.3.4. Install Corepack
with `npm install --global corepack` if needed; Node.js 26 does not bundle it.

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

GitHub Releases provide Linux and macOS executables for x64 and arm64. They run
without Node.js, npm, Corepack, or pnpm; selected Node-based tasks bootstrap their
pinned runtime through mise. Download
the binary for your platform and make it available as `workstation` on PATH.
The commands above automate those steps. macOS builds are ad-hoc signed, not notarized.
The config's package import must still resolve in its project.

To build locally: `corepack pnpm build:native`. Outputs are under `dist/bin/`.
