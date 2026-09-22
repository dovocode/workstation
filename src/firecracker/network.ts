/** Render dedicated TAP and NAT setup; only rules bearing this VM's identity are removed. */
export function renderNetwork(tap: string, owner: string, host: string, guest: string): string {
  return `#!/bin/bash
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
tap=${tap}
tag=workstation-firecracker-${owner}
host=${host}
guest=${guest}
# iptables -C returns 1 for an absent rule; other failures must not become mutations.
rule() {
  local table=$1 chain=$2 action=$3
  shift 3
  local code=0
  iptables -w -t "$table" -C "$chain" "$@" 2>/dev/null || code=$?
  if [ "$code" -gt 1 ]; then return "$code"; fi
  if [ "$action" = up ] && [ "$code" = 1 ]; then iptables -w -t "$table" -I "$chain" 1 "$@"; fi
  if [ "$action" = down ] && [ "$code" = 0 ]; then iptables -w -t "$table" -D "$chain" "$@"; fi
}
action=$1
case "$action" in up|down|check) ;; *) exit 2 ;; esac
if ip link show dev "$tap" >/dev/null 2>&1; then
  [ "$(cat /sys/class/net/"$tap"/ifalias)" = "$tag" ] || { echo 'Refusing an unowned TAP interface' >&2; exit 1; }
elif [ "$action" = up ]; then
  ip tuntap add dev "$tap" mode tap
  ip link set dev "$tap" alias "$tag"
elif [ "$action" = check ]; then exit 1
fi
if [ "$action" = check ]; then
  ip -4 address show dev "$tap" | grep -F "inet $host/30 " >/dev/null
  [ "$(sysctl -n net.ipv4.ip_forward)" = 1 ]
  iptables -w -t nat -C POSTROUTING -s "$guest/32" ! -d "$host/30" -m comment --comment "$tag" -j MASQUERADE
  iptables -w -C FORWARD -i "$tap" -s "$guest/32" -m comment --comment "$tag" -j ACCEPT
  iptables -w -C FORWARD -o "$tap" -d "$guest/32" -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment "$tag" -j ACCEPT
  exit
fi
if [ "$action" = up ]; then
  ip address replace "$host/30" dev "$tap"
  ip link set dev "$tap" up
  sysctl -w net.ipv4.ip_forward=1 >/dev/null
fi
rule nat POSTROUTING "$action" -s "$guest/32" ! -d "$host/30" -m comment --comment "$tag" -j MASQUERADE
rule filter FORWARD "$action" -i "$tap" -s "$guest/32" -m comment --comment "$tag" -j ACCEPT
rule filter FORWARD "$action" -o "$tap" -d "$guest/32" -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment "$tag" -j ACCEPT
if [ "$action" = down ] && ip link show dev "$tap" >/dev/null 2>&1; then ip link delete dev "$tap"; fi
`;
}
