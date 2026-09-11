---
title: "Locks, ownership, and recovery"
---

# Locks, ownership, and recovery

[Handbook](README.md) · [CLI reference](cli.md) · [Troubleshooting](troubleshooting.md)

## Storage and responsibilities

| File | Purpose | Commit it? |
| --- | --- | --- |
| `workstation.lock` beside the entry point | Machine targets, declaration fingerprints, package pins | Yes |
| `config.toml` beside local state | Resolved declarations used for execution | No |
| `~/.local/state/workstation/configs/<namespace>/state.json` by default | Ownership, installed hashes/versions, original backups | No |
| `history/` beside state | Pre-apply recovery snapshots | No |
| `pending.json` beside state | Intended ownership for interrupted actions | No |
| `~/.local/state/workstation/claims.json` | Machine-local registered resource owners | No |

The lock is not a backup or a complete machine image. Retain the source config,
imports, and local tools in Git too. Backups in state may contain private file
contents. Keep state local and preserve it when migrating the checkout path.

## Updating

Ordinary declarations reuse their pins until the declaration changes. New
declarations resolve automatically; removed declarations leave the current
machine's target. Other machine targets are preserved. Greedy Homebrew casks
refresh their pin during explicit upgrades; casks reporting `latest` remain unpinned.

mise installs exact locked versions. APT installs its candidate version with
an explicit version argument; the repository must still provide that version.
Homebrew checks the available version before mutation and cannot generally
recreate arbitrary historical versions. Formula revisions are included.

DNF and YUM pins include RPM epoch, version, release, and architecture, for
example `0:1.7.1-2.fc42.x86_64`. The backend lists the latest candidate for the
native architecture (or `noarch`); architecture-qualified names such as
`jq.x86_64` are also supported. RPM verifies installed versions and compares
pins for upgrades/downgrades. The exact pinned package must remain available
in enabled repositories. Queries run without sudo; installs, downgrades and
removals use sudo. No additional repoquery plugin is required.

pacman pins package versions from the current sync database and refuses to
install a different version when a pin is unavailable. Maintain Arch with normal
full upgrades (`sudo pacman -Syu`) and deliberately refresh affected lock entries;
Workstation does not refresh sync databases or download archived packages.

Flatpak pins full OSTree commit IDs for the declared remote, scope, and branch.
Existing deployments can update or revert to retained commits. A fresh install
requires the remote's current commit to match the lock, because Flatpak's install
command does not select historical commits. Runtime dependencies are managed by
Flatpak and are not individually pinned by Workstation.

MAS app entries have no lock version and follow available App Store updates.
Installed versions are recorded in local state. Workstation verifies completion
using `mas list` and `mas outdated`; account failures and stale Spotlight data
remain visible errors rather than being treated as successful installations.

