---
title: "Provisioning recipes"
sidebar_label: "Provisioning & health checks"
---

# Provisioning recipes

`provision(name, operation, dependsOn?)` declares a setup operation that is inspected,
repaired if necessary, and verified before success is recorded. Put these declarations
in `resources`. Names identify operations; dependencies are resolved resource IDs.

**Provision operations remain on the machine when removed from configuration.**
Workstation forgets their state; it does not untap repositories, undo preferences,
revoke access, remove copied data, or uninstall vendor software. Snapshot rollback
of provisioning is unsupported. Use generated-file or service resources when their
managed removal behavior is what you need.

## Available operations

| Type | Platform | Purpose |
| --- | --- | --- |
| `brew-tap` | macOS | Add a tap, verify its origin, optionally trust it |
| `apt-repository` | Linux with APT | Install a deb822 source and digest-verified signing key |
| `copy-file` | macOS/Linux | Copy source bytes, seed defaults, or migrate a symlink |
| `macos-default` | macOS | Set a Boolean, string, or integer preference |
| `macos-installer` | macOS | Verify a signed `.pkg` and run the native installer |
| `linger` | Linux | Enable a user's services outside login sessions |
| `group-member` | Linux | Add an existing user to an existing group |
| `service` | Native manager | Activate an existing systemd/launchd service |
| `check` | macOS/Linux | Run a read-only probe and conditional repair commands |

Use `darwin(...)` and `linux(...)` around platform-specific fragments. Commands and
URLs below containing `example` or `REPLACE` are templates, not working vendor
installation instructions. Supply the actual repository, signer, account, or app.

## Add a Homebrew tap before packages

```ts
import { darwin, defineConfig, provision, tools } from "@dovocode/workstation";

export default defineConfig(darwin({ resources: [
  provision("vendor-tap", {
    type: "brew-tap",
    tap: "vendor/tools",
    url: "https://github.com/vendor/homebrew-tools.git",
    trust: true,
  }),
  ...tools.brew(["vendor/tools/example"]).map(resource => ({
    ...resource,
    dependsOn: ["provision:vendor-tap"],
  })),
] }));
```

Repository provisioning runs before package version resolution during builds.
The optional URL is checked against the existing tap origin. `trust: true`
explicitly requests Homebrew trust and verifies its reported status; omit it when
not required. Existing taps are retained after declaration removal.

## Add an APT repository with a verified key

```ts
import { defineConfig, linux, provision, tools } from "@dovocode/workstation";

export default defineConfig(linux({ resources: [
  provision("vendor-repository", {
    type: "apt-repository",
    name: "example-vendor",
    uri: "https://packages.example.com/{distribution}",
    suite: "auto",
    components: ["stable"],
    architecture: "auto",
    keyUrl: "https://packages.example.com/{distribution}/key.asc",
    keySha256: "REPLACE_WITH_64_HEX_DIGITS_FROM_THE_VERIFIED_KEY_FILE",
    conflicts: ["example-legacy-package"],
  }),
  ...tools.apt(["example-package"]).map(resource => ({
    ...resource,
    dependsOn: ["provision:vendor-repository"],
  })),
] }));
```

Obtain the key from the vendor's trusted distribution channel and verify it before
recording the SHA-256 digest of the downloaded ASCII file. This is **not** the
OpenPGP fingerprint. The placeholder intentionally fails validation until replaced.
URLs must use credential-free HTTPS. `suite: "auto"` and `architecture: "auto"`
resolve Debian/Ubuntu codename and architecture; `{distribution}` substitutes
`debian` or `ubuntu` in the URLs during automatic resolution.

The operation installs `/etc/apt/keyrings/<name>.asc` and
`/etc/apt/sources.list.d/<name>.sources`, then updates metadata. Downloads and digest
checks precede privileged writes. `curl`, CA certificates, APT tools, and sudo must
already work. Listed conflicting packages cause an error; they are never silently
removed. Migrate them explicitly before retrying. Existing repositories are not
prepared by a read-only plan or standalone lock update.

## Copy or seed application settings

```ts
import { provision } from "@dovocode/workstation";

provision("example-settings", {
  type: "copy-file",
  source: "defaults/settings.json",
  target: "~/.config/example/settings.json",
  seed: true,
  mode: 0o600,
});
```

The source must exist, even if the destination already exists: source bytes are
captured during configuration loading. With `seed: true`, an existing regular
file is preserved, including its content and mode. Without `seed`, content and
permissions converge to the source and `mode` (default `0o644`).

To convert an old symlink into an independent file while preserving its current
contents, use both `seed: true` and `migrateSymlink: true`. The linked source stays
intact. If the link is broken, the declared source supplies the seed. Without
`seed`, migration copies the declared source instead. Originals are recorded in
private state, but removing the provision declaration does not restore them.

Set `privileged: true` for copies that require `sudo install`. Privileged symlink
migration is deliberately rejected and needs an explicit manual migration. Copies
can contain arbitrary bytes; do not provide the internal resolved `content` field
in ordinary source declarations.

## Set a macOS preference

