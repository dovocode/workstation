# Locks, ownership, and recovery

## Three files with different roles

| File | Purpose | Commit it? |
| --- | --- | --- |
| `workstation.lock` beside the entry point | Machine targets, declaration fingerprints, package pins | Yes |
| `config.toml` beside local state | Resolved declarations used for execution | No |
| `~/.local/state/workstation/state.json` | Ownership, installed hashes/versions, original backups | No |

The lock is not a backup or a complete machine image. Retain the source config,
imports, and local tools in Git too. Backups in state may contain private file
contents. Keep state local and preserve it when migrating the checkout path.

## Updating

Ordinary declarations reuse their pins until the declaration changes. New
declarations resolve automatically; removed declarations leave the current
machine's target. Other machine targets are preserved. Greedy Homebrew casks
refresh their pin every run; casks reporting `latest` remain unpinned.

mise installs exact locked versions. APT installs its candidate version with
an explicit version argument; the repository must still provide that version.
Homebrew checks the available version before mutation and cannot generally
recreate arbitrary historical versions. Formula revisions are included.

To intentionally refresh an unchanged package, remove its entry from the relevant
machine section of `workstation.lock`, then run Workstation and review the diff.
There is no separate update/frozen-lock CLI flag. Run one checkout at a time when
updating the shared lock and resolve Git merge conflicts before execution.

## Adoption and removal

Matching pre-existing resources are adopted. They are forgotten, not uninstalled,
when removed from the configuration. Owned resources are removed when no longer
declared. Files overwritten by Workstation retain an original backup which is
restored on removal. Generated-file mode and content changes are compared.

Changes are applied in dependency-friendly groups: service removals first,
then other removals, package installations, custom tools, files, and services.
This is fixed ordering, not a general dependency graph. A new mise version is
installed and verified before the previous owned version is removed.

Successful actions checkpoint state. This is not an all-or-nothing transaction:
if a later action fails, earlier successful actions remain. Fix the reported
problem and rerun; preserve the state file and backups.

## Troubleshooting

| Error or symptom | What to check |
| --- | --- |
| No configuration found | Run from the entry directory or pass `--config` |
| Package manager not found | Install it and make it available on PATH |
| Locked Homebrew version unavailable | Keep the installed pin or deliberately refresh its lock entry |
| Cannot update adopted resource | The existing resource is not owned; explicitly migrate it before retrying |
| Changed symlink/service/custom tool | Inspect the external modification before restoring or moving the conflicting resource |
| State belongs to another machine | Use the original machine selector or a distinct state path |
| Another run holds state.json.lock | Wait for that process; after a crash, confirm it stopped before removing the exact guard directory |
| launchctl bootstrap failure | Check the GUI login domain and executable path |
| systemctl user bus unavailable | Run within the intended user's active systemd session |

Do not delete ownership state to suppress an error: doing so loses the
information needed for managed removal and original-file restoration.
