# Changelog

## Unreleased

- Move the documentation website to Docusaurus with an ordered learning path, local search, complete developer-workstation walkthrough, conceptual guidance, focused resource recipes, and redirects for existing links.

- Publish the searchable handbook and API reference on GitHub Pages with guide navigation, responsive styling, and light/dark themes.

- Expand the documentation into a linked handbook with a first-run tutorial, feature recipes, operational workflows, embedded API examples, and troubleshooting; correct outdated lock, task, service, and ownership guidance.

## 0.6.2 — 2026-09-11

- Allow upgrades of adopted APT packages after refreshing their pins, while preserving their protection from automatic uninstall when removed from configuration.

## 0.6.1 — 2026-09-11

- Verify Homebrew tap trust using structured tap metadata, fixing repeated setup failures for trusted custom tap URLs such as omlx.

## 0.6.0 — 2026-09-11

- Refresh selected APT/Homebrew metadata before upgrade pin resolution; stop on refresh failures.
- Add managed setup resources with shared build and upgrade reconciliation.
- Serialize full builds and lock updates; journal pending ownership and detect configuration overlap.
- Render POSIX profiles, validate shell syntax and activate exact mise pins.
- Inspect service runtime and custom-tool drift; refresh greedy pins only on explicit upgrade.
- Unify first-time setup and normal builds under build, including prerequisite installation in the embedded API.


## 0.4.1 — 2026-09-09

- Resolve npm dist-tags such as `nightly` and `next` through npm registry metadata
  before locking an exact version for mise, including scoped packages and
  registry authentication. Bootstrap Node.js/npm when needed by the native CLI.

## 0.4.0 — 2026-09-08

- Target the running installation during self-update: resolve native symlinks,
  preserve npm prefixes, verify pnpm global package paths, and reject local,
  linked, or unrecognized installations instead of blindly installing with npm.
  Cover curl/wget installs and manually placed or renamed native binaries at
  arbitrary paths, including symlink chains and failed-download validation.

- Add `workstation upgrade [IDs]` to refresh all or selected package pins and
  reconcile the workstation in one command.

## 0.3.0 — 2026-09-07

- Allow built-in configuration helpers without installing the Workstation package:
  the CLI supplies its bundled API only when no local package resolves. Preserve
  installed-version precedence and require explicit installation of third-party imports.
- Verify standalone native builds and convergence without Node or pnpm on PATH.

## 0.2.2 — 2026-09-07

- Automatically recreate symlinks pointing to a different source, including broken
  links, while preserving adopted ownership and protecting regular files/directories.
- Repair broken symlinks even when their normalized path matches the source, such
  as links traversing a removed `mise/../` directory.

## 0.2.1 — 2026-09-07

- Fix native config loading when runtime imports reach external Jiti or other native
  ESM dependencies. Preserve asynchronous imports and top-level await.
- Test runtime library imports, nested TypeScript and asynchronous external ESM
  against the actual native binary on every release platform.

## 0.2.0 — 2026-09-07

- Resolve Fallow dead-code, duplication and complexity findings without relaxing
  thresholds or suppressing the backlog. Use fresh measured coverage for quality checks.
- Split CLI dispatch, validation, planning, package batching, migration and recovery
  into documented helpers; preserve checkpoint and ownership behavior.
- Add isolated CLI, service-state validation, bootstrap and self-update execution tests.
- Add nested Workstation build/plan tasks for Docker, Docker Sandboxes and Microsandbox.
- Document architecture, CLI contracts, extension workflows and quality checks.

- Add typed Docker/Compose, Docker Sandboxes (`sbx`), and Microsandbox (`msb`)
  lifecycle task helpers for CLI configurations and embedded clients.

- Add a typed embedded client for file-based or inline definitions, planning,
  builds, pin refresh, status, diagnostics, history, rollback and task execution.

- Add explicit all/selected lock refresh and rollback of exactly pinned mise updates
  with installed-state checks and prior-version availability preflight.

- Add read-only status against recorded pins, executable diagnostics, backend
  capability descriptions, and a configuration-free `--version` command.

- Add literal dotenv merging with private permissions, comment preservation,
  duplicate-key rejection and guarded restoration of declared keys.

- Add `files.inject` and the `inject` policy for replacing marked sections and
  restoring their original content without overwriting the surrounding file.

### Changed

- Reduce default logging to phase progress, inspection counts, actions, and live
  mutation output; retain command traces and detailed inspections with `--verbose`.
- Resolve versions and inspect desired resources with four concurrent reads,
  preserving result order and draining active reads before reporting failure.

### Added

- Add `workstation update` for atomic native-binary self-updates and global npm
  CLI updates.
- Add `workstation build` as the explicit command for the full reconciliation flow;
  bare `workstation` now displays help.

## 0.1.2 — 2026-09-06

### Added

- Bootstrap Homebrew and mise when required by configured resources, and bootstrap
  pinned Node.js and pnpm versions when a selected task requires them.
- Document native installation with curl and wget, and publish all four native
  platform binaries as GitHub release assets on version tags.

## 0.1.1 — 2026-09-06

### Changed

- Require Node.js 26.8.1 or later; pin development and CI to 26.8.1 and target
  Node.js 26 for native builds.
- Upgrade pnpm to 12.3.4 and Node.js typings to 26.4.1; refresh the lockfile.
- Migrate esbuild's existing build-script approval to pnpm's `allowBuilds` setting.

### Added

- DNF and YUM package backends with exact RPM pins and upgrade/downgrade support.
- pacman package management and Linux system-manager detection for APT, DNF, YUM,
  and pacman.
- Flatpak applications with installation scope, remote, branch, and commit pins.
- Mac App Store applications through `mas`, using numeric IDs and available updates.
- Automatic native batches for compatible package installs, upgrades, and removals,
  with per-package verification and checkpointing after partial failures.
- Guarded mise-to-Homebrew cask migration for apps, fonts, and supported binary
  symlinks, retaining backups and adopted ownership.
- Command progress, execution timings, streamed mutation output, and `--verbose`
  / `-v` for raw inspection output.
- Setup instructions for recommended macOS and Linux package managers, backend
  limitations, batch recovery, migration, and disposable-container integration tests.

### Fixed

- Locked Homebrew cask upgrades include auto-updating casks and avoid auto-refreshing
  metadata between pin validation and installation.
- Version mismatches report expected and installed versions instead of a generic
  success-but-mismatch error.
- Recognized mise receipts no longer appear as broken Homebrew installations,
  including JetBrains Mono Nerd Font, 1Password CLI, and Zed's bundled CLI.

### Known issues

- Migrating 1Password CLI or Zed can leave dangling mise completion symlinks.
  Homebrew reports successful package installation but warns that shell-completion
  generation failed. Completion-link repair remains outstanding.
- Cask migrations and Flatpak commit-pinned updates run individually rather than
  in native batches. Unsupported migration layouts require manual intervention.

## 0.1.0

### Added

- Initial public TypeScript workstation configuration package and CLI.
- mise, Homebrew, Homebrew cask, and APT package management.
- Generated configuration files, symlinks, custom tools, and macOS/Linux services.
- Machine-specific configuration, named tasks, package locks, ownership tracking,
  and backup-based file restoration.
