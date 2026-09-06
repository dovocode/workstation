import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectLinuxManager } from "../src/config/system-manager.js";

describe("Linux package manager detection", () => {
  it("prefers APT, then DNF, then YUM regardless of PATH directory order", async () => {
    const root = await mkdtemp(join(tmpdir(), "workstation-manager-"));
    const first = join(root, "first");
    const second = join(root, "second");
    await mkdir(first);
    await mkdir(second);
    const path = [first, second].join(delimiter);
    await writeFile(join(first, "pacman"), "", { mode: 0o755 });
    expect(await detectLinuxManager(path)).toBe("pacman");
    await writeFile(join(first, "yum"), "", { mode: 0o755 });
    expect(await detectLinuxManager(path)).toBe("yum");
    await writeFile(join(second, "dnf"), "", { mode: 0o755 });
    expect(await detectLinuxManager(path)).toBe("dnf");
    await writeFile(join(second, "apt-get"), "", { mode: 0o755 });
    expect(await detectLinuxManager(path)).toBe("apt");
    await chmod(join(second, "apt-get"), 0o644);
    expect(await detectLinuxManager(path)).toBe("dnf");
  });
  it("rejects unsupported hosts and directories named like commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "workstation-manager-"));
    await mkdir(join(root, "dnf"));
    await expect(detectLinuxManager(root)).rejects.toThrow("No supported Linux package manager");
    await expect(detectLinuxManager("")).rejects.toThrow("No supported Linux package manager");
  });
});
