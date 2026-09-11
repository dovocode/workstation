import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { bash, renderShell, shell } from "../src/api/shell.js";
import { installGeneratedFile } from "../src/resources/generated-file.js";

it.each(["sh", "bash", "zsh"] as const)("deduplicates paths with literal metacharacters when repeatedly sourced by %s", target => {
  const content = renderShell([shell.prependPath('/tmp/a b$`literal`', "/bin")], target);
  const result = execFileSync(target, ["-f", "-c", `${content}\n${content}\nprintf '%s' "$PATH"`], { env: { PATH: "/usr/bin:/bin:/usr/bin" }, encoding: "utf8" });
  expect(result).toBe('/tmp/a b$`literal`:/bin:/usr/bin:/usr/bin');
});
it("renders profile sources and conditions using POSIX syntax", () => {
  const resource = bash.profile([shell.when(shell.condition.file("/dev/null"), [shell.source("/dev/null")])]);
  expect(resource.format).toBe("sh");
  execFileSync("sh", ["-c", String(resource.value)]);
  expect(String(resource.value)).not.toContain("[[");
});
it("preserves the last valid startup file when candidate syntax is invalid", async () => {
  const root = await mkdtemp(join(tmpdir(), "workstation-shell-"));
  const target = join(root, ".profile");
  await writeFile(target, "export SAFE=yes\n");
  await expect(installGeneratedFile({ ...bash.profile([shell.raw("if then")]), target })).rejects.toThrow("Invalid sh file");
  expect(await readFile(target, "utf8")).toBe("export SAFE=yes\n");
});
it("groups nested boolean conditions correctly", () => {
  const condition = shell.condition.and(shell.condition.or(shell.condition.nonEmpty("yes"), shell.condition.nonEmpty("")), shell.condition.nonEmpty(""));
  expect(execFileSync("sh", ["-c", renderShell([shell.when(condition, [shell.raw("printf wrong")])], "sh")], { encoding: "utf8" })).toBe("");
});
