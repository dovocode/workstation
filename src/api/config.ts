import { JsoncDocument } from "./jsonc.js";
import type {
  BrewCaskUpgradeOptions,
  FlatpakOptions,
  ConfigFactory,
  ConfigInput,
  Context,
  ConfigValue,
  CustomToolResource,
  GeneratedFileResource,
  IfExistsPolicy,
  LaunchAgentResource,
  PackageManager,
  PackageResource,
  ResourceInput,
  SymlinkResource,
  StructuredFormat,
  SystemdServiceResource,
  WorkstationConfig,
} from "./types.js";

/** Normalize package names or version selectors into resource declarations. */
function packageList(
  manager: PackageManager,
  packages: readonly string[] | Readonly<Record<string, string>>,
  upgrade?: BrewCaskUpgradeOptions,
): PackageResource[] {
  if (Array.isArray(packages)) {
    return packages.map((name) => ({
      kind: "package",
      manager,
      name,
      ...(upgrade ? { upgrade } : {}),
    }));
  }

  return Object.entries(packages).map(([name, version]) => ({
    kind: "package",
    manager,
    name,
    version,
  }));
}

/** Declare packages; installation happens when the Workstation CLI runs. */
export const tools = {
  /**
   * Install mise tools. A list requests `latest`; a map accepts version selectors.
   * @example tools.mise({ node: "lts", go: "1.27" })
   */
  mise: (packages: readonly string[] | Readonly<Record<string, string>>): PackageResource[] =>
    packageList("mise", packages),
  /** Install Homebrew formulae (command-line packages). */
  brew: (packages: readonly string[]): PackageResource[] => packageList("brew", packages),
  /**
   * Install macOS applications. Greedy casks participate in explicit upgrades.
   * @example tools.brewCask(["ghostty"], { greedy: true, force: true })
   */
  brewCask: (
    packages: readonly string[],
    upgrade?: BrewCaskUpgradeOptions,
  ): PackageResource[] => packageList("brew-cask", packages, upgrade),
  /** Install Debian/Ubuntu packages through APT. Mutations request sudo. */
  apt: (packages: readonly string[]): PackageResource[] => packageList("apt", packages),
  /** Install RPM packages through DNF. Mutations request sudo. */
  dnf: (packages: readonly string[]): PackageResource[] => packageList("dnf", packages),
  /** Install RPM packages through legacy YUM. Mutations request sudo. */
  yum: (packages: readonly string[]): PackageResource[] => packageList("yum", packages),
  /** Install Arch Linux repository packages through pacman; does not refresh databases or upgrade the whole system. */
  pacman: (packages: readonly string[]): PackageResource[] => packageList("pacman", packages),
  /** Install Flatpak app IDs; defaults to the user's flathub remote and stable branch. */
  flatpak: (packages: readonly string[], options: FlatpakOptions = {}): PackageResource[] =>
    packages.map((name) => ({ kind: "package", manager: "flatpak", name, flatpak: { ...options } })),
  /** Install previously acquired Mac App Store apps by numeric ID; follows available updates without version pins. */
  mas: (ids: readonly (string | number)[]): PackageResource[] => ids.map((id) => {
    if ((typeof id === "number" && !Number.isSafeInteger(id)) || !/^[1-9]\d*$/.test(String(id))) {
      throw new Error(`Invalid Mac App Store ID: ${id}`);
    }
    return { kind: "package", manager: "mas", name: String(id) };
  }),
  /** Use the configured manager, Homebrew on macOS, or detect APT/DNF/YUM/pacman on Linux. */
  system: (packages: readonly string[]): PackageResource[] => packageList("system", packages),
};

/**
 * Link a config-relative source to a home-relative target. Absolute paths are supported.
 * @example symlink("dotfiles/gitconfig", "~/.gitconfig")
 */
export function symlink(source: string, target: string): SymlinkResource {
  return { kind: "symlink", source, target };
}

/**
 * Declare a macOS user LaunchAgent. Use inside `darwin(...)`.
 * @param label Unique launchd label, for example `dev.example.worker`.
 */
export function launchAgent(
  label: string,
  options: Omit<LaunchAgentResource, "kind" | "label">,
): LaunchAgentResource {
  return { kind: "launch-agent", label, ...options };
}

/** Control how a generated file replaces existing content and its Unix permissions. */
export interface GeneratedFileOptions {
  /** Existing-file policy. Defaults to `overwrite`, with the original saved for restoration. */
  readonly ifExists?: IfExistsPolicy;
  /** Unix permissions as an octal number. Defaults to `0o644`; use `0o600` for private files. */
  readonly mode?: number;
}

/** Create a generated-file declaration with the default overwrite policy. */
function generatedFile(
  format: StructuredFormat,
  target: string,
  value: ConfigValue,
  options: GeneratedFileOptions = {},
): GeneratedFileResource {
  return {
    kind: "generated-file",
    format,
    target,
    value,
    ifExists: options.ifExists ?? "overwrite",
    ...(options.mode !== undefined ? { mode: options.mode } : {}),
  };
}

