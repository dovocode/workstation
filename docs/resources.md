---
title: "Packages and runtimes"
sidebar_label: Packages & runtimes
---

# Packages and runtimes

Install a package when the native backend can own its lifecycle. Use mise for
versioned runtimes and supported developer tools; use the OS manager for distro
packages and application backends for desktop apps. A single setup can use several
backends, but each declared package has one manager and ownership identity.

## Packages

```ts
import { tools } from "@dovocode/workstation";

tools.mise({ node: "lts", go: "latest", "npm:t3": "nightly" });
tools.brew(["git", "jq"]);
tools.brewCask(["ghostty"], { greedy: true, force: true });
tools.apt(["git", "jq"]);
tools.dnf(["git", "jq"]);
tools.yum(["git", "jq"]);
tools.pacman(["git", "jq"]);
tools.flatpak(["org.mozilla.firefox"]);
tools.mas([497799835]); // Xcode; acquire it in the App Store first
tools.system(["git", "jq"]);
```

Put declarations in a configuration's `resources` array. `system` selects the
configured platform backend, defaulting to Homebrew on macOS and detecting
APT, DNF, YUM, then pacman on PATH on Linux. Set `managers: { linux: "dnf" }`,
`managers: { linux: "yum" }`, or `managers: { linux: "pacman" }` to choose explicitly. Package names must match
the chosen distribution's repositories; Workstation does not translate names.
Only mise accepts version selectors in declarations. `force` affects a cask
upgrade command; it does not independently trigger an upgrade.

Npm dist-tags such as `latest`, `next`, and `nightly` are resolved with
`npm view <package>@<tag> version --json`, honoring npm registry and authentication
configuration. The lock records the exact returned version, and mise installs
that version. Scoped npm package names are supported. Node.js and npm are
bootstrapped through mise when needed for tag resolution, including native CLI
invocations. Numeric version selectors and non-npm tools keep mise resolution.

Compatible packages automatically install, upgrade, and uninstall in native
batches, with per-package verification and ownership tracking. No extra helper
or flag is required; see [batch behavior and recovery](operations.md#native-package-batches).

### Backend capabilities

| Backend | Pin behavior | Bootstrap during build | Important limit |
| --- | --- | --- | --- |
| mise | Exact resolved version | Yes | Snapshot rollback needs the old exact version available |
| Homebrew formula | Available tap version | Yes | Arbitrary historical downgrades unsupported |
| Homebrew cask | Available cask version; some remain unpinned | Yes | `greedy` affects explicit upgrades; no snapshot rollback |
| APT | Exact available repository version | No | Repository must retain the pin |
| DNF / YUM | Exact RPM version including epoch/release/architecture | No | Available-version downgrade supported; no snapshot rollback |
| pacman | Available sync-database version | No | No AUR, archive downloads, or automatic full upgrade |
| Flatpak | OSTree commit | No | Fresh install needs the remote's current commit to match |
| MAS | No version pin | No | Account must already have acquired the app |

`packageCapabilities` exports the corresponding machine-readable information.
Frozen builds validate recorded declarations/pins, but cannot give MAS or
unpinned casks historical-version support. `tools.system` chooses a backend;
it does not translate distribution-specific package names.

Use [upgrade workflows](workflows.md#upgrade-packages-or-refresh-only-the-lock)
for all or selected pins. Add repositories through [provisioning](provisioning.md)
before depending on their packages. Optional backend CLIs must exist before
version resolution; a package declaration alone does not bootstrap Flatpak or mas.

### Flatpak applications (Linux)

`tools.flatpak` accepts exact application IDs, not search terms. Defaults are
user scope, the `flathub` remote, and the `stable` branch:

```ts
tools.flatpak(["org.mozilla.firefox"]);
tools.flatpak(["org.example.App"], {
  scope: "system",
  remote: "testing",
  branch: "beta",
});
```

The remote must already exist in the chosen installation. User installs do not
use sudo; system mutations do. Scope and branch have separate ownership identities.
An app from a different remote is a conflict, requiring an explicit migration.
Removal retains application data and does not request removal of unused runtimes.

### pacman packages (Arch Linux)

`tools.pacman` accepts repository package names. AUR helpers, package groups,
and archived package downloads are not included. Queries use the existing sync
database. Run your normal `sudo pacman -Syu` before applying Workstation;
Workstation does not run `-Sy` or perform a full system upgrade automatically.

### Mac App Store applications (macOS)

`tools.mas` accepts numeric app IDs as numbers or decimal strings. Find IDs
with `mas search` or `mas list`. Workstation uses `mas install` for missing apps
and `mas upgrade <id>` for outdated ones; it never calls `mas get`/`purchase`.
Acquire free or paid apps in the App Store first and sign in with the matching
Apple Account. Installed app detection depends on Spotlight indexing.

MAS declarations follow available updates and have no version pin: the store
cannot supply an arbitrary historical version. Installed versions are recorded
in ownership state. Previously installed apps are adopted and retained if their
declaration is removed; owned apps use `mas uninstall <id>` on removal.
See the [mas documentation](https://github.com/mas-cli/mas) for account requirements.


## A practical package lifecycle

1. Add a package to the relevant platform fragment.
2. Run `plan` if the required manager/repository already exists, then `build`.
3. Confirm the resource with `status` and the tool's own version command.
4. Review and commit the resulting lock alongside the declaration.
5. Use `upgrade package:MANAGER:NAME` when you intend to refresh its pin.
6. Remove its declaration and review a plan when you no longer want it managed.

A fresh first build can bootstrap mise/Homebrew, but not every optional backend.
A pinned install does not automatically activate a runtime in your terminal.
Pair mise declarations with [generated activation](shells.md).

If an installed package is adopted, removal normally leaves it installed. Some
backends permit adopted updates without taking removal ownership; others reject
updates that require an explicit migration. Read the reported plan before changing
ownership. [Operations](operations.md) explains pin availability and removal limits.

## Other resource types

### Symlinks

Use [tracked dotfiles](files.md#link-tracked-dotfiles) for live source links.

### Generated configuration files

Choose a [file policy](files.md#pick-the-existing-file-policy) before replacing
an existing document or adopting app-managed settings.

### JSONC with comments

Use the [JSONC document builder](files.md#jsonc-with-comments) for ordered comments
and nested objects/arrays.

### Custom tools

Follow the [custom executable tutorial](custom-tools.md) for source hashing,
staged builds, compiler dependencies, and drift detection.

### Shell configuration

Follow [shells and activation](shells.md) to select startup files, render typed
statements, and keep installed runtime versions aligned with active ones.
