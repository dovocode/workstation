/** VDO provides LZ4 block compression and optional deduplication beneath XFS/ext4. */
export interface LimaVdoOptions {
  readonly compression?: "lz4" | false;
  readonly deduplication?: boolean;
  readonly logicalSizeGiB?: number;
}

/** A managed data filesystem. Btrfs uses native compression rather than stacking VDO. */
export type LimaStorageOptions = { readonly mountPoint: string } & (
  | { readonly filesystem: "xfs" | "ext4"; readonly vdo?: LimaVdoOptions; readonly compression?: never }
  | { readonly filesystem: "btrfs"; readonly compression?: "zstd" | "lzo" | "zlib" | false; readonly vdo?: never }
);

/** Validate destructive layout choices before any runtime command can be generated. */
export function validateStorage(storage: LimaStorageOptions, sizeGiB: number): void {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(storage.mountPoint)) throw new Error("Storage mountPoint must be an absolute non-root path without spaces");
  if (!["xfs", "ext4", "btrfs"].includes(storage.filesystem)) throw new Error("Unsupported data filesystem");
  if (storage.filesystem === "btrfs") {
    if (storage.vdo !== undefined) throw new Error("Btrfs uses native compression, not VDO");
    if (!["zstd", "lzo", "zlib", false].includes(storage.compression ?? "zstd")) throw new Error("Unsupported Btrfs compression; LZ4 is a VDO setting");
  } else {
    if (storage.compression !== undefined) throw new Error("XFS/ext4 compression must be configured through VDO");
    if (storage.vdo) validateVdo(storage.vdo, sizeGiB);
  }
}

/** Validate VDO capacity and tuning separately from filesystem selection. */
function validateVdo(vdo: LimaVdoOptions, sizeGiB: number): void {
  if (sizeGiB < 8) throw new Error("VDO data disk must be at least 8 GiB");
  if (vdo.compression !== undefined && vdo.compression !== "lz4" && vdo.compression !== false) throw new Error("VDO supports LZ4 compression");
  if (vdo.deduplication !== undefined && typeof vdo.deduplication !== "boolean") throw new Error("Invalid VDO deduplication setting");
  const logical = vdo.logicalSizeGiB ?? sizeGiB;
  if (!Number.isSafeInteger(logical) || logical < 1 || logical > 65536) throw new Error("Invalid VDO logical size");
}

/** Immutable layout identity: tuning compression/deduplication never authorizes reformatting. */
export function storageLayout(storage: LimaStorageOptions | undefined, sizeGiB: number) {
  return storage ? { filesystem: storage.filesystem, mountPoint: storage.mountPoint,
    vdo: storage.vdo ? { logicalSizeGiB: storage.vdo.logicalSizeGiB ?? sizeGiB } : null } : null;
}

/** Generate guest-only Bash; checks do not install, format, activate or mount anything. */
export function renderStorage(storage: LimaStorageOptions, sizeGiB: number): string {
  validateStorage(storage, sizeGiB);
  const vdo = storage.vdo;
  const compression = storage.filesystem === "btrfs" ? storage.compression ?? "zstd" : false;
  const layout = JSON.stringify(storageLayout(storage, sizeGiB));
  return `set -euo pipefail
filesystem='${storage.filesystem}'
mountpoint='${storage.mountPoint}'
vdo='${vdo ? "yes" : "no"}'
vdo_compression='${vdo?.compression === false ? "disabled" : "enabled"}'
vdo_deduplication='${vdo?.deduplication === false ? "disabled" : "enabled"}'
logical_size='${vdo?.logicalSizeGiB ?? sizeGiB}G'
compression='${compression || "none"}'
expected_bytes='${sizeGiB * 1024 ** 3}'
layout='${layout}'
` + storageScript;
}

