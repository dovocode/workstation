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
An active user systemd manager is needed for user scope; Workstation does not
configure lingering or create a login session.

## Inspection limits

Service reconciliation compares declaration files. An unchanged file does not
currently trigger a live health check or repair of a separately stopped process.
Use launchctl/systemctl to inspect runtime health. Service installation failures
are reported rather than silently treated as success.
