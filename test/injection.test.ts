import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { files } from "../src/api/config.js";
import { validateResource } from "../src/config/validation.js";
import { backupResource, inspectGeneratedFile, installGeneratedFile, removeGeneratedFile } from "../src/resources/generated-file.js";

it("restores only the original section and retains outside edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "workstation-inject-"));
  const target = join(root, "config");
  await writeFile(target, "before START old END after");
  const resource = files.inject(target, " new ", { start: "START", end: "END" });
  expect(() => validateResource(resource)).not.toThrow();
  const original = await backupResource(resource);
  await installGeneratedFile(resource);
  expect(await readFile(target, "utf8")).toBe("before START new END after");
  expect((await inspectGeneratedFile(resource)).matches).toBe(true);
  await writeFile(target, "edited START new END after");
  await removeGeneratedFile(resource, original);
  expect(await readFile(target, "utf8")).toBe("edited START old END after");
});

it("rejects missing or ambiguous boundaries without writing", async () => {
  const root = await mkdtemp(join(tmpdir(), "workstation-inject-"));
  const target = join(root, "config");
  const resource = files.inject(target, "new", { start: "START", end: "END" });
  for (const text of ["unmarked", "START START END", "END START"]) {
    await writeFile(target, text);
    await expect(installGeneratedFile(resource)).rejects.toThrow("markers");
    expect(await readFile(target, "utf8")).toBe(text);
  }
});