Refresh pins with `workstation lock update [IDs...]` and review the lock diff.
Apply reviewed pins with `workstation build --frozen-lockfile`. For a combined
refresh and reconciliation, use `workstation upgrade [IDs...]`. Run one checkout
at a time when updating a shared lock and resolve Git merge conflicts before
execution. See the [upgrade workflow](workflows.md#upgrade-packages-or-refresh-only-the-lock).

## Adoption and removal

Matching pre-existing resources are adopted. They are forgotten, not uninstalled,
when removed from the configuration. Owned resources are removed when no longer
declared. Files overwritten by Workstation retain an original backup which is
restored on removal. Generated-file mode and content changes are compared.

Changes are applied in dependency-friendly groups: service removals first,
then other removals, package installations, custom tools, files, and services.
Explicit `dependsOn` resource IDs supplement phase ordering; unknown references
and dependency cycles are rejected. A new mise version is
installed and verified before the previous owned version is removed.

Successful actions checkpoint state. This is not an all-or-nothing transaction:
if a later action fails, earlier successful actions remain. Fix the reported
problem and rerun; preserve the state file and backups.

## Native package batches

Batching is automatic; keep declaring packages with the existing `tools.*`
helpers. Compatible installs, upgrades, and uninstalls in each package phase
share one native command, for example `brew install git jq` or
`sudo apt-get install -y --allow-downgrades git=<pin> jq=<pin>`.
mise upgrades install the requested exact versions together, then remove each
previous owned version only after its replacement has been verified.

Workstation groups by backend, operation, and flags. Casks and formulae stay
separate, as do different cask policies, RPM downgrades, and Flatpak scopes/remotes.
Flatpak pinned updates remain single-target because `--commit` selects one ref.
Mise-to-Homebrew migrations also run separately for individual backups/recovery.
Adoptions, files, custom tools, and service ordering remain unchanged.

Each native command receives multiple explicit targets; the package manager
controls download/install parallelism. Workstation does not launch competing
transactions against the same package database or issue untargeted upgrades.
The output shows batch membership, the command, and each package's result.

Every target is inspected after the command, even if it exits unsuccessfully.
Verified successes are checkpointed; a partially installed package retains
removal ownership with its observed version. Failed removals keep their state.
Workstation stops before the next batch after a failure. Fix the reported issue
and rerun to reconcile the remaining differences. Batches are not atomic rollback
transactions; preserve state and backups, especially after an interrupted process
or failed post-install inspection.

## Troubleshooting

### Moving mise casks to Homebrew

Declare the application with `tools.brewCask(["ghostty"])` and remove its
`"brew-cask:ghostty"` entry from your mise configuration. Remove the declaration
without uninstalling the app (`mise unuse --no-prune --path <config-file>
brew-cask:ghostty` can do this). Do not use `mise uninstall` after migration,
because both backends use the same Caskroom paths.

Font casks use the same path, for example
`tools.brewCask(["font-jetbrains-mono-nerd-font"])`. Remove the corresponding
`brew-cask:font-jetbrains-mono-nerd-font` mise declaration without uninstalling it.

On the next run, Workstation automatically recognizes versioned app/font/binary mise
casks with a schema-3 `.mise-cask.toml` receipt and no Homebrew receipt. The plan
reports `migrate from mise to Homebrew`. App staging symlinks must match their
installed bundles; copied font files must match their staged contents and reside
in a `Library/Fonts` directory. Binary and completion symlinks must resolve inside
the recognized version's staging directory or a validated app bundle reached
through that directory (for example `1password-cli`'s `op` or Zed's app CLI).
It backs up app bundles and fonts with macOS
metadata intact and moves the original cask directory into a unique
`.workstation-mise-<cask>-...` backup beside the `Caskroom` directory. The backup path
is printed before installation.

When the mise version matches the lock, Homebrew installs with `--adopt` to keep
the existing artifacts. When it differs, `--force` installs the requested version;
the original artifacts remain in the backup. Workstation verifies Homebrew's receipt
and version before recording success. Migrated pre-existing casks remain adopted,
so removing the declaration later does not uninstall them.

If installation fails, Workstation restores the original mise directory and
missing apps and fonts, and original binary/completion symlinks that are missing
or were relinked within that cask. Backups are retained on success and failure;
existing artifacts are not overwritten during recovery. Homebrew can change
other artifacts before failing, so inspect its output and the retained backups
before retrying. A crash also leaves backups at the printed path for recovery.

Unknown receipt schemas, mixed/multiple installation directories, package
installers, non-symlink binaries, changed font copies, and casks without a concrete lock version require manual migration.
Workstation does not rewrite your mise configuration automatically.

| Error or symptom | What to check |
| --- | --- |
| No configuration found | Run from the entry directory or pass `--config` |
| Package manager not found | Install it and make it available on PATH |
| Locked Homebrew version unavailable | Keep the installed pin or deliberately refresh its lock entry |
| Cannot update adopted resource | The existing resource is not owned; explicitly migrate it before retrying |
| Changed symlink during removal, service, or custom tool | Inspect the external modification before restoring or moving the conflicting resource |
| State belongs to another machine | Use the original machine selector or a distinct state path |
| Another run holds state.json.lock | Wait for that process; after a crash, confirm it stopped before removing the exact guard directory |
| launchctl bootstrap failure | Check the GUI login domain and executable path |
| systemctl user bus unavailable | Run within the intended user's active systemd session |

Do not delete ownership state to suppress an error: doing so loses the
information needed for managed removal and original-file restoration.

## Snapshot rollback

Each build with actions saves preceding ownership state and the desired manifest
under private history. `workstation history` lists identifiers for the selected
configuration; `workstation rollback RUN` previews supported restoration and
`workstation rollback RUN --apply` executes it. Place `--config PATH` before these
commands when selecting another entry point.

Rollback supports eligible updates to previously managed generated files and
exactly pinned mise tools. For mise, both versions must be recorded, the current
installation must match the newer pin, and the older exact version must still be
installed or resolvable. It restores installations, not application data or shell
activation. Other package backends, creation/removal, injection changes, policy
changes, and provision operations are unsupported.

External edits, unrelated drift, and changed state preconditions block restoration.
Apply rechecks state under its guard and creates a new recovery snapshot. Rollback
does not edit source configuration or `workstation.lock`; align those separately
before your next build. See the [rollback workflow](workflows.md#roll-back-a-supported-update)
and [troubleshooting](troubleshooting.md#rollback-is-refused-or-history-is-empty).

## Configuration identity

The default namespace hashes the absolute entry-point path (or explicit config
`id`) and machine selector. `stateFile` overrides the default. The historical
`~/.local/state/workstation/state.json` path is not automatically migrated.
Keep the original state path when relocating an existing managed setup; see
[moving a configuration](workflows.md#move-or-rename-a-configuration).

The resolved manifest, ownership backups, journal, and snapshots can contain
plaintext configuration. Keep them local and private. Retained backups are not
an encrypted secret store or a substitute for a machine backup.
