---
title: "Configuration and machine splits"
---

# Configuration and machine splits

[Handbook](README.md) · [CLI reference](cli.md) · [Troubleshooting](troubleshooting.md)

## Composition

Every fragment may be an object, a factory receiving `Context`, or a nested
array. `false`, `null`, and `undefined` fragments and resource entries are ignored.
Factories run synchronously. Imports are ordinary TypeScript modules.

```ts
import { defineConfig, darwin, linux, machine, tools } from "@dovocode/workstation";

const common = defineConfig({ resources: [tools.mise({ node: "lts" })] });
const macos = defineConfig({ resources: [tools.brewCask(["ghostty"])] });

export default defineConfig([
  common,
  darwin(macos),
  linux({ resources: [tools.apt(["git", "jq"])] }),
  machine(["studio", "macbook"], { resources: [tools.mise(["shfmt"])] }),
]);
```

Move those fragments into modules and import them from your entry point as the
setup grows. `configure(factory)` provides a typed factory helper.
`when(boolean, resources)` conditionally includes resources, whereas `darwin`,
`linux`, and `machine` select configuration fragments.

## Context and paths

| Field | Meaning |
| --- | --- |
| `machine` | OS hostname before the first dot, or exact `--machine` override |
| `hostname` | Full OS hostname |
| `platform` | `darwin` or `linux` from the executing machine |
| `home` | Absolute home directory of the executing user |
| `configDir` | Absolute directory of the entry-point file |

Machine selection does not use the network SSID, serial number, or macOS
display name. `--machine` changes the selector, not the OS or home directory.

Relative source paths (symlinks, custom-tool sources, service programs) resolve
against `configDir`. Relative file targets resolve against `home`. `~` expands
to home and absolute paths remain absolute. Imported fragments share the entry
point's base directory, not the importing file's directory.

## Overrides

Declarations are processed in order. The last declaration with an identical
resource ID wins; objects are not deep-merged. File-like resources use the
resolved target path as their ID. Packages use manager and name; services use
their label or scope and unit name.

```ts
import { defineConfig, files } from "@dovocode/workstation";

export default defineConfig([
  { resources: [files.json("~/.config/app.json", { theme: "light" })] },
  { resources: [files.json("~/.config/app.json", { theme: "dark" })] },
]);
```

You can also use `machines: { studio: [...] }` inside a fragment. Shared
resources come before that fragment's machine resources. Later manager and
`stateFile` settings override earlier settings.

```ts
import { defineConfig, tools } from "@dovocode/workstation";

export default defineConfig({
  managers: { darwin: "brew", linux: "apt" },
  resources: [tools.system(["git", "jq"])],
  stateFile: "~/.local/state/workstation/state.json",
});
```

Keep the state path stable: it contains ownership and original-file backups.
Omit `managers.linux` to detect APT, DNF, YUM, or pacman from PATH (in that order).
Use `linux: "dnf"`, `linux: "yum"`, or `linux: "pacman"` to select explicitly.
Flatpak is an additional app backend, not a system-manager detection candidate.
Use `linux(...)` for Flatpak/pacman declarations and `darwin(...)` for MAS.
The state belongs to one machine selector and rejects a different selector.

## Commands after reconciliation

`afterApply` accepts an array of commands declared with `task(...)`. They run
in order after successful `build` and `upgrade` commands, including no-change
runs. Imported fragments append hooks rather than replacing them. See
[post-apply scripts](tasks.md#post-apply-scripts) for execution and failure behavior.

## Dependencies and resource IDs

Resources accept `dependsOn` to name prerequisites. Dependencies affect apply
ordering and keep dependent packages out of the same native batch. Generated
services and checked provision operations react when dependencies change.
Unknown IDs and cycles fail before build mutation.

```ts
import { configure, defineConfig, files, systemdService, linux } from "@dovocode/workstation";

export default defineConfig(linux(configure(({ home }) => ({ resources: [
  files.json("~/.config/example/settings.json", { port: 3000 }),
  systemdService("example", {
    program: "/usr/local/bin/example",
    args: ["--config", `${home}/.config/example/settings.json`],
    dependsOn: [`file:${home}/.config/example/settings.json`],
  }),
] }))));
```

This template assumes the example executable is installed. Package and file IDs
can be read from a plan, status, or `resourceId` on resolved resources.

| Resource | Resolved ID example |
| --- | --- |
| mise tool | `package:mise:node` |
| Scoped npm tool via mise | `package:mise:npm:@example/cli` |
| Homebrew formula/cask | `package:brew:jq` / `package:brew-cask:ghostty` |
| Flatpak | `package:flatpak:user:org.mozilla.firefox:stable` |
| Mac App Store app | `package:mas:497799835` |
| Generated file, symlink, custom tool, provision copy | `file:/absolute/target/path` |
| LaunchAgent | `launch-agent:dev.example.worker` |
| systemd unit | `systemd-service:user:example.service` |
| Other provision operation | `provision:vendor-repository` |

`tools.system` resolves to the actual backend before identity is calculated.
Flatpak remote is declaration metadata, while scope and branch are part of the ID.
Copy provisions use the destination ID, not `provision:<name>`.

## Stable identities for new setups

```ts
import { defineConfig } from "@dovocode/workstation";

export default defineConfig({
  id: "personal-workstation",
  resources: [],
});
```

An `id` accepts letters, numbers, underscores, dots, and hyphens and replaces the
entry-point path as the input to default state namespacing. Machine selection
still separates state. An explicit `stateFile` takes precedence. Adding or changing
an ID on an existing setup changes its default state location; preserve the old
state explicitly before moving a managed configuration. See [migration](workflows.md#move-or-rename-a-configuration).
