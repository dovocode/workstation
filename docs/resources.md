# Resource declarations

## Packages

```ts
import { tools } from "@dovocode/workstation";

tools.mise({ node: "lts", go: "latest" });
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

Compatible packages automatically install, upgrade, and uninstall in native
batches, with per-package verification and ownership tracking. No extra helper
or flag is required; see [batch behavior and recovery](operations.md#native-package-batches).

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

## Symlinks

```ts
import { symlink } from "@dovocode/workstation";

symlink("dotfiles/common/git/gitconfig", "~/.gitconfig");
```

Sources must exist. Targets use home-relative paths. Existing matching links
are adopted; broken links or links pointing to a different source are
recreated automatically. Pre-existing links remain adopted after replacement.
Regular files and directories are never overwritten. Missing replacement sources
leave existing links intact. Removing a declaration still refuses to delete an
owned link redirected outside Workstation.
Symlinks share live source content, so changing a linked source file does not
require recreating the link. Existing-file overwrite policies apply to generated
files, not the symlink helper.

## Generated configuration files

Use `files.toml`, `files.yaml`, `files.json`, or `files.jsonc` with ordinary
typed JavaScript values:

```ts
import { files } from "@dovocode/workstation";

files.toml("~/.config/example/config.toml", { server: { port: 3000 } });
files.yaml("~/.config/example/config.yaml", { enabled: true });
files.json("~/.config/example/config.json", { enabled: true });
files.jsonc(
  "~/.config/example/config.jsonc",
  { enabled: true },
  { mode: 0o600 },
);
```

`ifExists` is `overwrite` by default: an unmanaged regular file or symlink is
backed up in private state and restored if the resource is later removed.
`update` rejects unmanaged differences while updating owned files, and `ignore`
preserves any existing file.

## JSONC with comments

Use `jsonc` commands when comments and line order are part of the configuration:

```ts
import { files, jsonc } from "@dovocode/workstation";

files.jsonc("~/.config/editor/settings.jsonc", jsonc.concat(
  jsonc.comment("Shared editor settings"),
  jsonc.object([
    jsonc.comment("Appearance"),
    jsonc.property("theme", "dark"),
    jsonc.blank(),
    jsonc.comment("Editor behavior"),
    jsonc.property("editor", jsonc.object([
      jsonc.property("font_size", 14),
      jsonc.property("format_on_save", true),
    ])),
    jsonc.property("extensions", jsonc.array([
      jsonc.comment("Required on both machines"),
      jsonc.value("typescript"),
    ])),
  ]),
));
```

`concat` joins commands by lines and requires one root value. `object` accepts
properties; `array` accepts values. Both support comments, blank lines, and
nested groups. `false`, `null`, and `undefined` groups are ignored; use
`jsonc.value(null)` for a JSON null value. Ordinary objects and arrays also work
as property values. Quoting, indentation, and commas are automatic.

These commands build text; they do not execute shell commands. Comments are
preserved through locking, manifest serialization, and reconciliation.
The usual overwrite/backup policy applies. Existing comments are replaced by
the declared document rather than merged.

## Custom tools

Custom source trees can build an executable without invoking a shell:

```ts
import { customTool } from "@dovocode/workstation";

customTool("keyhold", {
  source: "tools/keyhold",
  target: "~/.local/bin/keyhold",
  build: {
    command: "mise",
    args: [
      "exec", "--", "go", "build", "-C", "{source}",
      "-trimpath", "-o", "{output}", ".",
    ],
  },
});
```

`{source}`, `{output}`, and `{target}` placeholders are expanded in arguments,
the optional working directory, and environment values. Workstation hashes the
source tree, rebuilds after source changes, installs atomically with executable
permissions, detects later binary changes, and only removes the exact artifact
it installed.

## Shell configuration

Zsh and Bash files are independent resources generated from the same typed
shell AST:

```ts
import { bash, shell, zsh } from "@dovocode/workstation";

zsh.zprofile([
  shell.prependPath(shell.home(".local/bin")),
  shell.export(
    "SSH_AUTH_SOCK",
    shell.home("Library/Caches/keyhold/agent.sock"),
  ),
  shell.when(shell.condition.commandExists("mise"), [
    shell.eval(shell.command("mise", ["activate", "zsh", "--shims"])),
  ]),
  shell.source(shell.home(".orbstack/shell/init.zsh"), { ifExists: true }),
]);

zsh.zshenv([shell.export("EDITOR", "zed --wait")]);
zsh.zshrc([
  shell.alias("ll", "eza -lah --git"),
  zsh.setopt("SHARE_HISTORY", "AUTO_CD"),
]);

bash.bashProfile([shell.prependPath(shell.home(".local/bin"))]);
bash.bashrc([shell.alias("ll", "eza -lah --git")]);
bash.profile([shell.export("EDITOR", "code --wait")]);
```

The AST supports literals, variables, home-relative paths, concatenation,
command substitution, exports, assignments, PATH changes, aliases, guarded
conditions, command evaluation, sourcing, and nested Boolean conditions.
`shell.raw(...)` is the explicit escape hatch. Zsh-only `setopt` nodes cannot be
rendered into Bash. Shell files use the same overwrite/restore default and
optional update or ignore policies as other generated files.
