import { createHash } from "node:crypto";
import { shellArgument as q, ipv4, type FirecrackerVmOptions, type FirecrackerArtifact } from "./options.js";
import { renderNetwork } from "./network.js";

/** Emit a pinned download invocation. Archive extraction streams one file without extracting paths. */
function artifact(name: string, value: FirecrackerArtifact): string {
  return `download ${q(name)} ${q(value.url)} ${q(value.sha256.toLowerCase())} ${q(value.member ?? "")}`;
}

/** Render the Linux lifecycle implementation, transported identically for native, Lima and Orb hosts. */
export function renderMicrovm(name: string, owner: string, options: FirecrackerVmOptions): string {
  const address = ipv4(options.subnet.split("/")[0]!);
  const host = [...address.slice(0, 3), address[3]! + 1].join(".");
  const guest = [...address.slice(0, 3), address[3]! + 2].join(".");
  const tap = `wfc${owner.slice(0, 11)}`;
  const dir = `/var/lib/workstation-firecracker/${name}`;
  const unit = `workstation-firecracker-${name}.service`;
  const network = renderNetwork(tap, owner, host, guest);
  const config = JSON.stringify({
    "boot-source": { kernel_image_path: `${dir}/kernel`, boot_args: `console=ttyS0 reboot=k panic=1 pci=off root=/dev/vda rw ip=${guest}::${host}:255.255.255.252:${name}:eth0:off` },
    drives: [{ drive_id: "rootfs", path_on_host: `${dir}/rootfs.ext4`, is_root_device: true, is_read_only: false }],
    "machine-config": { vcpu_count: options.cpus ?? 2, mem_size_mib: options.memoryMiB ?? 1024 },
    "network-interfaces": [{ iface_id: "eth0", guest_mac: `02:${owner.slice(0, 10).match(/../g)!.join(":")}`, host_dev_name: tap }],
  });
  const service = `[Unit]\nDescription=Workstation Firecracker ${name}\nAfter=network-online.target\nWants=network-online.target\n[Service]\nType=simple\nExecStartPre=${dir}/network up\nExecStart=${dir}/firecracker --no-api --config-file ${dir}/vm.json\nExecStopPost=${dir}/network down\nRestart=no\nTimeoutStopSec=30\nKillMode=control-group\n[Install]\nWantedBy=multi-user.target\n`;
  const desired = createHash("sha256").update(JSON.stringify(options)).update(network).update(service).update("v1").digest("hex");
  return `set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077
dir=${q(dir)}
unit=${q(unit)}
owner=${q(owner)}
desired=${q(desired)}
unit_content=${q(service)}
guest=${q(guest)}
operation=$1
shift
fail() { echo "$*" >&2; exit 1; }
owned() { [ -f "$dir/owner" ] && [ "$(cat "$dir/owner")" = "$owner" ]; }
ssh_guest() { ssh -F /dev/null -i "$dir/id_ed25519" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=3 -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$dir/known_hosts" "root@$guest" "$@"; }
healthy() {
  owned && [ -f "$dir/rootfs.ext4" ] && [ -f "$dir/applied" ] && [ "$(cat "$dir/applied")" = "$desired" ] &&
  systemctl is-active --quiet "$unit" && systemctl is-enabled --quiet "$unit" &&
  cmp -s "$dir/unit" "/etc/systemd/system/$unit" && sha256sum --check --status "$dir/managed.sha256" && "$dir/network" check
}
case "$operation" in
  check|status) healthy; exit $? ;;
  up|stop|destroy|provision|exec) ;;
  *) fail "Unknown Firecracker operation: $operation" ;;
esac
if [ "$operation" != exec ] && [ "$#" -ne 0 ]; then fail 'This lifecycle task does not accept extra arguments'; fi
[ "$(uname -s)" = Linux ] || fail 'Firecracker requires Linux'
[ "$(uname -m)" = ${q(options.architecture)} ] || fail 'Firecracker image architecture does not match the Linux host'
[ "$(id -u)" = 0 ] || fail 'Firecracker management requires root'
[ -d /run/systemd/system ] || fail 'Firecracker management requires systemd'
install -d -m 0700 /var/lib/workstation-firecracker
exec 9>/var/lib/workstation-firecracker/lock
flock -x 9
if [ -e "$dir" ]; then owned || fail 'Refusing an unowned Firecracker VM directory';
elif [ "$operation" = up ]; then
  [ ! -e "/etc/systemd/system/$unit" ] || fail 'Refusing an existing unowned service'
  install -d -m 0700 "$dir"
  printf '%s' "$owner" > "$dir/owner"
else fail 'VM is absent; run build or the up task first'; fi
if [ -e "/etc/systemd/system/$unit" ]; then
  if ! cmp -s "$dir/unit" "/etc/systemd/system/$unit" && ! cmp -s <(printf '%s' "$unit_content") "/etc/systemd/system/$unit"; then fail 'Managed unit was edited externally'; fi
fi
case "$operation" in
  stop|destroy)
    if [ -e "/etc/systemd/system/$unit" ]; then systemctl disable --now "$unit"; fi
    if [ -x "$dir/network" ]; then "$dir/network" down; fi
    if [ "$operation" = destroy ]; then
      rm -f -- "/etc/systemd/system/$unit"
      systemctl daemon-reload
      rm -rf -- "$dir"
    fi
    exit ;;
  exec)
    [ "$#" -gt 0 ] || fail 'Pass a guest command after --'
    # POSIX shell quoting, independent of the guest login shell's printf implementation.
    remote=$(python3 -c 'import shlex,sys; print(shlex.join(sys.argv[1:]))' "$@")
    ssh_guest "$remote"
    exit ;;
esac
[ -c /dev/kvm ] || fail 'KVM is unavailable; the macOS provider must support nested virtualization'
for tool in curl sha256sum tar ip iptables sysctl systemctl flock ssh scp ssh-keygen debugfs python3; do command -v "$tool" >/dev/null || fail "Missing Linux prerequisite: $tool"; done
python3 -c 'import os,fcntl; fd=os.open("/dev/kvm", os.O_RDWR); assert fcntl.ioctl(fd, 0xAE00, 0) == 12, "Unsupported KVM API"; os.close(fd)'
# Persist the original disk identity; upgrades never replace a writable guest disk.
if [ -f "$dir/rootfs.sha256" ]; then
  [ "$(cat "$dir/rootfs.sha256")" = ${q(options.rootfs.sha256.toLowerCase())} ] || fail 'Rootfs pin changed. Back up the VM and explicitly destroy it before recreating.'
fi
download() {
  local name=$1 url=$2 digest=$3 member=$4
  local target="$dir/$name" temporary="$dir/download.tmp"
  if [ -f "$target" ] && [ -f "$target.source" ] && [ "$(cat "$target.source")" = "$digest:$member" ] && sha256sum --check --status "$target.sha256"; then return; fi
  curl --fail --location --proto '=https' --proto-redir '=https' --silent --show-error "$url" -o "$temporary"
  printf '%s  %s\\n' "$digest" "$temporary" | sha256sum --check --status || fail "Checksum mismatch: $name"
  if [ -n "$member" ]; then tar -xzOf "$temporary" -- "$member" > "$target.new"; else mv "$temporary" "$target.new"; fi
  mv "$target.new" "$target"
  sha256sum "$target" > "$target.sha256"
  printf '%s' "$digest:$member" > "$target.source"
  rm -f "$temporary"
}
wait_guest() {
  local deadline=$((SECONDS + 120))
  until ssh_guest true 2>"$dir/ssh-error"; do
    systemctl is-active --quiet "$unit" || fail "VM exited; inspect journalctl -u $unit"
    [ "$SECONDS" -lt "$deadline" ] || { cat "$dir/ssh-error" >&2; fail 'Timed out waiting for guest SSH (120 seconds)'; }
    sleep 1
  done
}
provision_guest() {
  ${artifact("workstation", options.guest.workstation)}
  printf '%s' ${q(options.guest.config)} > "$dir/guest.ts"
  chmod 0755 "$dir/workstation"
  scp -F /dev/null -i "$dir/id_ed25519" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$dir/known_hosts" "$dir/workstation" "$dir/guest.ts" "root@$guest:/root/"
  ssh_guest ${q(`printf 'nameserver %s\\n' '${options.dns ?? "1.1.1.1"}' > /etc/resolv.conf`)}
  ssh_guest 'install -m 0755 /root/workstation /usr/local/bin/workstation && workstation build --config /root/guest.ts'
}
if [ "$operation" = provision ]; then wait_guest; provision_guest; exit; fi
if healthy; then exit; fi
if [ -e "/etc/systemd/system/$unit" ]; then systemctl stop "$unit"; fi
if [ -x "$dir/network" ]; then "$dir/network" down; fi
# Reserve the requested /30 across all managed machines, including stopped VMs.
for other in /var/lib/workstation-firecracker/*/subnet; do
  [ -f "$other" ] || continue
  if [ "$other" != "$dir/subnet" ] && [ "$(cat "$other")" = ${q(options.subnet)} ]; then fail 'Firecracker subnet is already reserved by another VM'; fi
done
routes=$(ip -j -4 route show table all)
python3 -c 'import ipaddress,json,sys; subnet=ipaddress.ip_network(sys.argv[1]); routes=json.loads(sys.argv[2]); conflicts=[r for r in routes if r.get("dst", "default") != "default" and subnet.overlaps(ipaddress.ip_network(r["dst"], strict=False))]; sys.exit("Requested subnet overlaps a host route; choose an unused /30" if conflicts else 0)' ${q(options.subnet)} "$routes"
printf '%s' ${q(options.subnet)} > "$dir/subnet"
${artifact("kernel", options.kernel)}
${artifact("firecracker", options.binary)}
chmod 0755 "$dir/firecracker"
if [ ! -f "$dir/rootfs.ext4" ]; then
  ${artifact("base.ext4", options.rootfs)}
  cp --sparse=always "$dir/base.ext4" "$dir/rootfs.new"
  rm -f "$dir/id_ed25519" "$dir/id_ed25519.pub" "$dir/host_ed25519" "$dir/host_ed25519.pub"
  ssh-keygen -q -t ed25519 -N '' -f "$dir/id_ed25519"
  ssh-keygen -q -t ed25519 -N '' -f "$dir/host_ed25519"
  debugfs -w -R 'mkdir /root/.ssh' "$dir/rootfs.new"
  # debugfs can exit zero on errors; read back each write and compare it.
  disk_write() {
    local source=$1 target=$2 mode=$3
    debugfs -w -R "rm $target" "$dir/rootfs.new" 2>/dev/null
    debugfs -w -R "write $source $target" "$dir/rootfs.new"
    debugfs -w -R "set_inode_field $target mode $mode" "$dir/rootfs.new"
    debugfs -R "cat $target" "$dir/rootfs.new" > "$dir/disk-check"
    cmp -s "$source" "$dir/disk-check" || fail "Cannot prepare rootfs: $target"
  }
  disk_write "$dir/id_ed25519.pub" /root/.ssh/authorized_keys 0100600
  disk_write "$dir/host_ed25519" /etc/ssh/ssh_host_ed25519_key 0100600
  disk_write "$dir/host_ed25519.pub" /etc/ssh/ssh_host_ed25519_key.pub 0100644
  printf 'nameserver %s\\n' ${q(options.dns ?? "1.1.1.1")} > "$dir/resolv.conf"
  disk_write "$dir/resolv.conf" /etc/resolv.conf 0100644
  printf '%s' ${q(options.rootfs.sha256.toLowerCase())} > "$dir/rootfs.sha256"
  mv "$dir/rootfs.new" "$dir/rootfs.ext4"
fi
printf '%s ' "$guest" > "$dir/known_hosts"
cat "$dir/host_ed25519.pub" >> "$dir/known_hosts"
printf '%s' ${q(network)} > "$dir/network"
chmod 0700 "$dir/network"
printf '%s' ${q(config)} > "$dir/vm.json"
printf '%s' "$unit_content" > "$dir/unit.new"
sha256sum "$dir/network" "$dir/vm.json" "$dir/kernel" "$dir/firecracker" > "$dir/managed.sha256"
install -m 0644 "$dir/unit.new" "/etc/systemd/system/$unit"
mv "$dir/unit.new" "$dir/unit"
systemctl daemon-reload
systemctl enable --now "$unit"
wait_guest
provision_guest
printf '%s' "$desired" > "$dir/applied.new"
mv "$dir/applied.new" "$dir/applied"
healthy
`;
}
