export type Platform = "darwin" | "linux";
export type PackageManager = "mise" | "brew" | "brew-cask" | "apt" | "dnf" | "yum" | "pacman" | "flatpak" | "mas" | "system";

/** Flatpak installation target; the selected remote must already be configured. */
export interface FlatpakOptions {
  readonly scope?: "user" | "system";
  readonly remote?: string;
  readonly branch?: string;
}

/** Homebrew cask upgrade behavior. */
export interface BrewCaskUpgradeOptions {
  /** Include auto-updating casks and refresh their lock pins on each run. */
  readonly greedy?: boolean;
  /** Pass --force when upgrading a cask; does not by itself trigger an upgrade. */
  readonly force?: boolean;
}

/** Machine and path information passed to a configuration factory. */
export interface Context {
  /** Short hostname by default, or the exact `--machine` override. */
  readonly machine: string;
  /** Full operating-system hostname. */
  readonly hostname: string;
  /** Operating system detected on the executing machine. */
  readonly platform: Platform;
  /** Absolute home directory of the executing user. */
  readonly home: string;
  /** Absolute directory of the TypeScript entry point; imported fragments share this base. */
  readonly configDir: string;
}

export interface PackageResource {
  readonly kind: "package";
  readonly manager: PackageManager;
  readonly name: string;
  readonly version?: string;
  readonly upgrade?: BrewCaskUpgradeOptions;
  readonly flatpak?: FlatpakOptions;
}

export interface ResolvedPackageResource extends PackageResource {
  /** Concrete version resolved into workstation.lock. */
  readonly lockedVersion?: string;
}

export interface SymlinkResource {
  readonly kind: "symlink";
  readonly source: string;
  readonly target: string;
}

export interface LaunchAgentResource {
  readonly kind: "launch-agent";
  readonly label: string;
  readonly program: string;
  readonly args?: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly runAtLoad?: boolean;
  readonly keepAlive?: boolean;
  readonly stdoutPath?: string;
  readonly stderrPath?: string;
}

export type StructuredFormat = "toml" | "yaml" | "json" | "jsonc" | "zsh" | "bash";
/** `overwrite` saves and replaces unmanaged files; `update` rejects unmanaged differences; `ignore` preserves existing targets. */
export type IfExistsPolicy = "update" | "overwrite" | "ignore";
export type ConfigValue =
  | string
  | number
  | boolean
  | null
  | readonly ConfigValue[]
  | Readonly<{ [key: string]: ConfigValue }>;

export interface GeneratedFileResource {
  /** Pre-rendered JSONC from the typed builder. Used only with format jsonc. */
  readonly renderedContent?: string;
  readonly kind: "generated-file";
  readonly target: string;
  readonly format: StructuredFormat;
  readonly value: ConfigValue;
  readonly ifExists: IfExistsPolicy;
  readonly mode?: number;
}

export type SystemdScope = "user" | "system";

export interface SystemdServiceResource {
  readonly kind: "systemd-service";
  readonly name: string;
  readonly description?: string;
  readonly program: string;
  readonly args?: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly restart?: "no" | "on-failure" | "always";
  readonly wantedBy?: string;
  readonly scope: SystemdScope;
}

/** Run a program directly, without an implicit shell. Custom builds expand {source}, {output}, and {target}. */
export interface CommandSpec {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string>>;
}

/** A named direct command with a description shown by --list-tasks. */
export interface TaskDefinition extends CommandSpec {
  readonly description?: string;
}

export interface CustomToolResource {
  readonly kind: "custom-tool";
  readonly name: string;
  readonly source: string;
  readonly sourceHash?: string;
  readonly target: string;
  readonly build: CommandSpec;
}

export type Resource =
  | PackageResource
  | SymlinkResource
  | LaunchAgentResource
  | GeneratedFileResource
  | SystemdServiceResource
  | CustomToolResource;
/** One resource or nested arrays. False, null, and undefined are ignored. */
export type ResourceInput = Resource | readonly ResourceInput[] | false | null | undefined;

/** A composable configuration fragment. Prefer the exported helpers to constructing resources manually. */
export interface ConfigDefinition {
  /** Named commands executed explicitly with workstation <task>. */
  readonly tasks?: Readonly<Record<string, TaskDefinition>>;
  /** Alternate task names; alias chains are supported and cycles rejected. */
  readonly aliases?: Readonly<Record<string, string>>;
  /** Default package manager for tools.system on each platform. */
  readonly managers?: Partial<Record<Platform, Exclude<PackageManager, "system">>>;
  /** Shared resource declarations, evaluated in order. */
  readonly resources?: ResourceInput;
  /** Additional resources keyed by exact machine name. */
  readonly machines?: Readonly<Record<string, ResourceInput>>;
  /** Local ownership/backup state path. Defaults to ~/.local/state/workstation/state.json; do not commit it. */
  readonly stateFile?: string;
}

/** A fragment, factory, or nested array of fragments; absent fragments are ignored. */
export type ConfigInput =
  | ConfigDefinition
  | ConfigFactory
  | readonly ConfigInput[]
  | false
  | null
  | undefined;
/** Compute a configuration fragment using the current machine context. */
export type ConfigFactory = (context: Context) => ConfigInput;
/** Accepted default export from workstation.config.ts. */
export type WorkstationConfig = ConfigInput;

export interface ResolvedConfig {
  readonly tasks?: Readonly<Record<string, TaskDefinition>>;
  readonly aliases?: Readonly<Record<string, string>>;
  readonly context: Context;
  readonly resources: readonly ResolvedResource[];
  readonly stateFile: string;
}

export type ResolvedResource = ResolvedPackageResource | Exclude<Resource, PackageResource>;

export type OriginalFile =
  | { readonly kind: "file"; readonly content: string; readonly mode: number }
  | { readonly kind: "symlink"; readonly target: string };

export interface StateEntry {
  readonly id: string;
  readonly fingerprint: string;
  readonly owned: boolean;
  readonly resource: ResolvedResource;
  readonly installedVersion?: string;
  readonly installedHash?: string;
  readonly originalFile?: OriginalFile;
}

export interface WorkstationState {
  readonly version: 1;
  readonly machine: string;
  readonly resources: Readonly<Record<string, StateEntry>>;
}

export type ActionType = "create" | "adopt" | "update" | "remove" | "forget";

export interface Action {
  readonly type: ActionType;
  readonly id: string;
  readonly resource: ResolvedResource;
  readonly previous?: StateEntry;
  readonly reason: string;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Command execution boundary, replaceable in tests or embedded integrations. */
export interface Runner {
  /** Report a resource-level progress message when supported by the host. */
  report?(message: string): void;
  /** Execute a command directly and return captured output and its exit code; spawn failures reject. */
  run(command: string, args: readonly string[], options?: RunOptions): Promise<CommandResult>;
}


export interface RunOptions {
  /** Stream captured output when the process runner has progress logging enabled. */
  readonly streamOutput?: boolean;
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string>>;
}
