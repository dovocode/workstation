---
title: "Managed Firecracker microVMs"
sidebar_label: "Firecracker microVMs"
---

# Managed Firecracker microVMs

`firecracker.vm(name, options)` returns a configuration fragment that downloads
verified images, prepares a persistent guest disk, configures a TAP interface and
outbound NAT, installs a systemd unit, boots the microVM, and provisions the guest
with its own Workstation executable. It runs natively on Linux. On macOS it creates
or starts a dedicated Linux machine using Lima (default) or OrbStack (`orb`).

For automatic Microsandbox selection on macOS (including M2) and Firecracker on
Linux, use the shared [portable microVM declaration](microvm.md).

## Configure a VM

Supply real, immutable HTTPS URLs and their SHA-256 digests. The placeholders below
are intentionally not runnable downloads. Use matching architecture builds for all
four artifacts. The guest configuration must be self-contained; its built-in
Workstation import resolves through the guest native executable.

```ts
import { defineConfig, firecracker } from "@dovocode/workstation";

export default defineConfig(firecracker.vm("dev", {
  architecture: "aarch64", // x86_64 for an x86 Linux host
  binary: {
    url: "https://your-artifacts.example/firecracker-release.tgz",
    sha256: "<64 hexadecimal characters>",
    member: "release-vVERSION-aarch64/firecracker-vVERSION-aarch64",
  },
  kernel: {
    url: "https://your-artifacts.example/Image",
    sha256: "<64 hexadecimal characters>",
  },
  rootfs: {
    url: "https://your-artifacts.example/rootfs.ext4",
    sha256: "<64 hexadecimal characters>",
  },
  cpus: 2,
  memoryMiB: 1024,
  subnet: "10.231.0.0/30", // choose an unused private /30 per VM
  macos: { provider: "lima" }, // or { provider: "orb", name: "my-firecracker-host" }
  guest: {
    workstation: {
      url: "https://your-artifacts.example/workstation-linux-arm64",
      sha256: "<64 hexadecimal characters>",
    },
    config: `
      import { defineConfig, files } from "@dovocode/workstation";
      export default defineConfig({
        resources: [files.json("~/.config/example/settings.json", { ready: true })],
      });
    `,
  },
}));
```

