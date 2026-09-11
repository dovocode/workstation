# Workstation handbook

Declare your setup in TypeScript, preview the changes, and reconcile it with
`workstation build`. Workstation manages macOS and Linux packages, configuration,
shells, custom executables, services, and verified setup operations. Named tasks
cover commands you want to run explicitly.

## Start here

1. [Install Workstation](getting-started.md) and verify `workstation --help`.
2. [Build your first configuration](tutorial.md) with a complete, file-only example.
3. [Choose your next workflow](workflows.md): add a machine, upgrade packages,
   migrate dotfiles, remove resources, or recover a failed run.
4. Use the [CLI reference](cli.md) for exact commands and the
   [troubleshooting guide](troubleshooting.md) when a check fails.

## Find a feature

| I want to… | Guide |
| --- | --- |
| Install a native binary, build from source, or update the CLI | [Getting started](getting-started.md) |
| Share configuration across machines and platforms | [Configuration and paths](configuration.md) |
| Install runtimes, command-line tools, desktop apps, or npm tools | [Packages and backend capabilities](resources.md#packages) |
| Link dotfiles or build a local executable | [Resource declarations](resources.md) |
| Generate JSON, JSONC, YAML, TOML, or private dotenv files | [Files and existing-content policies](files.md) |
| Generate Bash/Zsh profiles and activate locked mise versions | [Shell configuration](shells.md) |
| Add repositories, seed settings, install vendor packages, or repair tools | [Provisioning recipes](provisioning.md) |
| Start a background process and restart it after dependencies change | [Services](services.md) |
| Run project commands, aliases, or post-apply scripts | [Tasks](tasks.md) |
| Run Docker, Compose, Docker Sandboxes, or Microsandbox tasks | [Environment tasks](environments.md) |
| Review pins, ownership, removal, snapshots, or rollback | [Operations](operations.md) |
| Understand bootstrap, journals, guards, and configuration claims | [Managed setup](managed-setup.md) |
| Call Workstation from TypeScript or supply a custom runner | [Embedded API](embedding.md) |
| Extend, test, document, or release the package | [Development](development.md) and [architecture](architecture.md) |

## What a build does

A build loads the selected configuration, prepares required supported managers
and repositories, resolves package pins, and compares declarations with both the
machine and its saved ownership state. It applies ordered changes, verifies
results, checkpoints state, and runs declared post-apply hooks. Repeating a build
converges resources; hooks still run on successful no-change builds.

`plan` inspects without writing Workstation state or installing prerequisites.
`status` checks recorded pins. `upgrade` refreshes package pins and applies the
whole configuration. `update` updates the Workstation executable itself.

Keep configuration and `workstation.lock` in version control. Keep ownership state,
original-file backups, journals, and snapshots private and preserve them for
recovery. A lock records versions; it cannot restore arbitrary application data.

## Read online or browse offline

Read the [published handbook and API reference](https://dovocode.github.io/workstation/).
To generate the same site locally, install the pinned dependencies and generate the handbook
and public API reference:

```sh
pnpm install --frozen-lockfile
pnpm run docs
```

Open `dist/docs/index.html`. The generated reference lists every public helper,
option, and type exported by the package. The Markdown guides also work directly
in GitHub. The repository’s `docs/improvement-roadmap.html` describes proposals;
the handbook describes implemented behavior.
