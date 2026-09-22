---
title: "Android emulators and iOS simulators"
sidebar_label: "Mobile devices"
---

# Android emulators and iOS simulators

`android.emulator(...)` manages Android SDK packages and a persistent Android Virtual
Device on macOS or Linux. `ios.simulator(...)` manages a named iOS Simulator using
an existing Xcode installation on macOS. These devices run directly on the host,
independently of Firecracker and Microsandbox.

`build` prepares devices without booting them. Both helpers expose the same tasks:
`NAME:setup`, `:up`, `:stop`, `:status`, `:install`, `:exec`, and `:destroy`.

## Declare devices

This example targets Apple Silicon. On x86 Linux, select an `x86_64` Android system
image. Choose an installed Android hardware profile and an iOS runtime/device type
supported by your Xcode. The identifiers below are examples, not automatic latest
version selectors.

```ts
import { android, darwin, defineConfig, ios } from "@dovocode/workstation";

export default defineConfig([
  android.emulator("android-dev", {
    sdkRoot: "~/Library/Android/sdk",
    toolsVersion: "latest", // installed cmdline-tools directory, e.g. "23.0"
    systemImage: "system-images;android-35;google_apis;arm64-v8a",
    device: "pixel_7",
    cpus: 2,
    memoryMiB: 2048,
    port: 5554, // another concurrent emulator must use a different even port
    headless: false,
  }),
  darwin(ios.simulator("ios-dev", {
    runtime: "com.apple.CoreSimulator.SimRuntime.iOS-18-0",
    deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-16",
    // Download this runtime through Xcode if absent:
    downloadRuntimeVersion: "18.0",
    // Optional: developerDir: "/Applications/Xcode.app/Contents/Developer",
  })),
]);
```

Both accept an optional `python` executable path and `timeoutSeconds` (default 180)
for boot/shutdown. Relative tool paths resolve against the configuration directory;
`~/` uses the configuration context's home. Configuration evaluation does not run
host tools. The fragments also work through `createWorkstation` in embedded clients.

## Android setup

Install Python 3, Java, and the Android SDK command-line tools first, using Android
Studio or your existing Workstation package declarations. The adapter expects
`sdkRoot/cmdline-tools/toolsVersion/bin/{sdkmanager,avdmanager}`. By default,
`sdkRoot` is `~/Library/Android/sdk` on macOS and `~/Android/Sdk` on Linux, and
`toolsVersion` is `latest`. If your installation uses a numbered tools directory,
set that exact version.

During setup, Workstation installs missing `platform-tools`, `emulator`, and the
specified `system-images;...` package, then creates the AVD. It does not update
existing SDK packages or remove shared packages. API/package IDs select images,
but SDK revisions are not checksum-locked by Workstation.

Accept the relevant SDK licenses before building, or explicitly set
`acceptLicenses: true` to accept SDK licenses during package installation. Missing
licenses and failed downloads fail setup; no completed AVD is claimed on a failed
SDK installation. Find available profiles using `avdmanager list device` and image
packages using `sdkmanager --list`.

This integration uses the documented SDK command-line tools. Google now marks
these interfaces deprecated in favor of its newer Android CLI; its documented
profile-based creation interface does not expose the same explicit image selection.
See [SDK package management](https://developer.android.com/tools/sdkmanager),
[AVD management](https://developer.android.com/tools/avdmanager), and
[Android CLI](https://developer.android.com/tools/agents/android-cli).

Hardware acceleration must already work on the host. Use ARM64 images on Apple
Silicon and x86_64 images on x86 Linux; Linux requires accessible KVM. Running the
emulator inside a Linux microVM may require nested virtualization, which this
integration does not configure.

## iOS setup

Install and initialize full Xcode, including its license and first-launch components.
Command Line Tools alone do not include iOS Simulator. The adapter uses the selected
Xcode, or `developerDir` via `DEVELOPER_DIR`, without changing global `xcode-select`.
It does not install Xcode or automatically accept its license.

Find valid identifiers using:

```sh
xcrun simctl list runtimes
xcrun simctl list devicetypes
```

If `downloadRuntimeVersion` is provided, a missing runtime is downloaded using
`xcodebuild -downloadPlatform iOS -buildVersion VERSION`. The version must match the
runtime identifier and must be available for the selected Xcode. Otherwise setup
requires the runtime to be installed already. Runtimes are shared and retained when
a device is destroyed. See Apple's
[additional Xcode components](https://developer.apple.com/documentation/xcode/downloading-and-installing-additional-xcode-components).

## Lifecycle and app installation

```sh
workstation plan
workstation build
workstation android-dev:up
workstation android-dev:status
workstation android-dev:install -- ./app-debug.apk
workstation android-dev:exec -- getprop ro.build.version.release
workstation android-dev:stop

workstation ios-dev:up
workstation ios-dev:install -- ./build/MyApp.app
workstation ios-dev:exec -- launchctl list
workstation ios-dev:stop
```

Android opens a window unless `headless: true`; iOS boot uses `simctl` and does not
open the Simulator application. Open Simulator separately to view the booted device.
iOS apps must be built for the simulator; device IPAs cannot be installed this way.
App paths are relative to the task's working directory. `exec` runs an Android shell
command or an iOS `simctl spawn` executable; arguments and exit codes are preserved.
Neither helper attempts to install the Linux Workstation executable inside a phone.

`:up` runs setup as needed and waits for boot readiness. `:install` and `:exec`
require the managed device to be running. `:status` prints backend state and exits
nonzero for a stopped, absent, or mismatched device. The reconciliation check only
requires a prepared device, so a normal build does not restart one you stopped.
Android status queries may start the SDK's ADB server; they never boot an emulator.

Stopping preserves app data. CPU/memory changes require stopping Android before
setup can apply them. Changing Android SDK root, image, hardware profile, or port,
or changing an iOS runtime/hardware type, requires explicit destruction using the
original settings before recreation. Use a separate declaration for an additional
device. A changed iOS declaration can still stop/destroy its recorded old device.

```sh
# Deletes this device and its app data, leaving SDK packages/runtimes installed:
workstation android-dev:destroy
workstation ios-dev:destroy
```

Removing declarations retains the devices. Snapshot rollback does not restore mobile
app data. A subsequent build recreates a destroyed device if still declared.

## Identity and storage

Each declaration reserves a runtime name `ws-NAME-OWNERHASH`. iOS stores its concrete
UDID and always targets it; Android verifies the selected console port's AVD name.
An occupied port belonging to another AVD fails without stopping that device.

Ownership records, per-device locks, and Android AVDs live under
`~/.local/state/workstation/mobile/BACKEND/NAME`. Android uses a private
`ANDROID_AVD_HOME`, so these AVDs do not appear in Android Studio's default AVD list;
running emulators remain visible to ADB. Android boot output is retained in
`emulator.log` there. A boot timeout leaves the emulator available for inspection;
use its stop task before retrying. iOS device data stays in CoreSimulator's normal
storage and is visible to Xcode. Externally redirected AVD paths and conflicting
ownership records block operations instead of adopting or deleting foreign data.

Tests execute the real adapters against fake Android/Xcode tools, covering package
setup, boot readiness, identity checks, retained data, app installation, literal
arguments, and failures. Real app installation and interactive boot are not covered
by these tests.
