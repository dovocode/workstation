/** An immutable HTTPS download. Archives may select one regular file by its exact member name. */
export interface FirecrackerArtifact {
  readonly url: string;
  readonly sha256: string;
  /** Optional member of a gzip-compressed tar archive (for Firecracker release binaries). */
  readonly member?: string;
}

/** macOS Linux host selection. Both providers must expose working KVM and systemd. */
export interface FirecrackerHost {
  readonly provider: "lima" | "orb";
  /** Dedicated outer machine; defaults to workstation-firecracker. */
  readonly name?: string;
}

/** A persistent development microVM, reconciled through retained provisioning resources. */
export interface FirecrackerVmOptions {
  readonly architecture: "x86_64" | "aarch64";
  readonly kernel: FirecrackerArtifact;
  /** Uncompressed ext4 filesystem with root SSH login by key and an enabled SSH server. */
  readonly rootfs: FirecrackerArtifact;
  readonly binary: FirecrackerArtifact;
  readonly guest: {
    /** Native Linux Workstation executable for the guest architecture. */
    readonly workstation: FirecrackerArtifact;
    /** Self-contained TypeScript configuration, copied into the guest. */
    readonly config: string;
  };
  readonly cpus?: number;
  readonly memoryMiB?: number;
  /** An unused RFC1918 IPv4 /30. Host uses .1 and guest .2 within this subnet. */
  readonly subnet: string;
  readonly dns?: string;
  /** Defaults to Lima on macOS; ignored on Linux, where execution is native. */
  readonly macos?: FirecrackerHost;
}

/** Quote exactly one POSIX shell argument, including embedded single quotes. */
export function shellArgument(value: string): string {
  if (value.includes("\0")) throw new Error("NUL is not allowed in Firecracker arguments");
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Validate downloads before generating any privileged commands. */
export function validateArtifact(artifact: FirecrackerArtifact): void {
  const url = new URL(artifact.url);
  if (url.protocol !== "https:" || url.username || url.password || !/^[a-fA-F0-9]{64}$/.test(artifact.sha256)) throw new Error("Firecracker artifacts require HTTPS and a SHA-256 digest");
  if (artifact.member !== undefined && !/^[A-Za-z0-9_][A-Za-z0-9_./+-]*$/.test(artifact.member)) throw new Error("Invalid artifact archive member");
}

/** Parse canonical IPv4, rejecting ambiguous leading zeros and out-of-range octets. */
export function ipv4(value: string): number[] {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some(part => !/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255)) throw new Error("Invalid Firecracker IPv4 address");
  return parts.map(Number);
}
