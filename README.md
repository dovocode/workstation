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
Built-in config imports from `@dovocode/workstation` work without running
`pnpm install`; the CLI supplies its bundled API when no local package resolves.
Third-party config packages remain explicit project dependencies.
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
workstation                 # Show help
workstation build           # Reconcile the declared setup
workstation update          # Update Workstation itself
workstation upgrade         # Refresh package pins and apply updates
workstation build --verbose # Include raw inspection and version-query output
workstation --list-tasks
workstation t -- --watch    # Run only the named task
```

Generated files overwrite by default, retaining originals in private state
for restoration. Existing matching resources are adopted rather than owned.
The committed `workstation.lock` records package versions per machine.
Compatible package operations run in native batches, with each result verified
and saved individually. See [batching and recovery](docs/operations.md#native-package-batches).

Runs report configuration loading, version resolution, inspection counts, planned
changes, and a final result. Package changes and tasks stream their output live.
Use `--verbose` (`-v`) for individual inspections, command traces, exit timings,
and raw query output. Embedded `ProcessRunner` usage stays silent unless logging
is enabled. Independent version queries and desired-resource inspections run
with up to four concurrent reads; mutations retain their dependency ordering.

`workstation update` checks the latest GitHub Release. A native installation
downloads the matching platform binary, verifies that it starts, and atomically
replaces the resolved executable path, preserving symlinks. This includes the
curl/wget installation above and binaries manually placed or renamed anywhere else.
Run `/custom/path/workstation update` to update that specific copy; no PATH entry
or fixed installation directory is required. The executable's directory must be
writable by the user running the update.
For JavaScript installations, it verifies the running CLI's location first:
npm updates use an explicit `--prefix` for the existing global installation;
pnpm updates use `pnpm update --global --latest @dovocode/workstation` only when
the global inventory matches the running CLI. Local dependencies, source checkouts,
linked packages, and unrecognized installations stop with instructions to use their
owning project or package manager. There is no fallback to a global npm install.

`workstation build` performs the complete lock, manifest, plan, and reconciliation
flow. Running `workstation` without a command displays help.

## Managed setup

See [managed setup, shell activation and interruption recovery](docs/managed-setup.md).
`workstation build` installs missing prerequisites and applies the complete setup.

## Documentation

Read the **[documentation website](https://dovocode.github.io/workstation/)**, or
start with the [Workstation handbook](docs/README.md), including a feature index
and guides for both the CLI and TypeScript API.

- [First-run tutorial](docs/tutorial.md): a complete configuration you can try without installing packages.
- [Everyday workflows](docs/workflows.md): multiple machines, upgrades, migrations, removal, and rollback.
- [Files](docs/files.md), [shells](docs/shells.md), and [provisioning recipes](docs/provisioning.md): practical examples and policy choices.
- [Embedded API](docs/embedding.md): integration, custom runners, and isolated tests.
- [Troubleshooting](docs/troubleshooting.md): symptoms, diagnostics, and recovery steps.
- [Docker, Docker Sandboxes, and Microsandbox task integration](docs/environments.md)

### Use inside a TypeScript codebase

```ts
import { createWorkstation, files } from "@dovocode/workstation";
import { fileURLToPath } from "node:url";

const workstation = createWorkstation({
  configPath: fileURLToPath(new URL("./workstation.config.ts", import.meta.url)),
  onAction: action => console.log(action.type, action.id),
});

