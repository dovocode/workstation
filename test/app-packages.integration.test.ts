import { chmod, cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Runner } from "../src/api/types.js";
import { ProcessRunner } from "../src/resources/runner.js";
import { requireSuccess } from "../src/resources/shared.js";
import { inspectResource, installResource, removeResource } from "../src/resources/dispatch.js";
import { resolvePackageVersion } from "../src/resources/package-version.js";
import { verifyNativeBatch } from "./package-batch-integration.js";

describe.skipIf(process.env.WORKSTATION_APP_INTEGRATION !== "1")("isolated pacman and Flatpak backends", () => {
  it("installs and removes a pinned pacman package", async () => {
    const host = new ProcessRunner();
    const architecture = (await requireSuccess(host, "docker", ["info", "--format", "{{.Architecture}}"])).stdout.trim();
    const emulated = architecture === "aarch64" || architecture === "arm64";
    const id = (await requireSuccess(host, "docker", ["run", "--rm", "--platform", "linux/amd64", "-d", "archlinux:base", "sleep", "600"])).stdout.trim();
    const runner: Runner = { async run(command, args, options) {
      const invocation = command === "sudo" ? [...args] : [command, ...args];
      // QEMU user-mode cannot install seccomp filters. Keep this compatibility flag test-only.
      if (emulated && invocation[0] === "pacman" && (invocation.includes("-S") || invocation.includes("-Syu"))) invocation.push("--disable-sandbox-syscalls");
      return host.run("docker", ["exec", "-e", "LC_ALL=C", id, ...invocation], options);
    } };
    try {
      // Prepare the disposable distro with a full upgrade, not a partial database refresh.
      await requireSuccess(runner, "pacman", ["-Syu", "--noconfirm"]);
      const declaration = { kind: "package" as const, manager: "pacman" as const, name: "jq" };
      const lockedVersion = await resolvePackageVersion(declaration, runner);
      if (!lockedVersion) throw new Error("Expected pacman pin");
      const resource = { ...declaration, lockedVersion };
      expect(await installResource(resource, runner)).toMatchObject({ matches: true, installedVersion: lockedVersion });
      expect(await installResource(resource, runner)).toMatchObject({ matches: true });
      await removeResource(resource, runner);
      expect(await inspectResource(resource, runner)).toMatchObject({ present: false });
      await verifyNativeBatch(["jq", "tree"].map((name) => ({ kind: "package", manager: "pacman", name })), runner);
    } finally {
      expect((await host.run("docker", ["rm", "--force", id])).exitCode).toBe(0);
    }
  }, 480_000);

  it("installs, updates to a pinned commit and removes a local Flatpak app in both scopes", async () => {
    const host = new ProcessRunner();
    const id = (await requireSuccess(host, "docker", ["run", "--rm", "-d", "fedora:latest", "sleep", "600"])).stdout.trim();
    const runner: Runner = { async run(command, args, options) {
      return host.run("docker", ["exec", "-e", "LC_ALL=C", id, ...(command === "sudo" ? args : [command, ...args])], options);
    } };
    try {
      await requireSuccess(runner, "dnf", ["install", "-y", "--setopt=install_weak_deps=False", "flatpak"]);
      const arch = (await requireSuccess(runner, "flatpak", ["--default-arch"])).stdout.trim();
      const root = await mkdtemp(join(tmpdir(), "workstation-flatpak-fixture-"));
      await mkdir(join(root, "runtime", "usr"), { recursive: true });
      await mkdir(join(root, "runtime", "files"), { recursive: true });
      await mkdir(join(root, "app", "files", "bin"), { recursive: true });
      await mkdir(join(root, "app", "export"), { recursive: true });
      await writeFile(join(root, "runtime", "metadata"), `[Runtime]\nname=org.workstation.TestRuntime\nruntime=org.workstation.TestRuntime/${arch}/stable\nsdk=org.workstation.TestRuntime/${arch}/stable\n`);
      await writeFile(join(root, "runtime", "usr", "fixture"), "test runtime\n");
      await writeFile(join(root, "app", "metadata"), `[Application]\nname=org.workstation.TestApp\nruntime=org.workstation.TestRuntime/${arch}/stable\nsdk=org.workstation.TestRuntime/${arch}/stable\ncommand=test-app\n`);
      await writeFile(join(root, "app", "files", "bin", "test-app"), "#!/bin/sh\nexit 0\n");
      await chmod(join(root, "app", "files", "bin", "test-app"), 0o755);
      await cp(join(root, "app"), join(root, "app2"), { recursive: true });
      await writeFile(join(root, "app2", "metadata"), `[Application]\nname=org.workstation.SecondApp\nruntime=org.workstation.TestRuntime/${arch}/stable\nsdk=org.workstation.TestRuntime/${arch}/stable\ncommand=test-app\n`);
      await requireSuccess(host, "docker", ["cp", root, `${id}:/fixture`]);
      await requireSuccess(runner, "flatpak", ["build-export", "--runtime", `--arch=${arch}`, "/repo", "/fixture/runtime", "stable"]);
      await requireSuccess(runner, "flatpak", ["build-export", `--arch=${arch}`, "/repo", "/fixture/app", "stable"]);
      await requireSuccess(runner, "flatpak", ["build-export", `--arch=${arch}`, "/repo", "/fixture/app2", "stable"]);
      for (const scope of ["user", "system"] as const) {
        await requireSuccess(runner, "flatpak", ["remote-add", `--${scope}`, "--no-gpg-verify", "test", "/repo"]);
        const declaration = { kind: "package" as const, manager: "flatpak" as const, name: "org.workstation.TestApp", flatpak: { scope, remote: "test" } };
        const lockedVersion = await resolvePackageVersion(declaration, runner);
        if (!lockedVersion) throw new Error("Expected Flatpak pin");
        const resource = { ...declaration, lockedVersion };
        expect(await installResource(resource, runner)).toMatchObject({ matches: true, installedVersion: lockedVersion });
        expect(await installResource(resource, runner)).toMatchObject({ matches: true });
        await writeFile(join(root, "app", "files", "change"), scope);
        await requireSuccess(host, "docker", ["cp", join(root, "app", "files", "change"), `${id}:/fixture/app/files/change`]);
        await requireSuccess(runner, "flatpak", ["build-export", `--arch=${arch}`, "/repo", "/fixture/app", "stable"]);
        const newVersion = await resolvePackageVersion(declaration, runner);
        if (!newVersion || newVersion === lockedVersion) throw new Error("Expected changed Flatpak commit");
        expect(await installResource({ ...resource, lockedVersion: newVersion }, runner)).toMatchObject({ matches: true, installedVersion: newVersion });
        expect(await installResource(resource, runner)).toMatchObject({ matches: true, installedVersion: lockedVersion });
        await removeResource(resource, runner);
        expect(await inspectResource(resource, runner)).toMatchObject({ present: false });
        await verifyNativeBatch(["org.workstation.TestApp", "org.workstation.SecondApp"].map((name) => ({ ...declaration, name })), runner);
      }
    } finally {
      expect((await host.run("docker", ["rm", "--force", id])).exitCode).toBe(0);
    }
  }, 480_000);
});
