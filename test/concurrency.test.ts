import { expect, it } from "vitest";
import { mapConcurrent } from "../src/concurrency.js";

it("bounds simultaneous reads and preserves declaration order", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapConcurrent([3, 2, 1, 0, 4], async (value) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, value));
    active--;
    return value;
  }, 2);
  expect(peak).toBe(2);
  expect(result).toEqual([3, 2, 1, 0, 4]);
});

it("drains active reads before reporting failure and stops scheduling more", async () => {
  let drained = false;
  const visited: number[] = [];
  await expect(mapConcurrent([0, 1, 2, 3], async (value) => {
    visited.push(value);
    if (value === 0) throw new Error("failed");
    await new Promise((resolve) => setTimeout(resolve, 10));
    drained = true;
  }, 2)).rejects.toThrow("failed");
  expect(drained).toBe(true);
  expect(visited).toEqual([0, 1]);
});
