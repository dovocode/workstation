import { describe, expect, it } from "vitest";
import { ProcessRunner } from "../src/resources/runner.js";
import type { Runner } from "../src/api/types.js";
import { resolvePackageVersion } from "../src/resources/package-version.js";
import { inspectResource, installResource, removeResource } from "../src/resources/dispatch.js";
import { verifyNativeBatch } from "./package-batch-integration.js";

describe.skipIf(process.env.WORKSTATION_RPM_INTEGRATION !== "1")("real RPM backends in disposable containers", () => {
  it.concurrent.each([
    { image: "fedora:latest", manager: "dnf" },
    { image: "amazonlinux:2023", manager: "dnf" },
    { image: "amazonlinux:2", manager: "yum" },
  ] as const)("locks, installs, verifies and removes jq with $manager on $image", async ({ image, manager }) => {
    const host = new ProcessRunner();
    const started = await host.run("docker", ["run", "--rm", "-d", image, "sleep", "300"]);
    if (started.exitCode !== 0) throw new Error(started.stderr);
    const id = started.stdout.trim();
    const runner: Runner = {
      // Containers run as root; strip only Workstation's sudo wrapper at this boundary.
      async run(command, args, options) {
        const result = await host.run("docker", ["exec",
          ...Object.entries(options?.environment ?? {}).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
          id, ...(command === "sudo" ? args : [command, ...args])]);
        return result;
      },
    };
    try {
      const declaration = { kind: "package" as const, manager, name: "jq" };
      const lockedVersion = await resolvePackageVersion(declaration, runner);
      if (!lockedVersion) throw new Error("Expected a concrete RPM pin");
      const resource = { ...declaration, lockedVersion };
      expect(await inspectResource(resource, runner)).toMatchObject({ present: false });
      await verifyNativeBatch(["jq", "tree"].map((name) => ({ kind: "package", manager, name })), runner);
      expect(await installResource(resource, runner)).toMatchObject({ matches: true, installedVersion: lockedVersion });
      expect(await installResource(resource, runner)).toMatchObject({ matches: true });
      // Exercise real downgrades/upgrades when the repositories retain an older build.
      const listed = await runner.run(manager, ["--quiet", "--color=never", "list", "--showduplicates", "jq"], { environment: { LC_ALL: "C" } });
      expect(listed.exitCode, listed.stderr).toBe(0);
      const arch = lockedVersion.slice(lockedVersion.lastIndexOf(".") + 1);
      const older = listed.stdout.split("\n").flatMap((line) => {
        const [name, version] = line.trim().split(/\s+/);
        if (name !== `jq.${arch}` || !version) return [];
        const pin = `${version.includes(":") ? version : `0:${version}`}.${arch}`;
        return pin === lockedVersion ? [] : [pin];
      })[0];
      if (older) {
        expect(await installResource({ ...resource, lockedVersion: older }, runner)).toMatchObject({ matches: true, installedVersion: older });
        expect(await installResource(resource, runner)).toMatchObject({ matches: true, installedVersion: lockedVersion });
      }
      await removeResource(resource, runner);
      expect(await inspectResource(resource, runner)).toMatchObject({ present: false });
    } finally {
      const removed = await host.run("docker", ["rm", "--force", id]);
      expect(removed.exitCode, `Could not remove test container ${id}: ${removed.stderr}`).toBe(0);
    }
  }, 240_000);
});