```ts
import { darwin, defineConfig, provision } from "@dovocode/workstation";

export default defineConfig(darwin({ resources: [
  provision("example-preference", {
    type: "macos-default",
    domain: "com.example.app",
    key: "ShowStatusItem",
    value: true,
  }),
] }));
```

Use the actual application's documented domain and key. Values accept Boolean,
string, or safe integer types. Workstation reads and writes through `defaults`;
it does not automatically restart the application or manage arbitrary plist
arrays/dictionaries through this operation.

## Install a signed macOS vendor package

```ts
import { darwin, defineConfig, provision } from "@dovocode/workstation";

export default defineConfig(darwin({ resources: [
  provision("vendor-app", {
    type: "macos-installer",
    url: "https://downloads.example.com/Example.pkg",
    teamId: "REPLACE1234",
    installedPath: "/Applications/Example.app",
    version: "1.2.3",
    sha256: "REPLACE_WITH_64_HEX_DIGITS_FROM_THE_VERIFIED_PACKAGE",
  }),
] }));
```

Supply the actual ten-character uppercase alphanumeric Developer Team ID and
optional SHA-256 digest. Workstation downloads the package, checks the digest
when supplied, verifies the Developer ID Installer signer with `pkgutil`, runs
`spctl` assessment, and invokes `sudo installer` only after verification succeeds.

Without `version`, presence of `installedPath` satisfies inspection. With `version`,
inspection compares the app bundle's `CFBundleShortVersionString`. There is no
latest-version discovery: update the declaration to request another version.
Installation effects and application data are not undone on removal or rollback.

## Enable Linux lingering and group membership

```ts
import { defineConfig, linux, provision } from "@dovocode/workstation";

export default defineConfig(linux({ resources: [
  provision("worker-linger", { type: "linger", user: "dominic" }),
  provision("worker-group", {
    type: "group-member", user: "dominic", group: "example-workers",
  }),
] }));
```

Replace account/group names with existing local accounts. Workstation uses
`sudo loginctl enable-linger` and `sudo usermod -aG`; it does not create users or
groups. Group membership takes effect on the next login. Lingering does not by
itself guarantee a usable user bus in the current process environment.

## Activate a service supplied by another installer

```ts
import { defineConfig, linux, provision } from "@dovocode/workstation";

export default defineConfig(linux({ resources: [
  provision("example-daemon", {
    type: "service", manager: "systemd", scope: "system", name: "example.service",
  }),
] }));
```

The unit must already exist. Systemd inspection checks active and enabled state;
repair enables, starts, and restarts the service. User scope uses `systemctl --user`;
system scope uses sudo for mutations.

For launchd, supply `manager: "launchd"`, `scope`, `name` (the label), and `plist`.
`optionalSession: true` permits a missing GUI domain or plist to remain inactive
instead of failing; use it only when skipping activation is intended. Use
[generated service resources](services.md) to own and remove the unit/plist itself.

## Check and repair an initialized application

```ts
import { provision } from "@dovocode/workstation";

provision("example-health", {
  type: "check",
  requiresFile: "~/.config/example/initialized",
  check: { command: "example", args: ["health"] },
  repair: [
    { command: "example", args: ["repair"] },
  ],
});
```

Checks can run during `plan`, `status`, and builds: keep them read-only. Exit zero
means healthy; nonzero requests repair. Failure to spawn a command is an error.
Repairs execute sequentially during apply and must leave the subsequent probe
successful. Arguments are literal; supply a shell explicitly for shell syntax.

`requiresFile` makes the operation inactive while a prerequisite is absent. This
lets login, pairing, or vault creation remain an explicit task. It is not an
initialization command. Working directories default to the entry point's directory;
commands accept `cwd` and `environment` overrides.

Add `dependsOn` as the third argument when checks must follow package/file changes.
Dependent checks are re-evaluated after prerequisite changes. Set
`restartOnChange: true` when dependency changes should force repair even if the
post-change check succeeds. Repairs and generated service restarts can propagate
through dependencies; see [resource IDs](configuration.md#dependencies-and-resource-ids).

## Repair a mise npm tool without upgrading it

```ts
import { configure, defineConfig, files, npmHealth, tools } from "@dovocode/workstation";

export default defineConfig(configure(({ home }) => {
  const versions = { node: "lts", "npm:example-cli": "latest" };
  return { resources: [
    tools.mise(versions),
    files.mise("~/.config/mise/config.toml", versions),
    npmHealth("example-cli-health", {
      tool: "npm:example-cli",
      package: "example-cli",
      executable: "example",
      home,
      dependsOn: ["package:mise:node", "package:mise:npm:example-cli"],
    }),
  ] };
}));
```

Replace the example package/tool/executable with the actual installed package.
`npmHealth` probes its executable with `--version`. A normal repair reinstalls
the exact observed package version into its existing mise prefix with optional
dependencies. It does not refresh the package pin.

For a package using `node-pty`, set `nativePty: true`. This probes a real PTY under
the selected Node runtime and repairs the dependency's install/postinstall scripts;
it does not use the executable smoke test in this mode. Runtime activation and
build prerequisites must be correct. Environment overrides are available for the
probe and repair. Authentication and account setup still belong in explicit tasks.
