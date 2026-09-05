# Workstation documentation

Workstation describes your machine in TypeScript and executes the setup with
one CLI command. It manages packages, symlinks, generated configuration files,
custom executables, and user or system services on macOS and Linux.

## Guides

1. [Getting started](getting-started.md): prerequisites, build, first execution, CLI options.
2. [Configuration](configuration.md): imports, conditions, machines, paths, and overrides.
3. [Resources](resources.md): packages, files, JSONC, shells, and custom builds.
4. [Services](services.md): macOS LaunchAgents and Linux systemd units.
5. [Operations](operations.md): locks, updates, ownership, removal, and recovery.
6. [Tasks and aliases](tasks.md): named commands, argument forwarding, and shortcuts.
7. [API and development](development.md): embedding helpers and generating documentation.

The generated site's API section lists public functions, options, and types
directly from source JSDoc. There are no public plan/apply/status subcommands:
running Workstation executes the declared setup.
