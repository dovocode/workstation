---
title: "Services"
sidebar_label: "Background services"
---

# Services

## macOS LaunchAgents

```ts
import { darwin, defineConfig, launchAgent } from "@dovocode/workstation";

export default defineConfig(darwin({ resources: [
  launchAgent("dev.example.worker", {
    program: "/opt/homebrew/bin/example-worker",
    args: ["serve", "--port", "7345"],
    environment: { PATH: "/opt/homebrew/bin:/usr/bin:/bin" },
    runAtLoad: true,
    keepAlive: true,
    stdoutPath: "~/Library/Logs/worker.log",
    stderrPath: "~/Library/Logs/worker.error.log",
  }),
] }));
```

Workstation writes `~/Library/LaunchAgents/<label>.plist`, bootstraps it in the
current user's `gui/<uid>` domain if unloaded, then requests a start. A GUI
login session must exist for that domain. It does not manage system LaunchDaemons.
Use unique labels, explicit executable paths, and an environment appropriate
for a service rather than relying on interactive shell initialization.

Run-at-load defaults to true; keep-alive defaults to false. Removal unloads
an owned agent and deletes its unchanged plist. A modified plist causes an error.

## Linux systemd

```ts
import { defineConfig, linux, systemdService } from "@dovocode/workstation";

export default defineConfig(linux({ resources: [
  systemdService("example-worker", {
    description: "Example worker",
    program: "/usr/local/bin/example-worker",
    args: ["serve"],
    environment: { PORT: "3000" },
    restart: "on-failure",
  }),
] }));
```

The default scope is `user`, writing under `~/.config/systemd/user/` and using
`systemctl --user`. The `.service` suffix is added when missing. Set
`scope: "system"` to write under `/etc/systemd/system/` and use sudo.
`wantedBy` defaults to `default.target` for user units and `multi-user.target`
for system units. `restart` accepts `no`, `on-failure`, or `always` and defaults
to `on-failure`.

Installation reloads the manager, enables the unit, and starts it. Owned removal
disables/stops the unit, removes its unchanged file, and reloads the manager.
An active user systemd manager is needed for user scope. `systemdService` does
not enable lingering automatically; use the separate `linger` provision operation
when needed. It does not create a login session.

## Inspection limits

Service reconciliation compares declaration files and runtime activation.
Systemd units must be active and enabled. LaunchAgents must be loaded; with
`keepAlive: true`, they must also report running. A stopped/disabled managed
service can therefore produce an update even when its file is unchanged.

This does not prove application readiness, network reachability, or successful
account initialization. Use a separate read-only check for application health.
Service installation failures are reported rather than treated as success.

## Restart when configuration changes

Add `dependsOn` to connect a service to its package, custom executable, generated
config, or health resource. Use resolved IDs, including absolute paths for files:

```ts
import { configure, defineConfig, files, linux, systemdService } from "@dovocode/workstation";

export default defineConfig(linux(configure(({ home }) => ({ resources: [
  files.json("~/.config/worker/settings.json", { port: 7345 }),
  systemdService("example-worker", {
    program: "/usr/local/bin/example-worker",
    args: ["--config", `${home}/.config/worker/settings.json`],
    environment: { PATH: "/usr/local/bin:/usr/bin:/bin" },
    dependsOn: [`file:${home}/.config/worker/settings.json`],
  }),
] }))));
```

Install the real worker executable before applying this template. A changed
settings file is applied before the dependent service restarts. The same
`dependsOn` option is available on `launchAgent`. Unknown IDs and cycles fail;
see the [ID reference](configuration.md#dependencies-and-resource-ids).

## Generated service or existing-service activation?

Use `systemdService` or `launchAgent` when Workstation should generate and manage
the unit/plist, including owned removal. Use `provision` with `type: "service"`
when a package/vendor already supplies it and Workstation should check activation.
Provision service declarations are retained on removal, including system launchd
services. These are different lifecycle choices; do not manage the same service
through both mechanisms.

For logs and user-session errors, see [service troubleshooting](troubleshooting.md#a-service-is-installed-but-not-usable).
