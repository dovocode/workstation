import { provision, type ProvisionResource } from "../api/provision.js";
import { shellArgument as q, type FirecrackerHost } from "./options.js";
import type { CommandSpec } from "../api/types.js";

const prerequisites = "for tool in bash curl sha256sum tar ip iptables sysctl systemctl flock ssh scp ssh-keygen debugfs python3; do command -v \"$tool\" >/dev/null || exit 1; done; test -c /dev/kvm && test -d /run/systemd/system";

/** Check the provider's inventory before executing anything that could implicitly boot a machine. */
function runningCheck(host: FirecrackerHost): string {
  const name = host.name ?? "workstation-firecracker";
  const list = host.provider === "lima" ? `limactl list --format '{{if eq .Status "Running"}}{{.Name}}{{end}}'` : "orb list --running --quiet";
  return `names=$(${list})\nfound=false\nwhile IFS= read -r item; do if [ "$item" = ${q(name)} ]; then found=true; fi; done <<< "$names"\n$found || { echo 'Firecracker Linux host is stopped or absent; run workstation build first.' >&2; exit 1; }`;
}

/** Transport literal script and task arguments into the Linux host without a shared filesystem. */
export function hostCommand(host: FirecrackerHost | undefined, script: string, operation: string): CommandSpec {
  const args = ["bash", "-c", script, "workstation-firecracker", operation];
  if (!host) return { command: "sudo", args: ["--", ...args] };
  const name = host.name ?? "workstation-firecracker";
  const invocation = host.provider === "orb" ? ["orb", "-m", name, "-u", "root", "--", ...args] : ["limactl", "shell", name, "sudo", "--", ...args];
  return { command: "bash", args: ["-c", `set -euo pipefail\n${runningCheck(host)}\nexec ${invocation.map(q).join(" ")} "$@"`, "workstation-firecracker-host"] };
}

/** Declare the Linux prerequisite check or create/start a dedicated macOS Linux machine. */
export function hostResources(host: FirecrackerHost | undefined): ProvisionResource[] {
  if (!host) return [provision("firecracker-host-native", { type: "check", check: { command: "bash", args: ["-c", prerequisites] }, repair: [{ command: "sudo", args: ["--", "bash", "-c", `set -euo pipefail
[ -c /dev/kvm ] && [ -d /run/systemd/system ] || { echo 'Firecracker requires Linux with KVM and systemd.' >&2; exit 1; }
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y curl ca-certificates iproute2 iptables openssh-client e2fsprogs python3 util-linux
elif command -v dnf >/dev/null; then
  dnf install -y curl ca-certificates iproute iptables openssh-clients e2fsprogs python3 util-linux
elif command -v pacman >/dev/null; then
  pacman -S --needed --noconfirm curl ca-certificates iproute2 iptables openssh e2fsprogs python util-linux
else echo 'Install curl, iproute2, iptables, OpenSSH, e2fsprogs, Python 3 and util-linux using your package manager.' >&2; exit 1; fi
${prerequisites}`] }] })];
  const name = host.name ?? "workstation-firecracker";
  const execute = hostCommand(host, prerequisites, "check");
  const invocation = [execute.command, ...(execute.args ?? [])].map(q).join(" ");
  const check = invocation;
  const create = host.provider === "lima"
    ? `names=$(limactl list --format '{{.Name}}')\nfound=false\nwhile IFS= read -r item; do if [ "$item" = ${q(name)} ]; then found=true; fi; done <<< "$names"\nif ! $found; then limactl create --tty=false --name=${q(name)} --vm-type=vz --set '.nestedVirtualization = true | .mounts = [] | .containerd.user = false | .containerd.system = false' template:ubuntu; fi\nlimactl start --tty=false ${q(name)}`
    : `names=$(orb list --quiet)\nfound=false\nwhile IFS= read -r item; do if [ "$item" = ${q(name)} ]; then found=true; fi; done <<< "$names"\nif ! $found; then orb create --isolated ubuntu:24.04 ${q(name)}; fi\norb start ${q(name)}`;
  const setup = hostCommand(host, `set -euo pipefail\nif [ ! -c /dev/kvm ]; then echo 'This ${host.provider} machine does not expose KVM. Firecracker needs nested virtualization; use Lima vz on supported M3+ / macOS 15+ hardware if OrbStack cannot expose it.' >&2; exit 1; fi\nif ! (${prerequisites}); then export DEBIAN_FRONTEND=noninteractive; apt-get update; apt-get install -y curl ca-certificates iproute2 iptables openssh-client e2fsprogs python3 util-linux; fi\n${prerequisites}`, "setup");
  return [provision(`firecracker-host-${host.provider}-${name}`, { type: "check", check: { command: "bash", args: ["-c", `set -euo pipefail\n${check}`] }, repair: [{ command: "bash", args: ["-c", `set -euo pipefail\n${create}`] }, setup] })];
}
