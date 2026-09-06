# Changelog

User-visible changes are recorded here for each release. Add new changes under
Unreleased, then move them into a dated version section when preparing a release.

## Unreleased

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
