# Docker, Docker Sandboxes, and Microsandbox

Workstation provides typed lifecycle **task helpers** for Docker containers,
Compose projects, Docker Sandboxes (`sbx`), and Microsandbox (`msb`). These helpers
work in configuration files and inline embedded clients. They are explicit command
operations, not reconciled resources: `build`, `plan`, package locks, status and
rollback do not track their lifecycle. Creating an existing name may fail; no
automatic adoption, replacement, cleanup, or runtime installation is performed.

```ts
import { defineConfig, docker, sbx, microsandbox } from "@dovocode/workstation";

export default defineConfig({
  tasks: {
    "containers:up": docker.compose("my-app", "compose.yaml", "up"),
    "containers:status": docker.compose("my-app", "compose.yaml", "ps"),
    "containers:down": docker.compose("my-app", "compose.yaml", "down"),
    "container:test": docker.run("app-test", "alpine:3.22", ["echo", "hello"], {
      removeOnExit: true,
    }),
    "sbx:create": sbx.create("app-agent", "claude", "."),
    "sbx:exec": sbx.exec("app-agent", ["pwd"]),
    "sbx:stop": sbx.stop("app-agent"),
    "sbx:remove": sbx.remove("app-agent"),
    "vm:create": microsandbox.create("app-vm", "python:3.12"),
    "vm:test": microsandbox.exec("app-vm", ["python", "-c", "print('hello')"]),
    "vm:remove": microsandbox.remove("app-vm"),
  },
});
```

Run `workstation containers:up` or `workstation vm:create`. With an embedded
client, call `await client.task("vm:test")`. Commands return native exit codes.
Arguments are passed directly, without a host shell. An explicitly supplied guest
shell such as `sh -c` still interprets its own command text.

Install the runtime CLIs first. Docker requires access to its engine and the Compose
plugin for Compose helpers. Docker Sandboxes uses the current standalone `sbx`
interface and requires its own installation and authentication. Microsandbox helpers
target the documented `msb` 0.6.8 create/exec/remove interface; ensure the host meets
its virtualization requirements. Workstation does not establish a security boundary
or grant isolation beyond the selected runtime's configuration.

Task `cwd` and `environment` configure the host process. Relative file/workspace paths
are interpreted from that working directory; tilde expansion is not performed by a
host shell. Docker run accepts `envFiles` for explicit guest environment forwarding.
For advanced flags, use the existing `task(command, args, options)` escape hatch.
Image references are passed verbatim; use immutable image digests where appropriate.

Removal semantics: Docker removal is not forced; Compose down does not request
volume deletion; sbx removal is not forced. **Microsandbox removal uses the documented
`msb rm --force NAME`, which deletes the explicitly named microVM and its disk.**
No removal is performed unless its task is invoked.

## Nested Workstation setup

Each runtime has a `workstation(name, guestOptions, hostTaskOptions?)` helper.
This runs the guest's own Workstation to manage packages and files inside an
**existing, running environment**, using the same configuration API as on the host.

```ts
import { defineConfig, sbx, docker, microsandbox } from "@dovocode/workstation";

export default defineConfig({
  tasks: {
    "sandbox:create": sbx.create("dev", "claude", "."),
    "sandbox:plan": sbx.workstation("dev", {
      config: "/workspace/guest.workstation.ts", plan: true,
    }),
    "sandbox:setup": sbx.workstation("dev", {
      config: "/workspace/guest.workstation.ts", machine: "sandbox", noRemove: true,
    }),
    "container:setup": docker.workstation("dev-container", {
      config: "/workspace/guest.workstation.ts",
    }),
    "vm:setup": microsandbox.workstation("dev-vm", {
      config: "/workspace/guest.workstation.ts", executable: "/usr/local/bin/workstation",
    }),
  },
});
```

Create the environment explicitly, install Workstation in its image or guest using
the [installation instructions](getting-started.md), and make the guest configuration
and its imports available there. Substitute the actual guest workspace path; the
helper does not copy files or create mounts. Then run `workstation sandbox:plan`
and `workstation sandbox:setup`. Re-run setup to reconcile the guest again; do not
repeat creation for an existing name.

In a codebase, use these same task declarations with `createWorkstation` and call
`await client.task("sandbox:setup")`. Check the returned `exitCode` before continuing
with dependent work. Setup is explicit: a host `build` does not execute these tasks.

`config`, `executable`, and `machine` refer to the guest. The third argument's `cwd`
and `environment` configure only the host runtime process. Commands use literal
arguments, including paths containing spaces. No host secrets or state are forwarded.
Keep guest state/locks in guest-owned storage; do not share a host `stateFile` with
the guest. Ephemeral guest storage means state is lost when that storage is removed.

Guest builds use normal prerequisite bootstrap and reconciliation, subject to the
guest's permissions, networking, OS and installed runtime dependencies. `frozen`
requires existing guest pins. `plan` inspects without applying. Nested execution does
not add cross-environment rollback, automatic guest Workstation installation, or
nested virtualization support; runtime prerequisites must already be satisfied.

Official interfaces used:

- [Docker run](https://docs.docker.com/reference/cli/docker/container/run/)
- [Docker Compose](https://docs.docker.com/reference/cli/docker/compose/)
- [Docker Sandboxes usage](https://docs.docker.com/ai/sandboxes/usage/)
- [Microsandbox local lifecycle](https://microsandbox.dev/platform/local)

Validation currently covers command construction and embedded task dispatch with
fake runners. Real Docker, sbx, and microVM execution has not been tested on this host.
