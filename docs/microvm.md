---
title: "Portable managed microVMs"
sidebar_label: "Portable microVMs"
---

# Portable managed microVMs

`microvm.vm(name, options)` provides one declaration and the same lifecycle tasks
for Microsandbox and Firecracker. By default it chooses **Microsandbox on macOS**
and **Firecracker on Linux**. On an M2 Max, Microsandbox runs directly on macOS;
this path does not require nested KVM, Lima, or Orb.

CPU, memory, architecture, and guest Workstation provisioning are shared. Image
inputs remain backend-specific: Microsandbox boots a digest-pinned OCI image;
Firecracker needs a pinned binary, kernel, ext4 rootfs, and a private network subnet.
Workstation does not convert images or migrate disks between these formats.

For a full macOS VM with an external raw data disk and a distro-managed kernel,
use [managed Lima VMs](lima.md).

## One declaration

Replace all example URLs and digests with your verified artifacts. This example
targets ARM64 hosts; use `x86_64` and matching artifacts on x86 Linux. If your hosts
have different architectures, choose artifacts inside a configuration factory.

```ts
import { defineConfig, microvm } from "@dovocode/workstation";

export default defineConfig(microvm.vm("dev", {
  backend: "auto", // default; or explicitly "microsandbox" / "firecracker"
  architecture: "aarch64",
  cpus: 2,
  memoryMiB: 2048,
  guest: {
    workstation: {
      url: "https://your-artifacts.example/workstation-linux-arm64",
      sha256: "<64 hexadecimal characters>",
    },
    config: `
      import { defineConfig, files } from "@dovocode/workstation";
      export default defineConfig({
        resources: [files.json("~/.config/example.json", { ready: true })],
      });
    `,
  },
  microsandbox: {
    image: "docker.io/library/ubuntu@sha256:<64 lowercase hexadecimal characters>",
  },
  firecracker: {
    binary: {
      url: "https://your-artifacts.example/firecracker",
      sha256: "<64 hexadecimal characters>",
    },
    kernel: {
      url: "https://your-artifacts.example/Image",
      sha256: "<64 hexadecimal characters>",
    },
    rootfs: {
      url: "https://your-artifacts.example/rootfs.ext4",
      sha256: "<64 hexadecimal characters>",
    },
    subnet: "10.231.0.0/30",
  },
}));
```

Automatic selection requires both backend definitions. Explicit selection requires
only the selected backend's definition. There is no automatic fallback if a backend
fails. Explicit Firecracker on macOS still needs a KVM-capable Lima/Orb host; see
[Firecracker host requirements](firecracker.md#execution-hosts).

## Shared lifecycle

```sh
workstation plan
workstation build
workstation dev:status
workstation dev:exec -- uname -a
workstation dev:provision
workstation dev:stop
workstation dev:up
workstation dev:destroy
```

`build` creates or resumes the VM and provisions it with the checksum-verified native
Workstation executable and self-contained guest configuration. Failed provisioning
fails the build and can be retried against the existing disk. `status` exits nonzero
if the VM is absent, stopped, or differs from the declaration checkpoint. Checks do
not create or start VMs. `exec` preserves literal arguments and guest exit codes;
`provision` reapplies guest configuration. Both require a running VM.

Stopping and changing CPU/memory preserve the writable disk. An OCI image change
or Firecracker rootfs change requires explicit destruction before recreation.
`destroy` deletes the selected VM and its disk. Removing a declaration, switching
backends, or rolling back a Workstation snapshot does not delete or restore VM data.
Switching backends may leave both VMs running: stop the old one before changing the
selection if that is unwanted. Tasks always target the currently selected backend.

## Microsandbox requirements

Install and initialize the local `msb` runtime (version 0.7.1 or newer) and Python 3
on the host. The adapter uses Python's standard library and explicitly selects
`MSB_BACKEND=local`, regardless of the CLI's cloud defaults. Optional `cli` and
`python` fields specify tool paths; relative paths resolve against the configuration
directory, and bare names use PATH. Runtime installation is not automatic.

The OCI image must match the declared architecture and contain a Linux userland
with `uname`, `mkdir`, and `install`, plus the libraries required by your native
Workstation build. Guest provisioning runs as root and writes `/root/guest.ts` and
`/usr/local/bin/workstation`. Microsandbox manages its own networking and persistent
root disk; the Firecracker subnet is not applied to Microsandbox. No workspace
mount or inbound port forwarding is configured by this helper.

Ownership labels prevent adopting or deleting another configuration's same-named
VM. Configuration changes reconcile resources and guest provisioning; healthy builds
perform inspection only. Inspection checks runtime state and the last provisioning
checkpoint, not every resource inside the guest. Use `dev:provision` for guest drift.

For a Microsandbox-only declaration, `microsandbox.vm(name, options)` accepts
`image`, `cli`, and `python` alongside the shared fields directly. Existing
`microsandbox.create/exec/remove/workstation` task helpers retain their behavior.

The adapter follows the official [Microsandbox v0.7.1 CLI implementation](https://github.com/superradcompany/microsandbox/tree/v0.7.1/crates/cli/lib/commands).
Tests execute the real lifecycle adapter against a fake persistent CLI, covering
reconciliation, disk retention, ownership, checksums, and failures. Live Microsandbox
booting has not been verified on this host.