const storageScript = `
mode=\${1:?Expected check or setup}
device=\${2:?Expected data disk}
bytes=\${3:?Expected data disk size}
vg=ws_data
lv=/dev/ws_data/data
marker=/var/lib/workstation/data-storage
fail() { echo "$*" >&2; exit 1; }
[[ $mode == check || $mode == setup ]] || fail 'Expected check or setup'
[[ $device == /dev/vdb && $bytes == "$expected_bytes" ]] || fail 'Unexpected data disk declaration'
[[ $(id -u) == 0 ]] || fail 'Run guest storage setup as root'
[[ -b $device ]] || fail 'Expected Lima data block device /dev/vdb'
[[ $(blockdev --getsize64 "$device") == "$bytes" ]] || fail 'Data disk size mismatch'
if [[ -e $marker ]]; then
  [[ $(cat "$marker") == "$layout" ]] || fail 'Filesystem/layout changed; explicit migration required'
fi
if [[ $vdo == no ]]; then lv=$device; fi
mount_options=defaults,x-systemd.device-timeout=120
fsck_pass=0
if [[ $filesystem == ext4 ]]; then fsck_pass=2; fi
if [[ $filesystem == btrfs ]]; then mount_options+=",compress=$compression"; fi

mount_entry() {
  printf 'UUID=%s %s %s %s 0 %s' "$(blkid -s UUID -o value "$lv")" "$mountpoint" "$filesystem" "$mount_options" "$fsck_pass"
}

check_storage() {
  [[ -f $marker ]] || fail 'Storage is not initialized'
  [[ $(findmnt -n -M "$mountpoint" -o FSTYPE) == "$filesystem" ]] || fail 'Wrong or missing data filesystem'
  [[ $(findmnt -n -M "$mountpoint" -o UUID) == "$(blkid -s UUID -o value "$lv")" ]] || fail 'Mount uses another device'
  if [[ $vdo == yes ]]; then
    [[ $(lvs --noheadings -o segtype "$vg/data" | xargs) == vdo ]] || fail 'Expected VDO logical volume'
    [[ $(lvs --noheadings -o vdo_compression "$vg/pool" | xargs) == "$vdo_compression" ]] || fail 'VDO compression drift'
    [[ $(lvs --noheadings -o vdo_deduplication "$vg/pool" | xargs) == "$vdo_deduplication" ]] || fail 'VDO deduplication drift'
    [[ $(pvs --noheadings -o pv_name --select "vg_name=$vg" | xargs) == "$device" ]] || fail 'Unexpected VDO backing device'
  fi
  if [[ $filesystem == btrfs ]]; then
    local options
    options=",$(findmnt -n -M "$mountpoint" -o OPTIONS),"
    if [[ $compression == none ]]; then
      [[ $options != *,compress=* && $options != *,compress-force=* ]] || fail 'Btrfs compression still enabled'
    else
      [[ $options == *",compress=$compression,"* || $options == *",compress=$compression:"* ]] || fail 'Btrfs compression drift'
    fi
  fi
  grep -Fqx "$(mount_entry)" /etc/fstab || fail 'Persistent mount is missing or changed'
}
if [[ $mode == check ]]; then check_storage; exit; fi

case $filesystem in
  xfs) packages=(xfsprogs) ;;
  ext4) packages=(e2fsprogs) ;;
  btrfs) packages=(btrfs-progs) ;;
esac
if [[ $vdo == yes ]]; then packages+=(vdo lvm2 thin-provisioning-tools); fi
missing=false
for package in "\${packages[@]}"; do
  if [[ $(dpkg-query -W -f='\${db:Status-Status}' "$package" 2>/dev/null) != installed ]]; then missing=true; fi
done
if $missing; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y "\${packages[@]}"
fi
if [[ $vdo == yes ]]; then
  if ! modprobe dm_vdo; then
    apt-get update
    apt-get install -y "linux-modules-extra-$(uname -r)"
    modprobe dm_vdo
  fi
  [[ $(getconf PAGESIZE) == 4096 ]] || fail 'VDO requires a 4 KiB page kernel'
fi
modprobe "$filesystem"

if [[ ! -e $marker ]]; then
  [[ -z $(wipefs --noheadings --output TYPE "$device") ]] || fail 'Refusing to format a disk with existing signatures'
  [[ $(lsblk -nr -o TYPE "$device") == disk ]] || fail 'Data disk already has partitions or holders'
  if [[ $vdo == yes ]] && vgs "$vg" >/dev/null 2>&1; then fail 'Refusing to adopt an existing volume group'; fi
  if findmnt -rn -M "$mountpoint" >/dev/null; then fail 'Mountpoint already in use'; fi
  if [[ -d $mountpoint && -n $(find "$mountpoint" -mindepth 1 -maxdepth 1 -print -quit) ]]; then fail 'Mountpoint is not empty'; fi
  install -d -m 700 /var/lib/workstation
  printf '%s\\n' "$layout" > "$marker"
fi
# Resume partially completed initialization without destroying existing storage.
if [[ $vdo == yes ]]; then
  if ! pvs "$device" >/dev/null 2>&1; then
    [[ -z $(wipefs --noheadings --output TYPE "$device") ]] || fail 'Unexpected data disk signature'
    pvcreate "$device"
  fi
  existing_vg=$(pvs --noheadings -o vg_name "$device" | xargs)
  [[ -z $existing_vg || $existing_vg == "$vg" ]] || fail 'Data disk belongs to another volume group'
  if ! vgs "$vg" >/dev/null 2>&1; then vgcreate "$vg" "$device"; fi
  [[ $(pvs --noheadings -o pv_name --select "vg_name=$vg" | xargs) == "$device" ]] || fail 'Unexpected physical volumes'
  compression_flag=y; deduplication_flag=y
  if [[ $vdo_compression == disabled ]]; then compression_flag=n; fi
  if [[ $vdo_deduplication == disabled ]]; then deduplication_flag=n; fi
  if ! lvs "$vg/data" >/dev/null 2>&1; then
    lvcreate --type vdo --name data --vdopool pool -l 100%FREE -V "$logical_size" --compression "$compression_flag" --deduplication "$deduplication_flag" "$vg"
  fi
  [[ $(lvs --noheadings -o segtype "$vg/data" | xargs) == vdo ]] || fail 'Expected VDO logical volume'
  vgchange -ay "$vg"
  if [[ $(lvs --noheadings -o vdo_compression "$vg/pool" | xargs) != "$vdo_compression" || $(lvs --noheadings -o vdo_deduplication "$vg/pool" | xargs) != "$vdo_deduplication" ]]; then
    lvchange --compression "$compression_flag" --deduplication "$deduplication_flag" "$vg/pool"
  fi
fi
existing_fs=$(blkid -s TYPE -o value "$lv" || test "$?" = 2)
if [[ -z $existing_fs ]]; then
  case $filesystem in
    xfs) mkfs.xfs -K "$lv" ;;
    ext4) mkfs.ext4 -E nodiscard "$lv" ;;
    btrfs) mkfs.btrfs -K "$lv" ;;
  esac
elif [[ $existing_fs != "$filesystem" ]]; then fail 'Refusing filesystem conversion'; fi
entry=$(mount_entry)
# Only a matching UUID, target and filesystem may have its mount options updated.
if ! grep -Fqx "$entry" /etc/fstab; then
  uuid=$(blkid -s UUID -o value "$lv")
  if awk -v target="$mountpoint" -v source="UUID=$uuid" -v fs="$filesystem" '$1 !~ /^#/ && $2 == target && ($1 != source || $3 != fs) { conflict=1 } END { exit !conflict }' /etc/fstab; then fail 'Conflicting fstab entry'; fi
  temporary=$(mktemp /etc/fstab.workstation.XXXXXX)
  awk -v target="$mountpoint" '$1 ~ /^#/ || $2 != target' /etc/fstab > "$temporary"
  printf '%s\\n' "$entry" >> "$temporary"
  chmod --reference=/etc/fstab "$temporary"
  chown --reference=/etc/fstab "$temporary"
  mv "$temporary" /etc/fstab
fi
mkdir -p "$mountpoint"
systemctl daemon-reload
if ! findmnt -rn -M "$mountpoint" >/dev/null; then
  mount "$mountpoint"
elif [[ $(findmnt -n -M "$mountpoint" -o UUID) != "$(blkid -s UUID -o value "$lv")" ]]; then
  fail 'Mountpoint uses another device'
elif [[ $filesystem == btrfs ]]; then
  mount -o "remount,compress=$compression" "$mountpoint"
fi
check_storage
if [[ -n \${SUDO_USER:-} && $SUDO_USER != root ]]; then chown "$SUDO_USER:$(id -gn "$SUDO_USER")" "$mountpoint"; fi
`;
