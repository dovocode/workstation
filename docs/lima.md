---
title: "Managed Lima VMs"
sidebar_label: "Lima VMs"
---

# Managed Lima VMs

`lima.vm(name, options)` manages a dedicated macOS Virtualization.framework VM
with a checksum-pinned Linux cloud image and one external raw data disk. This
runs a full guest kernel without nested virtualization, including on M1/M2 Macs.
Install Lima 2+ and Python 3 separately, and order those resources using
`dependsOn`. The image architecture must match the Mac.

```ts
import { lima } from "@dovocode/workstation";

export default lima.vm("code", {
  image: {
    url: "https://example.com/ubuntu-arm64.img",
    sha256: "<verified 64-character SHA-256>",
    architecture: "aarch64",
  },
  cpus: 4,
  memoryGiB: 8,
  bootDiskGiB: 32,
  dataDisk: {
    path: "/Volumes/Code/disk.raw", sizeGiB: 500,
    storage: {
      filesystem: "xfs", mountPoint: "/code",
      vdo: { compression: "lz4", deduplication: true, logicalSizeGiB: 500 },
    },
  },
});
```

The example requires real image metadata. Managed storage installs Ubuntu/Debian
packages and persists the mount in `/etc/fstab`. VDO requires the guest's
`dm_vdo` module and a 4 KiB page kernel. The mount directory belongs to the guest
login user. Choose one storage declaration:

| Filesystem | Settings |
| --- | --- |
| XFS | `{ filesystem: "xfs", mountPoint: "/code" }` |
| ext4 | `{ filesystem: "ext4", mountPoint: "/code" }` |
| XFS/ext4 + VDO | Add `vdo: { compression: "lz4", deduplication: true, logicalSizeGiB: 500 }` |
| Btrfs | `{ filesystem: "btrfs", mountPoint: "/code", compression: "zstd" }` |

VDO compression and deduplication default to enabled; either can be disabled.
Its logical size defaults to the physical disk size, and physical disks must be
at least 8 GiB. Monitor VDO capacity: metadata and incompressible data consume
physical space independently of filesystem free space. Btrfs accepts `zstd`
(default), `lzo`, `zlib`, or `false`; LZ4 is a VDO setting. This API deliberately
uses native Btrfs compression without a VDO layer.

Compression/deduplication changes can be reconciled without reformatting; they
affect future writes, not a rewrite of existing data. Filesystem, mount point,
VDO enablement or logical-size changes require an explicit migration. Neither
existing disk signatures nor conflicting mounts are overwritten.

An optional `guestScript` runs after managed storage. Without `storage`, a custom
script is required and owns all disk initialization. The root script receives `check` or `setup`, `/dev/vdb`, and the expected byte size.
It must validate the device before formatting, preserve existing filesystems,
and persist mounts itself. A failed script fails reconciliation. Guest setup
changes rerun setup against the same disk. Both setup and check must succeed
before the desired guest script is checkpointed.

Workstation exclusively creates a sparse raw file at the requested path; its
parent directory must already exist. Paths under `/Volumes` additionally require
the volume to be mounted. Existing unmanaged files (including dangling symlinks),
VM names and Lima disk registry entries are rejected. Interrupted initialization
never authorizes overwriting an existing file. Back up disks independently;
Workstation snapshots do not contain VM data.

Lima's named disk registry (`~/.lima/_disks/ws-NAME/datadisk`) is a symlink to that
file. This deliberately uses Lima's disk registry layout because `disk import`
copies files, which would break the requested external storage location. Lima
configuration edits and replacement/resizing of the raw file are rejected.
This adapter fixes `LIMA_HOME` to `~/.lima`; inherited overrides are not used.

Plain mode disables Lima's automatic partition mounting and guest integrations.
SSH and `limactl shell` still work; there are no host directory mounts or dynamic
port forwarding. The boot disk stays under `~/.lima/NAME`, separate from the raw
data disk. Image/hardware/path changes require an explicit migration rather than
silently replacing disks. VM state and data are retained when its declaration is
removed; no automatic deletion or destroy task is provided.

`workstation build` reconciles the VM. Lifecycle tasks are `NAME:up`, `NAME:stop`,
`NAME:status`, `NAME:provision` and `NAME:exec -- COMMAND ARGS...`. Checks never
create a VM or start a stopped VM. Up/provision execute the guest setup script;
stop preserves both disks. Startup at macOS login is not configured.

Tests execute the lifecycle adapter against a fake Lima CLI, checking exclusive
file creation, data retention, drift, failure recovery and argument handling.
Real guest booting and external-drive behavior require host validation.

References: [Lima plain mode](https://lima-vm.io/docs/config/plain/),
[disk layout](https://lima-vm.io/docs/dev/internals/), and
[VZ](https://lima-vm.io/docs/config/vmtype/vz/).

Storage references: [Btrfs compression](https://btrfs.readthedocs.io/en/latest/Compression.html) and [kernel VDO](https://docs.kernel.org/admin-guide/device-mapper/vdo.html).
