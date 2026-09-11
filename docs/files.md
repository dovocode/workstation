---
title: "Files, dotfiles, and existing content"
---

# Files, dotfiles, and existing content

[Handbook](README.md) · [CLI reference](cli.md) · [Troubleshooting](troubleshooting.md)

Use a generated file when TypeScript should describe its contents. Use a symlink
when a tracked source file should remain the live file. Use a provision seed when
an application should take over editing after initial setup.

All relative targets resolve under the executing user's home. Source paths resolve
from the configuration entry point. Each resolved target has one resource identity;
declaring it twice replaces the earlier declaration rather than combining policies.

## Generate a complete document

```ts
import { defineConfig, files } from "@dovocode/workstation";

export default defineConfig({ resources: [
  files.json("~/.config/example/settings.json", { theme: "dark", tabs: 2 }),
  files.yaml("~/.config/example/settings.yaml", { server: { port: 3000 } }),
  files.toml("~/.config/example/settings.toml", { server: { port: 3000 } }),
] });
```

Values are serializable data, not functions or class instances. TOML cannot
represent `null`. For comments and controlled ordering in JSONC, use the
[JSONC document builder](resources.md#jsonc-with-comments). Existing JSONC comments
are replaced by the declared document, not merged into it.

## Pick the existing-file policy

| Policy | Existing target | Typical use |
| --- | --- | --- |
| `overwrite` (default) | Save original and replace differing content | Entire configuration owned by the declaration |
| `update` | Reject unmanaged differences; update owned content | Deliberate opt-in before taking over existing files |
| `ignore` | Preserve existing content | Create a default only when absent |
| `merge` | Manage selected dotenv keys | Shared `.env` with unrelated local values |
| `inject` | Replace a unique marked region | Shared shell or application file |

Use `files.dotenv` for merge and `files.inject` for injection. These policies are
format-specific, not arbitrary deep-merge options for JSON/YAML/TOML.

```ts
import { files } from "@dovocode/workstation";

files.json("~/.config/example/private.json", { account: "development" }, {
  mode: 0o600,
  ifExists: "update",
});
```

Ordinary generated files default to `0o644`; dotenv defaults to `0o600`. An
unmanaged file already matching content and permissions is adopted. Overwritten
originals are stored in local state and restored on eligible removal. Directories
are not ordinary replacement targets. See [ownership](operations.md#adoption-and-removal).

## Merge a development dotenv file

```ts
import { files } from "@dovocode/workstation";

files.dotenv("~/projects/app/.env", {
  APP_ENV: "development",
  PORT: "3000",
  MESSAGE: "Hello world",
});
```

If the file already has `LOCAL_TOKEN=...`, that undeclared key is preserved.
Declared keys receive literal values: dollar signs and shell syntax are not
expanded or executed. Keep values as single-line strings without single quotes
or NUL. Unsupported quoting and duplicate keys are rejected. Comments, unrelated
lines, inline comments, and LF/CRLF endings are preserved by merge.

When you remove the resource, Workstation restores its declared keys from the
original backup and preserves unrelated edits. Externally changed managed keys
block restoration. A newly created dotenv file remains after managed keys are
removed. Omitting a key from the desired values leaves existing content untouched;
it is not a general key-deletion API.

For complete-file replacement, explicitly set `ifExists: "overwrite"`. Inspect
that policy change carefully. Secret-provider integration and encrypted backups
are not implemented: generated values can appear in state, manifests, and history.
Do not put real credentials in committed examples or assume file mode encrypts them.

## Manage one region of an existing file

First add a single pair of markers to the target file:

```sh
# BEGIN WORKSTATION
# END WORKSTATION
```

Then declare the content between them:

```ts
import { files } from "@dovocode/workstation";

files.inject("~/.zshrc", '\nexport EDITOR="code --wait"\n', {
  start: "# BEGIN WORKSTATION",
  end: "# END WORKSTATION",
});
```

Include leading/trailing newlines in the content as needed. Markers must already
exist exactly once, in the right order. Missing, repeated, or reversed markers
fail before writing. Surrounding text and permissions stay intact; a fourth
argument can set `{ mode: 0o600 }` explicitly.

Removal restores the original region while preserving edits outside it. Changes
inside the managed region can block restoration. Do not also declare `zsh.zshrc`
for this target: both would have the same identity, and the later declaration wins.

## Link tracked dotfiles

```ts
import { symlink } from "@dovocode/workstation";

symlink("dotfiles/gitconfig", "~/.gitconfig");
```

Keep `dotfiles/gitconfig` beside the entry point's other source files. It must
exist before configuration can be applied. A matching existing symlink is adopted;
a different or broken symlink can be replaced. Regular files and directories are
not overwritten. Move an existing regular file aside explicitly if you want to
replace it with a link.

Editing the source immediately changes what programs see through the symlink.
An owned link later redirected outside Workstation is not silently deleted during
removal. Missing replacement sources leave the current target intact.

## Copy files an application will edit

Use [copy/seed provisioning](provisioning.md#copy-or-seed-application-settings) for
mutable settings, binary file copies, or a deliberate symlink-to-file migration.
Provision copies remain on disk when their declarations are removed. This differs
from generated-file removal and restoration and is useful for application-owned data.
