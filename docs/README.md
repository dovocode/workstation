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

8. [CLI reference](cli.md): commands, option placement, output and exit codes.
9. [Architecture](architecture.md): boundaries, storage, invariants and extension workflow.
10. [Environment tasks](environments.md): Docker, Docker Sandboxes and Microsandbox.

The generated API reference comes from source JSDoc. Bare `workstation` shows help;
`workstation build` applies configuration. The embedded `createWorkstation` API
supports inline or file-based definitions. The HTML roadmap is a proposal, not a
claim that every planned feature is implemented.
