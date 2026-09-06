import { describe, expect, it } from "vitest";
import type { Runner } from "../src/api/types.js";
import { ProcessRunner } from "../src/resources/runner.js";
import { requireSuccess } from "../src/resources/shared.js";
import { verifyNativeBatch } from "./package-batch-integration.js";

describe.skipIf(process.env.WORKSTATION_APP_INTEGRATION !== "1")("isolated APT batching", () => {
  it("installs and removes multiple pinned packages in one transaction", async () => {
    const host = new ProcessRunner();
    const id = (await requireSuccess(host, "docker", ["run", "--rm", "-d", "ubuntu:24.04", "sleep", "600"])).stdout.trim();
    const runner: Runner = { async run(command, args, options) {
      return host.run("docker", ["exec", "-e", "DEBIAN_FRONTEND=noninteractive", id, ...(command === "sudo" ? args : [command, ...args])], options);
    } };
    try {
      await requireSuccess(runner, "apt-get", ["update"]);
      await verifyNativeBatch(["jq", "tree"].map((name) => ({ kind: "package", manager: "apt", name })), runner);
    } finally {
      expect((await host.run("docker", ["rm", "--force", id])).exitCode).toBe(0);
    }
  }, 240_000);
});
