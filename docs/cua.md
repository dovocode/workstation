---
title: "Cua sandboxes and computer use"
sidebar_label: "Cua computer use"
---

# Cua sandboxes and computer use

The exported `cua` helpers integrate the [Cua project](https://cua.ai/) as explicit
local sandbox tasks. They launch and control Cua sandboxes, execute guest commands,
run nested Workstation, and expose screenshots, mouse, typing, key combinations,
and scrolling. These tasks run only when invoked; host builds do not create or
delete Cua sandboxes.

## Install Cua tooling

The helpers target the documented `cua-cli` 0.1.15 and `cua-sandbox` 0.7.0
interfaces. Install both in one Python environment, plus the runtime required by
your image. For example, in your configuration project:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --extra-index-url https://wheels.cua.ai/simple \
  'cua-cli==0.1.15' 'cua-sandbox==0.7.0'
.venv/bin/cua platform list
```

Use Cua's [CLI reference](https://cua.ai/docs/reference/cua-cli/cli-reference) and
[local runtime guide](https://cua.ai/docs/how-to-guides/sandbox/manage-local-lifecycle)
to select a supported image and host. Linux containers normally use Docker;
Linux VMs use QEMU and macOS VMs use Lume. Cua's runtime selection is independent
of Workstation's managed Firecracker workflow. A plain Firecracker rootfs does
not automatically provide a Cua desktop or computer server.

## Declare tasks

```ts
import { configure, cua, defineConfig } from "@dovocode/workstation";

export default defineConfig(configure(({ configDir }) => {
  const runtime = {
    cli: `${configDir}/.venv/bin/cua`,
    python: `${configDir}/.venv/bin/python`,
    cwd: configDir,
  };
  return {
    tasks: {
      "desktop:create": cua.create("desktop", "ubuntu:24.04", runtime),
      "desktop:status": cua.status("desktop", runtime),
      "desktop:view": cua.vnc("desktop", runtime),
      "desktop:exec": cua.exec("desktop", ["uname", "-a"], runtime),
      "desktop:screen": cua.screenshot("desktop", "screen.png", runtime),
      "desktop:click": cua.click("desktop", 200, 150, "left", runtime),
      "desktop:type": cua.type("desktop", "Hello from Workstation", runtime),
      "desktop:select-all": cua.key("desktop", ["ctrl", "a"], runtime),
      "desktop:scroll": cua.scroll("desktop", 200, 150, 0, 3, runtime),
      "desktop:suspend": cua.suspend("desktop", runtime),
      "desktop:resume": cua.resume("desktop", runtime),
      "desktop:restart": cua.restart("desktop", runtime),
      "desktop:remove": cua.remove("desktop", runtime),
    },
  };
}));
```

Invoke `workstation desktop:create`, then `workstation desktop:screen`, for
example. `create` also accepts `vm`, `cpus`, `memory`, and `disk`; sizes require
explicit units such as `4GB`. Creating an existing name delegates the resulting
error to Cua. Removal uses the explicitly named local sandbox and `--force` to
skip Cua's confirmation prompt; it deletes sandbox data. No automatic removal,
adoption, replacement, or rollback is provided.

Screenshots are saved as PNG on the host. Relative paths use task `cwd`, and an
existing output file causes an error rather than being overwritten. Coordinates
are screenshot pixels. All computer actions connect to the specified local
sandbox through `Sandbox.connect`, then disconnect while leaving it running.
They do not change Cua's global `cua do` target or grant access to your host desktop.
See the [Sandbox interfaces](https://cua.ai/docs/reference/sandbox-sdk/interfaces)
for image-specific capabilities and key names.

## Guest commands and Workstation

```ts
cua.exec("desktop", ["printf", "%s", "$(this stays literal)"], runtime);
cua.workstation("desktop", {
  config: "/workspace/guest.workstation.ts",
  plan: true,
}, runtime);
```

Guest commands use a POSIX shell, so these two helpers target Linux/macOS guests.
Every argument, including arguments appended through `workstation TASK -- ...`,
is quoted before Cua executes it. The current Cua CLI joins exec arguments into a
shell string; Workstation instead uses the SDK bridge to preserve argument
boundaries and propagate guest stdout, stderr, and exit status. Commands have a
120-second SDK timeout. Screenshot and input tasks reject extra CLI arguments.

Nested Workstation requires its executable, configuration and imports to already
exist in the sandbox. Its `config`, `machine`, and `executable` options refer to
the guest; `cwd` and `environment` configure the host Python process. The embedded
client can invoke the same declarations with `await client.task(name, args)`.

Tests execute the Python bridge against a fake SDK and verify targeting, command
quoting, disconnection, exit codes, screenshot preservation, and embedded dispatch.
Live Cua sandbox creation and desktop control have not been verified on this host.
