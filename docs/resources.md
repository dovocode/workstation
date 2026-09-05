# Resource declarations

## Packages

```ts
import { tools } from "@dovocode/workstation";

tools.mise({ node: "lts", go: "latest" });
tools.brew(["git", "jq"]);
tools.brewCask(["ghostty"], { greedy: true, force: true });
tools.apt(["git", "jq"]);
tools.system(["git", "jq"]);
```

Put declarations in a configuration's `resources` array. `system` selects the
configured platform backend, defaulting to Homebrew on macOS and APT on Linux.
Only mise accepts version selectors in declarations. `force` affects a cask
upgrade command; it does not independently trigger an upgrade.

## Symlinks

```ts
import { symlink } from "@dovocode/workstation";

symlink("dotfiles/common/git/gitconfig", "~/.gitconfig");
```

Sources must exist. Targets use home-relative paths. Existing matching links
are adopted; conflicting regular files or different links cause an error.
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