The optional `member` selects one file from a checksum-verified `.tar.gz` archive;
it is useful for official Firecracker releases. Kernel and rootfs downloads must
be uncompressed. Guest Workstation can be a raw executable or an archive member.
Find kernel/rootfs requirements in the official
[image preparation guide](https://github.com/firecracker-microvm/firecracker/blob/main/docs/rootfs-and-kernel-setup.md).

The rootfs must be a bootable ext4 filesystem with `/root`, `/etc/ssh`, an enabled
OpenSSH server accepting root public-key login, an SFTP server for file transfer,
and a POSIX login shell. The kernel needs virtio block/network, ext4, and kernel
IP autoconfiguration support. Guest networking must retain the kernel-configured
`eth0` address. Workstation injects a fresh SSH client key and an ed25519 server key
into the copied disk, pins that server key on the Linux host, and sets guest DNS
(`1.1.1.1` by default, configurable with `dns`). It does not build an OS or install
an SSH server into an arbitrary filesystem image.

## Build and lifecycle

```sh
workstation plan
workstation build
workstation dev:status
workstation dev:exec -- uname -a
workstation dev:provision
workstation dev:stop
workstation dev:up
# Explicitly delete this VM, including its writable disk and SSH keys:
workstation dev:destroy
```

`build` brings up the host and VM, waits up to 120 seconds for authenticated SSH,
uploads the verified native Workstation executable and configuration, and runs
`workstation build --config /root/guest.ts` inside the guest. A failed download,
boot, or guest build fails the host build; no successful checkpoint is recorded.
Retrying after correcting the cause reuses the guest disk. `dev:provision` explicitly
reapplies guest configuration without restarting the VM. Guest commands preserve
literal arguments through both the provider transport and SSH.

These are retained `provision` resources, so normal planning, status, manifests,
dependency ordering, and apply recovery work without a separate VM state format.
`plan` and status checks never create or start Linux host machines. Inspection
checks the declaration checkpoint, managed host files, systemd activation and
network rules; it does not inspect every resource inside the guest. Use the
provision task to reconcile guest drift. Native inspection uses sudo to read the
private VM directory. The embedded API supports the same fragments and tasks.

The disk is seeded once. Configuration, CPU, memory, kernel, or runtime changes
restart the VM while retaining its disk. Changing the rootfs digest is rejected
until you explicitly destroy the VM; back up application data first. Stop uses
systemd to terminate the VMM and removes its TAP/NAT rules. For an orderly guest
shutdown, run `dev:exec -- poweroff` before stopping or changing configuration.

Removing the fragment from configuration retains the VM, service, and data. Run
the destroy task before removing the declaration when deletion is intended.
The next build recreates a destroyed VM if it remains declared. Snapshot rollback
does not restore VM disks. The outer Lima/Orb machine is retained and can be
managed through its own CLI.

## Execution hosts

On Linux, KVM and systemd must already work. Missing host utilities are installed
through APT, DNF, or pacman during build; other distributions receive prerequisite
instructions. The required utilities are curl, CA certificates, iproute2, iptables,
OpenSSH clients, e2fsprogs, Python 3, and util-linux. The VM's Firecracker binary
is downloaded privately; it does not replace a system installation.

On macOS, install `limactl` or `orb` first. The selected provider creates or starts
`workstation-firecracker` by default. Choose a dedicated machine name; its Linux
utilities are provisioned with APT. Lima uses its Ubuntu template, `vz`, nested
virtualization, and no host filesystem mounts. Orb uses an isolated Ubuntu 24.04
machine. The outer OS image follows the provider template; the explicitly supplied
Firecracker artifacts remain checksum-pinned. Both paths execute the same Linux
manager and keep guest disks inside the outer VM.

Lima's nested virtualization requires supported Apple hardware (documented as M3
or later with macOS 15 or later). OrbStack's documentation currently says nested
KVM is unavailable on Apple Silicon. The `orb` provider is capability-gated: it
reports missing KVM instead of claiming it can boot Firecracker or silently
switching providers. See [Lima configuration](https://github.com/lima-vm/lima/blob/master/templates/default.yaml)
and [OrbStack nested virtualization](https://docs.orbstack.dev/machines/#nested-virtualization).
Firecracker runs the host CPU architecture; Rosetta cannot supply guest KVM.

## Storage and networking

VM files live under `/var/lib/workstation-firecracker/NAME` on the Linux host.
Ownership markers reject another configuration's VM directory. A Linux-side lock
serializes lifecycle mutations, including concurrent invocations from macOS.
Externally edited service units block replacement or deletion.

Each VM reserves its explicitly chosen /30. The first usable address belongs to
the host TAP and the second to the guest. Managed reservations and overlapping
host routes are rejected. NAT and forwarding rules are tagged per VM, and cleanup
removes only those rules and the owned TAP. IPv4 forwarding is enabled on the
Linux host and is retained when a VM stops because other workloads may need it.
No inbound port forwarding or host workspace mount is created. On macOS, guest
commands are routed through the outer machine; the inner guest IP is not directly
exposed to macOS.

This workflow targets trusted development images and configurations. The VMM runs
as a system service with root privileges; this implementation does not configure
Firecracker's production jailer or tenant network isolation. Review the official
[production host guidance](https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md)
for those requirements.

Validation covers public configuration/manifest round trips, provider transport,
and execution of the generated lifecycle scripts against filesystem-backed fake
Linux utilities, including preservation and failure recovery. Real Firecracker
booting and Lima/Orb nested virtualization have not been verified on this host.
