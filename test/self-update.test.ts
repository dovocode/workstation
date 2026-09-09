import { describe, expect, it } from "vitest";
import { nativeAssetName } from "../src/self-update.js";

describe("self update", () => {
  it("selects each published native asset", () => {
    expect(nativeAssetName("darwin", "arm64")).toBe("workstation-darwin-arm64");
    expect(nativeAssetName("darwin", "x64")).toBe("workstation-darwin-x64");
    expect(nativeAssetName("linux", "arm64")).toBe("workstation-linux-arm64");
    expect(nativeAssetName("linux", "x64")).toBe("workstation-linux-x64");
  });

  it("rejects platforms and architectures without release artifacts", () => {
    expect(() => nativeAssetName("win32", "x64")).toThrow("unsupported on win32");
    expect(() => nativeAssetName("linux", "ia32")).toThrow("unsupported on ia32");
  });
});
