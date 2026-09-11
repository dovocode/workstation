---
title: "Shell configuration and runtime activation"
sidebar_label: "Shells & activation"
---

# Shell configuration and runtime activation

Shell helpers render startup files; the generated code runs when your shell reads
them. Workstation syntax-checks candidate files before replacement. The corresponding
`sh`, `bash`, or `zsh` executable must be available. The same overwrite, backup,
mode, and removal rules apply as for [generated files](files.md).

## Choose startup files

| Helper | When it is read | Put here |
| --- | --- | --- |
| `zsh.zshenv` | Every Zsh invocation | Minimal environment variables |
| `zsh.zprofile` | Zsh login shell | Login PATH and environment |
| `zsh.zshrc` | Interactive Zsh | Activation, aliases, prompt, completion |
| `bash.bashProfile` | Bash login shell | Login environment and explicit `.bashrc` sourcing |
| `bash.bashrc` | Interactive non-login Bash | Activation, aliases, prompt |
| `bash.profile` | POSIX login profile, subject to shell startup selection | Portable environment setup |

Bash reads the first available login profile; declaring `.bash_profile` does not
make it source `.bashrc` or `.profile` automatically. Shell choice is independent
of OS choice: Linux users can use Zsh and macOS users can use Bash.

## Activate the versions you installed

Share selectors between package declarations and `files.mise`. Workstation turns
the activation file's selectors into the same exact pins it installs:

```ts
import { defineConfig, files, shell, tools, zsh } from "@dovocode/workstation";

const versions = { node: "lts", pnpm: "12.3.4" };

export default defineConfig({ resources: [
  tools.mise(versions),
  files.mise("~/.config/mise/config.toml", versions),
  zsh.zshrc([
    shell.prependPath(shell.home(".local/bin")),
    shell.when(shell.condition.commandExists("mise"), [
      shell.eval(shell.command("mise", ["activate", "zsh"])),
    ]),
    shell.alias("ll", "ls -lah"),
    zsh.setopt("AUTO_CD", "SHARE_HISTORY"),
  ]),
] });
```

This replaces the complete `.zshrc` and global mise config, retaining original
backups. Include your other desired settings or use a marked injection region
when you want to preserve hand-edited shell content. `files.mise` requires a
matching mise package pin for every declared tool; arbitrary `files.toml` selectors
do not get this synchronization automatically.

After building, open a new terminal and check `command -v node` and `node --version`.
A build cannot change the environment of the terminal that launched it. New
prerequisites are available within that build, while future terminals need activation.

## Equivalent Bash setup

```ts
import { bash, defineConfig, shell } from "@dovocode/workstation";

export default defineConfig({ resources: [
  bash.bashProfile([
    shell.prependPath(shell.home(".local/bin")),
    shell.source(shell.home(".bashrc"), { ifExists: true }),
  ]),
  bash.bashrc([
    shell.prependPath(shell.home(".local/bin")),
    shell.when(shell.condition.commandExists("mise"), [
      shell.eval(shell.command("mise", ["activate", "bash"])),
    ]),
    shell.alias("ll", "ls -lah"),
  ]),
] });
```

This example only declares shell files; combine it with the package and mise-file
resources above if you also want Workstation to install and select runtimes.

## Expressions, guards, and custom initialization

Ordinary string values are quoted literals. Use expressions for shell-time values:

```ts
import { shell } from "@dovocode/workstation";

const statements = [
  shell.export("EDITOR", "code --wait"),
  shell.assign("cache_dir", shell.home(".cache/example")),
  shell.export("EXAMPLE_CACHE", shell.variable("cache_dir")),
  shell.export("EXAMPLE_PATH", shell.concat(shell.home(), "/projects/example")),
  shell.when(shell.condition.and(
    shell.condition.commandExists("hostname"),
    shell.condition.empty(shell.variable("EXAMPLE_HOST")),
  ), [
    shell.export("EXAMPLE_HOST", shell.capture(shell.command("hostname"))),
  ]),
  shell.source(shell.home(".config/example/init.sh"), { ifExists: true }),
  shell.unset("cache_dir"),
];
```

Pass `statements` to a startup-file helper. Conditions include `commandExists`,
`executable`, `file`, `directory`, `empty`, `nonEmpty`, `and`, `or`, and `not`.
`capture` uses command stdout as a value; `eval` interprets printed shell code.
`shell.command` accepts `{ stderr: "ignore" }` to silence that command's stderr.
`shell.raw` inserts code verbatim when typed helpers are insufficient; you remain
responsible for its dialect and effects. `zsh.setopt` is rejected for Bash/POSIX sh.

## Keep wrapper executables first on PATH

```ts
import { shell, zsh } from "@dovocode/workstation";

zsh.zshrc([
  shell.prependPath(shell.home(".local/bin")),
  shell.keepPathFirst(shell.home(".local/bin")),
]);
```

Combine these statements with your other `.zshrc` declarations. `prependPath`
removes duplicate occurrences of paths it adds and empty PATH entries.
`keepPathFirst` registers an interactive hook so environment activation cannot
permanently move wrappers behind other executables. Existing prompt hooks are
preserved. It supports Bash and Zsh, and is rejected in `bash.profile`'s POSIX sh.

## Render without writing a startup file

```ts
import { renderShell, shell } from "@dovocode/workstation";

console.log(renderShell([shell.export("EDITOR", "code --wait")], "bash"));
```

This returns shell text without applying configuration or executing the statements.
Use it for previews or integration with another file writer.