/** Generate structured files from ordinary TypeScript values. Targets resolve relative to home. */
export const files = {
  /** Generate mise activation from the same exact pins used for installation. */
  mise: (target: string, versions: Readonly<Record<string, string>>, settings: Readonly<Record<string, ConfigValue>> = {}): GeneratedFileResource => ({
    ...generatedFile("toml", target, { settings, tools: versions }), miseSelectors: versions,
  }),
  /** Merge literal single-line environment values, preserving unrelated keys. Defaults to private permissions. */
  dotenv: (target: string, values: Readonly<Record<string, string>>, options: GeneratedFileOptions = {}): GeneratedFileResource =>
    generatedFile("dotenv", target, values, { ...options, ifExists: options.ifExists ?? "merge", mode: options.mode ?? 0o600 }),
  /** Replace text between two unique markers in an existing file, preserving the markers and surrounding content. */
  inject: (target: string, content: string, markers: { readonly start: string; readonly end: string }, options: { readonly mode?: number } = {}): GeneratedFileResource =>
    generatedFile("bash", target, { content, start: markers.start, end: markers.end }, { ...options, ifExists: "inject" }),
  /**
   * Generate TOML. Values must be representable in TOML (for example, no null).
   * @example files.toml("~/.config/app/config.toml", { server: { port: 3000 } })
   */
  toml: (target: string, value: ConfigValue, options?: GeneratedFileOptions) =>
    generatedFile("toml", target, value, options),
  /** Generate YAML with the standard overwrite/restore policy. */
  yaml: (target: string, value: ConfigValue, options?: GeneratedFileOptions) =>
    generatedFile("yaml", target, value, options),
  /**
   * Generate formatted JSON.
   * @example files.json("~/.config/app/config.json", { enabled: true })
   */
  json: (target: string, value: ConfigValue, options?: GeneratedFileOptions) =>
    generatedFile("json", target, value, options),
  /** Generate JSONC from plain data or jsonc.concat/object commands with comments. */
  jsonc: (target: string, value: ConfigValue | JsoncDocument, options?: GeneratedFileOptions): GeneratedFileResource =>
    value instanceof JsoncDocument
      ? { ...generatedFile("jsonc", target, null, options), renderedContent: value.content }
      : generatedFile("jsonc", target, value, options),
};

/**
 * Declare a Linux systemd service. Defaults to user scope; system scope uses sudo.
 * Use inside `linux(...)`. The `.service` suffix is added when omitted.
 */
export function systemdService(
  name: string,
  options: Omit<SystemdServiceResource, "kind" | "name" | "scope"> & {
    readonly scope?: SystemdServiceResource["scope"];
  },
): SystemdServiceResource {
  return { kind: "systemd-service", name, scope: options.scope ?? "user", ...options };
}

/**
 * Build a local source tree into an executable. Source changes trigger a rebuild.
 * The build must write `{output}`; `{source}` and `{target}` are also available in arguments.
 * @example customTool("hello", { source: "tools/hello", target: "~/.local/bin/hello", build: { command: "go", args: ["build", "-o", "{output}", "{source}"] } })
 */
export function customTool(
  name: string,
  options: Omit<CustomToolResource, "kind" | "name" | "sourceHash">,
): CustomToolResource {
  return { kind: "custom-tool", name, ...options };
}

/** Include resources when a TypeScript condition is true. For config fragments, use platform/machine helpers. */
export function when(condition: boolean, resources: ResourceInput): ResourceInput {
  return condition ? resources : [];
}

/**
 * Define an entry point or imported fragment. Arrays and factories compose; false, null and undefined are ignored.
 * Later declarations with the same resource ID win.
 * @example export default defineConfig({ resources: [tools.mise({ node: "lts" })] })
 */
export function defineConfig(config: WorkstationConfig): WorkstationConfig {
  return config;
}

/** Define a configuration factory with typed access to machine, platform, home, and configDir. */
export function configure(factory: ConfigFactory): ConfigFactory {
  return factory;
}

/**
 * Include a configuration fragment only on macOS.
 * @example defineConfig([common, darwin(macos)])
 */
export function darwin(config: ConfigInput): ConfigFactory {
  return conditional((context) => context.platform === "darwin", config);
}

/** Include a configuration fragment only on Linux. */
export function linux(config: ConfigInput): ConfigFactory {
  return conditional((context) => context.platform === "linux", config);
}

/**
 * Include a fragment for one or more exact machine names. Defaults to the short hostname; `--machine` overrides it.
 * @example machine(["studio", "macbook"], sharedMacConfig)
 */
export function machine(names: string | readonly string[], config: ConfigInput): ConfigFactory {
  const accepted = typeof names === "string" ? [names] : names;
  return conditional((context) => accepted.includes(context.machine), config);
}

/** Wrap a config fragment in a context predicate without evaluating excluded fragments. */
function conditional(predicate: (context: Context) => boolean, config: ConfigInput): ConfigFactory {
  return (context) => (predicate(context) ? resolveInput(config, context) : undefined);
}

/** Evaluate a configuration factory or return a static fragment unchanged. */
function resolveInput(config: ConfigInput, context: Context): ConfigInput {
  return typeof config === "function" ? config(context) : config;
}
