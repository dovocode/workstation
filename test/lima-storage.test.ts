import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { renderStorage, storageLayout, validateStorage, type LimaStorageOptions } from "../src/lima/storage.js";
import { lima, resolveConfig } from "../src/index.js";

const choices: LimaStorageOptions[] = [
  { filesystem: "xfs", mountPoint: "/code" },
  { filesystem: "ext4", mountPoint: "/data" },
  { filesystem: "xfs", mountPoint: "/code", vdo: { compression: "lz4", deduplication: true, logicalSizeGiB: 1000 } },
  { filesystem: "ext4", mountPoint: "/data", vdo: { compression: false, deduplication: false } },
  ...(["zstd", "lzo", "zlib", false] as const).map(compression => ({ filesystem: "btrfs" as const, mountPoint: "/srv/data", compression })),
];
for (const storage of choices) {
  it(`renders valid guest Bash for ${JSON.stringify(storage)}`, () => {
    const script = renderStorage(storage, 500);
    const result = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    // Argument validation executes before any guest tools or privileges are used.
    const invalid = spawnSync("bash", ["-s", "--", "setup", "/dev/vda", "536870912000"], { input: script, encoding: "utf8", env: { PATH: "/usr/bin:/bin" } });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("Unexpected data disk declaration");
    expect(script).toContain(`filesystem='${storage.filesystem}'`);
    expect(script).toContain("Refusing filesystem conversion");
    expect(script).not.toMatch(/mkfs\.[a-z0-9]+ -[fF]/);
  });
}

it("rejects unsupported combinations and mount paths before creating resources", () => {
  // @ts-expect-error Btrfs does not support native LZ4
  expect(() => validateStorage({ filesystem: "btrfs", mountPoint: "/code", compression: "lz4" }, 500)).toThrow("Btrfs compression");
  // @ts-expect-error VDO cannot be stacked with Btrfs through this API
  expect(() => validateStorage({ filesystem: "btrfs", mountPoint: "/code", vdo: {} }, 500)).toThrow("not VDO");
  // @ts-expect-error XFS has no native compression setting
  expect(() => validateStorage({ filesystem: "xfs", mountPoint: "/code", compression: "zstd" }, 500)).toThrow("through VDO");
  expect(() => validateStorage({ filesystem: "xfs", mountPoint: "/", vdo: {} }, 500)).toThrow("mountPoint");
  expect(() => validateStorage({ filesystem: "xfs", mountPoint: "/code;touch injected" }, 500)).toThrow("mountPoint");
  expect(() => validateStorage({ filesystem: "ext4", mountPoint: "/code", vdo: {} }, 1)).toThrow("8 GiB");
  expect(() => validateStorage({ filesystem: "ext4", mountPoint: "/code", vdo: { logicalSizeGiB: -1 } }, 500)).toThrow("logical size");
});

it("distinguishes layout migration from mutable compression and deduplication settings", () => {
  const initial: LimaStorageOptions = { filesystem: "xfs", mountPoint: "/code", vdo: {} };
  expect(storageLayout(initial, 500)).toEqual(storageLayout({ ...initial, vdo: { compression: false, deduplication: false } }, 500));
  expect(storageLayout(initial, 500)).not.toEqual(storageLayout({ filesystem: "ext4", mountPoint: "/code", vdo: {} }, 500));
  expect(storageLayout(initial, 500)).not.toEqual(storageLayout({ filesystem: "xfs", mountPoint: "/code" }, 500));
  expect(storageLayout(initial, 500)).not.toEqual(storageLayout({ ...initial, vdo: { logicalSizeGiB: 1000 } }, 500));
});

it("generates built-in storage without a custom script and composes optional guest setup", async () => {
  const context = { platform: "darwin" as const, home: "/tmp/home", configDir: "/project", hostname: "studio", machine: "studio" };
  const options = { image: { url: "https://example.com/ubuntu.img", sha256: "a".repeat(64), architecture: "aarch64" as const }, dataDisk: { path: "/Volumes/Code/disk.raw", sizeGiB: 500, storage: { filesystem: "xfs" as const, mountPoint: "/code", vdo: {} } } };
  const config = await resolveConfig(lima.vm("code", options), context);
  const task = config.tasks?.["code:up"];
  if (!task?.args?.[2]) throw new Error("Missing task payload");
  const payload = JSON.parse(task.args[2]);
  expect(payload.storage).toEqual({ filesystem: "xfs", mountPoint: "/code", vdo: { logicalSizeGiB: 500 } });
  expect(payload.guest).toContain("vdo_compression='enabled'");
  const composed = await resolveConfig(lima.vm("code", { ...options, guestScript: "echo custom" }), context);
  const composedArgs = composed.tasks?.["code:up"]?.args;
  if (!composedArgs?.[2]) throw new Error("Missing composed payload");
  const script = JSON.parse(composedArgs[2]).guest;
  expect(script).toContain("echo custom");
  expect(spawnSync("bash", ["-n"], { input: script }).status).toBe(0);
});
