import { expect, it, vi } from "vitest";
import type { ResolvedResource, Runner } from "../src/api/types.js";
import { refreshPackageMetadata } from "../src/resources/package-metadata.js";

const resources: readonly ResolvedResource[] = [
  { kind: "package", manager: "apt", name: "jq" },
  { kind: "package", manager: "apt", name: "git" },
  { kind: "package", manager: "brew", name: "jq" },
  { kind: "package", manager: "brew-cask", name: "ghostty" },
  { kind: "package", manager: "mise", name: "node" },
];

it.each([
  { selection: true as const, commands: ["sudo", "brew"] },
  { selection: ["package:apt:jq"], commands: ["sudo"] },
  { selection: ["package:brew-cask:ghostty"], commands: ["brew"] },
  { selection: ["package:mise:node"], commands: [] },
  { selection: [], commands: [] },
])("refreshes only selected backends once: $selection", async ({ selection, commands }) => {
  const run = vi.fn<Runner["run"]>().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  await refreshPackageMetadata(resources, selection, { run });
  expect(run.mock.calls.map(([command]) => command)).toEqual(commands);
  if (commands.includes("sudo")) expect(run).toHaveBeenCalledWith("sudo", ["apt-get", "update", "-o", "APT::Update::Error-Mode=any"], { streamOutput: true });
  if (commands.includes("brew")) expect(run).toHaveBeenCalledWith("brew", ["update"], { streamOutput: true });
});

it("propagates refresh failure and stops later backend refreshes", async () => {
  const run = vi.fn<Runner["run"]>().mockResolvedValue({ exitCode: 100, stdout: "", stderr: "repository unavailable" });
  await expect(refreshPackageMetadata(resources, true, { run })).rejects.toThrow("repository unavailable");
  expect(run).toHaveBeenCalledOnce();
});
