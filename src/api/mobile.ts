import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import type { ConfigFactory, Context, TaskDefinition } from "./types.js";
import { provision } from "./provision.js";
import { task } from "./tasks.js";
import { mobileManager } from "../mobile/manager.js";

/** Host tooling shared by managed mobile devices. */
export interface MobileHostOptions {
  /** Python 3 interpreter; defaults to python3 on PATH. */
  readonly python?: string;
  /** Maximum boot/shutdown wait in seconds; defaults to 180. */
  readonly timeoutSeconds?: number;
}

/** A persistent Android Virtual Device using the installed Android SDK command-line tools. */
export interface AndroidEmulatorOptions extends MobileHostOptions {
  /** SDK root; defaults to ~/Library/Android/sdk on macOS and ~/Android/Sdk on Linux. */
  readonly sdkRoot?: string;
  /** Installed cmdline-tools directory version; defaults to latest. */
  readonly toolsVersion?: string;
  /** Exact SDK package, e.g. system-images;android-35;google_apis;arm64-v8a. */
  readonly systemImage: string;
  /** avdmanager hardware profile ID, e.g. pixel_7. */
  readonly device: string;
  readonly cpus?: number;
  readonly memoryMiB?: number;
  /** Even console port between 5554 and 5682; choose a different port per running emulator. */
  readonly port?: number;
  /** Hide the emulator window; defaults to false. */
  readonly headless?: boolean;
  /** Explicitly accept SDK licenses during setup; defaults to false. */
  readonly acceptLicenses?: boolean;
}

/** An iOS Simulator device backed by an existing, initialized Xcode installation. */
export interface IosSimulatorOptions extends MobileHostOptions {
  /** Exact runtime identifier, e.g. com.apple.CoreSimulator.SimRuntime.iOS-18-0. */
  readonly runtime: string;
  /** Exact hardware identifier, e.g. com.apple.CoreSimulator.SimDeviceType.iPhone-16. */
  readonly deviceType: string;
  /** Download this OS version if the runtime is missing, e.g. 18.0; otherwise fail. */
  readonly downloadRuntimeVersion?: string;
  /** Xcode Contents/Developer path; otherwise honor the selected Xcode. */
  readonly developerDir?: string;
}

/** Resolve user paths without reading or modifying the host. */
function path(value: string, context: Context): string {
  if (!value || /[\0\r\n]/.test(value)) throw new Error("Invalid mobile tool path");
  return value.startsWith("~/") ? join(context.home, value.slice(2)) : isAbsolute(value) ? value : join(context.configDir, value);
}

/** Resolve backend-specific paths and defaults without starting a device. */
function deviceOptions(options: AndroidEmulatorOptions | IosSimulatorOptions, context: Context) {
  if ("systemImage" in options) {
    return {
      sdkRoot: path(options.sdkRoot ?? (context.platform === "darwin" ? "~/Library/Android/sdk" : "~/Android/Sdk"), context),
      toolsVersion: options.toolsVersion ?? "latest", cpus: options.cpus ?? 2,
      memoryMiB: options.memoryMiB ?? 2048, port: options.port ?? 5554,
    };
  }
  return options.developerDir ? { developerDir: path(options.developerDir, context) } : {};
}

/** Validate declarations and compose retained setup plus explicit device lifecycle tasks. */
function mobile(name: string, backend: "android" | "ios", options: AndroidEmulatorOptions | IosSimulatorOptions): ConfigFactory {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(name)) throw new Error("Invalid mobile device name");
  const timeout = options.timeoutSeconds ?? 180;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 3600) throw new Error("Invalid mobile boot timeout");
  const python = options.python ?? "python3";
  if (!python || python.startsWith("-") || /[\0\r\n]/.test(python)) throw new Error("Invalid Python executable");
  return context => {
    if (backend === "ios" && context.platform !== "darwin") throw new Error("iOS Simulator requires macOS and Xcode; condition this declaration on platform");
    const owner = createHash("sha256").update(`${context.configDir}\0${context.machine}\0${name}`).digest("hex");
    const base = join(context.home, ".local/state/workstation/mobile", backend, name);
    const payload = JSON.stringify({ ...options, backend, name, owner, base, timeout,
      runtimeName: `ws-${name}-${owner.slice(0, 12)}`,
      ...deviceOptions(options, context),
    });
    /** Commands defer all tool discovery and host mutations until execution. */
    const operation = (action: string) => task(python.includes("/") ? path(python, context) : python, ["-c", mobileManager, payload, action], { description: `${backend} ${name}: ${action}` });
    const tasks: Record<string, TaskDefinition> = {};
    for (const action of ["setup", "up", "stop", "status", "install", "exec", "destroy"]) tasks[`${name}:${action}`] = operation(action);
    return { resources: [provision(`${backend}-${name}`, { type: "check", check: operation("check"), repair: [operation("setup")] })], tasks };
  };
}

/** Android SDK package setup and persistent emulators on macOS/Linux. */
export const android = {
  /** Install required SDK packages and create an AVD; boot only through NAME:up. */
  emulator(name: string, options: AndroidEmulatorOptions): ConfigFactory {
    if (!/^system-images;android-[0-9]+;[a-z0-9_]+;(arm64-v8a|x86_64)$/.test(options.systemImage)) throw new Error("Invalid Android system-image package");
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(options.device)) throw new Error("Invalid Android device profile");
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(options.toolsVersion ?? "latest")) throw new Error("Invalid Android tools version");
    for (const [value, minimum, maximum] of [[options.cpus ?? 2, 1, 32], [options.memoryMiB ?? 2048, 512, 32768], [options.port ?? 5554, 5554, 5682]] as const) {
      if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error("Invalid Android CPU, memory or port");
    }
    if ((options.port ?? 5554) % 2) throw new Error("Android console port must be even");
    return mobile(name, "android", options);
  },
};

/** iOS Simulator setup and lifecycle on macOS. */
export const ios = {
  /** Create a retained simulator using an explicit runtime and hardware type; boot through NAME:up. */
  simulator(name: string, options: IosSimulatorOptions): ConfigFactory {
    if (!/^com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9]+(?:-[0-9]+)*$/.test(options.runtime)) throw new Error("Invalid iOS runtime identifier");
    if (!/^com\.apple\.CoreSimulator\.SimDeviceType\.[A-Za-z0-9-]+$/.test(options.deviceType)) throw new Error("Invalid iOS device type");
    if (options.downloadRuntimeVersion !== undefined && (!/^[0-9]+(?:\.[0-9]+)*$/.test(options.downloadRuntimeVersion) || options.runtime !== `com.apple.CoreSimulator.SimRuntime.iOS-${options.downloadRuntimeVersion.replaceAll(".", "-")}`)) throw new Error("iOS download version must match the runtime identifier");
    return mobile(name, "ios", options);
  },
};
