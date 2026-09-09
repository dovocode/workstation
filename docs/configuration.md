# Configuration and machine splits

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
