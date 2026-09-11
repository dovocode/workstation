---
title: "Managed setup and recovery"
sidebar_label: "Bootstrap & managed setup"
---

# Managed setup and recovery

`build` handles both first-time setup and subsequent reconciliation. It installs
missing prerequisite managers automatically in both the CLI and embedded client.
Upgrade refreshes APT and Homebrew metadata for the selected package backends
after repository setup and before resolving all or selected package pins. Each
backend refresh runs once; a refresh failure stops pin resolution and package
installation. Ordinary builds and read-only plans do not perform this refresh.
APT uses strict update error handling, including transient download failures.
Other backends retain their existing version-query behavior; pacman still expects
the sync database from your normal full system upgrade. Greedy casks
now retain their pins on ordinary builds; greediness controls backend upgrade
behavior when an upgrade is actually requested. Backends without version pinning
(such as the Mac App Store) cannot provide a frozen historical installation.

## Setup resources

See [provisioning recipes](provisioning.md) for every operation, options,
dependencies, and complete configuration examples.

Use `provision(name, operation, dependsOn?)` for native setup operations. Supported
operations are Homebrew taps/trust, APT repositories with pinned key SHA-256 digests,
file copies/seeds, macOS preferences and signed installer packages, login lingering,
group membership, existing service activation, and checked repair commands.

```ts
import { defineConfig, provision, tools } from "@dovocode/workstation";

export default defineConfig({ resources: [
  provision("vendor-tap", { type: "brew-tap", tap: "vendor/tools", trust: true }),
  ...tools.brew(["vendor-tool"]).map(resource => ({
    ...resource, dependsOn: ["provision:vendor-tap"],
  })),
  provision("app-preferences", {
    type: "copy-file", source: "defaults/settings.json", target: "~/.app/settings.json",
    seed: true, mode: 0o600,
  }),
] });
```

Repository resources converge before package version queries. APT repositories
accept `suite: "auto"`, `architecture: "auto"`, and `{distribution}` in URI/key URL
for Ubuntu and Debian. `keySha256` is the SHA-256 digest of the downloaded
ASCII key file, **not** an OpenPGP fingerprint. Downloading and signature checks
must complete before privileged installation. The host needs curl and its normal
CA certificates. Conflicting packages are rejected rather than removed.

Dependencies use resolved resource IDs (file IDs contain absolute target paths).
Unknown references and cycles fail before build mutation. Package phases still use
native batches. Dependencies within a package phase must be kept out of the same
batch. Changes to dependencies re-run associated checks and restart generated
services. Native service readiness can lag process activation; a separate checked
resource can test an application endpoint.

Every provision mutation is inspected again before its result is saved. A `check`
operation runs its check during planning/status; checks must be read-only. Repair
commands run sequentially only when the check fails or a declared dependency changes.
`requiresFile` lets a check remain inactive until explicit user initialization creates
its prerequisite (for example a vault). Command arguments are literal vectors.
A zero exit means healthy; nonzero means repair required; spawn failures remain errors.

Provision resources are **retained** on declaration removal. Workstation forgets
management rather than removing repositories, revoking group access, uninstalling
vendor software, reverting preferences or deleting mutable user data. Existing
files replaced during copy migration have their originals recorded in private state.
Snapshot rollback does not yet support provision operations. A seed preserves an
existing regular file; `migrateSymlink: true` explicitly replaces a legacy symlink
with a regular file containing its current contents, leaving the linked source intact.

`npmHealth()` supplies a checked mise npm-package resource for executable or
node-pty smoke tests. Repairs target the installed version and are verified before
services depending on the check restart. Authentication, pairing and vault creation
remain explicit tasks.

## Shells and activation

`bash.profile()` now renders POSIX sh. Bash and Zsh interactive files retain their
own dialects. `shell.prependPath()` removes duplicate occurrences of the paths it
adds and omits empty PATH components. `shell.keepPathFirst()` registers an
idempotent interactive hook while preserving existing prompt hooks.

Use `files.mise(target, versions, settings)` with matching `tools.mise(versions)`.
It renders the exact locked package versions into the activation file, while
retaining the selectors as declaration metadata. A missing corresponding package
pin is an error. This prevents activation from selecting a different latest/LTS
version from the one Workstation installed.

Candidate generated shell files undergo syntax checks before replacement. An invalid
candidate leaves the existing file intact. The relevant sh/bash/zsh executable must
be installed. `shell.raw()` is still executable user code, not a sandbox.

## State and interrupted runs

A machine guard serializes mutations across configurations; an invocation also holds
its state guard through lock resolution, manifest writing, apply and post-apply work.
Standalone lock updates serialize their read/resolve/write operation using a sibling
guard. Locks contain owner PID and start time. They are deliberately not broken based
on a timeout: after a hard crash, inspect the recorded process and remove the stale
guard only once it has stopped. Rerun the original command afterward.

Before installation or update, `pending.json` records intended ownership and original
backups. On the next apply, Workstation re-inspects those targets and checkpoints
verified results. This prevents an interrupted creation from being silently adopted.
An ambiguous partially created target stops recovery; the target and pending journal
remain available for inspection. State checkpoints are atomic renames. This provides
process-interruption recovery, not a filesystem/power-loss transaction or package
manager rollback. Unconfirmed removals are re-inspected by ordinary reconciliation.

A machine-local claim registry detects overlap between configurations registered by
this version. It does not infer ownership from other historical state directories.
Claims remain reserved after failed builds; successful removal/forget releases them.
Ownership and backups stay in private state and must not be committed.

The optional configuration `id` provides a stable namespace for new configurations.
Do not add/change it on an existing managed setup without explicitly migrating state.
For an existing setup, keep its current `stateFile` while moving the config to retain
ownership and original backups. This migration does not silently switch your personal
setup's existing namespace. Snapshots and journals can contain plaintext secrets.