const actions = await workstation.plan(); // no state/lock writes
await workstation.build({ frozen: true, noRemove: true });
const status = await workstation.status();
```

Or supply an inline definition with `config: { resources: [...] }`. Its `configPath`
provides the lock location and state identity without requiring a file to exist.
For example: `createWorkstation({ configPath: "/project/setup.ts", config: {
resources: [files.dotenv("~/project/.env", { PORT: "3000" })] } })`.
Targets retain the same home-relative semantics as file-based configurations.

The client also provides `updateLock(ids?)`, `doctor()`, `history()`,
`rollback(id, { apply: true })`, `task(name, args)`, and `configuration()`.
It throws errors and returns values instead of exiting the host process. Default
execution is silent; use callbacks or supply a `ProcessRunner` with logging enabled.
Pass `runner` for a custom execution boundary and `context` with inline definitions
for isolated tests. `build()` and `upgrade()` install missing prerequisite managers
automatically, just like the CLI; planning never does. `configPath` should be absolute for predictable project
integration. The JavaScript package still requires its declared Node.js version.

### Dotenv files

```ts
files.dotenv("~/projects/app/.env", {
  PORT: "3000",
  APP_ENV: "development",
});
```

Dotenv defaults to `merge` and private `0o600` permissions. It preserves unrelated
keys, comment lines, inline comments and LF/CRLF endings. Values are literal:
no shell execution or variable expansion occurs. This initial dialect accepts
single-line strings without single quotes or NUL; unsupported quoting and duplicate
keys are rejected. Omitted keys are left untouched. Removal restores declared keys
from the original backup and preserves unrelated edits; changed managed keys block
restoration. A newly created dotenv file is retained after its managed keys are
removed. Existing snapshot/backup files may contain plaintext values; secret-provider
integration and encrypted backups remain future work.

### Planning and pinned builds

`workstation --version` prints the installed CLI version. `workstation status`
checks resources against recorded pins and reports untracked declarations, changes,
drift, removed declarations, and inspection errors. It does not resolve new pins.
`workstation doctor` checks required commands on PATH and prints backend pin and
recovery limitations; it does not install or execute managers. Both commands return
a nonzero status for detected drift/errors or missing commands respectively.
Use `workstation --config PATH status` (or `doctor`) for another configuration.
The exported `packageCapabilities` table describes current backend support; it is
informational and does not itself enable new rollback operations.

`workstation plan` performs inspections without bootstrapping tools or writing locks,
manifests, or state. Required package managers must already be available. Configuration
files are executable TypeScript, so their own side effects cannot be prevented.
`workstation build --frozen-lockfile` requires unchanged existing pins, including
greedy casks. `workstation build --no-remove` refuses a plan containing removals.

Default state is now scoped by configuration path and machine below
`~/.local/state/workstation/configs/`. Existing global state is not automatically
migrated. To continue using existing ownership and original-file backups, explicitly
set `stateFile: "~/.local/state/workstation/state.json"` in the original configuration
only. Moving a configuration changes its default namespace. Each build with actions
saves its preceding state and desired manifest in a private `history` directory.
Snapshots may contain sensitive configuration or original-file contents.

`workstation history` lists snapshots. `workstation rollback RUN` previews restoring
updates to previously managed generated files; add `--apply` to execute. Place
`--config PATH` before the rollback command when selecting a configuration.
Rollback refuses external edits, unrelated drift, unsupported package changes, creation/removal,
injection changes, and policy changes. It does not rewrite your source configuration
or lock: update those separately before your next build. State preconditions are
rechecked under the apply lock, and rollback itself creates a recovery snapshot.

Exactly pinned mise updates are also supported by rollback. Both versions must be
recorded; the newer pin must still match, and the prior version must be installed
or resolvable to the exact same version. Other managers remain unsupported for
snapshot rollback. This restores installations, not application data or activation.

Upgrade configured packages and reconcile the workstation in one command:

```sh
workstation upgrade
# Refresh only selected package pins, then reconcile:
workstation upgrade package:mise:node package:brew:jq
```

Version selectors still apply; exact versions remain pinned. Unselected unchanged
pins are retained. Like `build`, this reconciles the full configuration, including
files and removals; use `--no-remove` to reject plans containing removals.
Supports `--config PATH`, `--machine NAME`, and `--verbose`.
`--frozen-lockfile` is incompatible with upgrading.

Refresh locks without installing with `workstation lock update`, or select resources:
`workstation lock update package:mise:node package:brew:jq`. Then apply with
`workstation build --frozen-lockfile`. Unknown IDs fail before querying. Unselected
unchanged pins are retained, including greedy casks; new or changed declarations
still require resolution. Required managers must already exist.

Use `files.inject` to manage part of an existing file:

```ts
files.inject("~/.zshrc", '\nexport EDITOR="zed"\n', {
  start: "# BEGIN WORKSTATION",
  end: "# END WORKSTATION",
});
```

The `inject` policy replaces only the text between exactly one existing pair of
markers. Include desired newlines in the injected content. Missing, duplicate,
or reversed markers fail without writing. Surrounding text and existing permissions
are preserved (an optional fourth argument can specify `mode`). On removal,
the original section is restored without reverting edits outside the markers.
As with other file resources, declare each target only once.

- [Full usage guide](docs/README.md)
- [CLI command reference](docs/cli.md)
- [Architecture and maintenance](docs/architecture.md)
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
Built-in config imports use the bundled API when no local package resolves;
third-party imports require explicit project dependencies.

To build locally: `corepack pnpm build:native`. Outputs are under `dist/bin/`.
