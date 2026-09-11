/* global console */
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "dist/docs");
const repository = "https://github.com/dovocode/workstation.git";
const marker = ".workstation-docs";
const signature = "Generated Workstation documentation. Publish with pnpm docs:publish.\n";

/** Run Git without shell interpolation, surfacing failures to the caller. */
function git(args, cwd = root) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

// Require the expected static build before preparing any remote changes.
await Promise.all(["index.html", ".nojekyll", "api/index.html", "tutorial/index.html"].map(file => readFile(join(output, file))));
const branch = git(["ls-remote", repository, "refs/heads/gh-pages"]);
const directory = await mkdtemp(join(tmpdir(), "workstation-pages-"));
try {
  git(["init", "--initial-branch=gh-pages", directory]);
  git(["remote", "add", "origin", repository], directory);
  if (branch) {
    git(["fetch", "--depth=1", "origin", "gh-pages"], directory);
    git(["checkout", "-B", "gh-pages", "FETCH_HEAD"], directory);
    // Never replace a branch containing a separately maintained site.
    if (await readFile(join(directory, marker), "utf8") !== signature) {
      throw new Error("gh-pages is not a Workstation-generated docs branch; inspect it before publishing.");
    }
    for (const entry of await readdir(directory)) {
      if (entry !== ".git") await rm(join(directory, entry), { recursive: true, force: true });
    }
  }
  await cp(output, directory, { recursive: true });
  await writeFile(join(directory, marker), signature);
  git(["add", "--all"], directory);
  if (!git(["diff", "--cached", "--name-only"], directory)) {
    console.log("Published documentation is already current.");
  } else {
    git(["-c", `user.name=${git(["config", "user.name"])}`, "-c", `user.email=${git(["config", "user.email"])}`,
      "commit", "-m", `docs: publish handbook from ${git(["rev-parse", "--short", "HEAD"])}`], directory);
    // A concurrent publication rejects this normal push; no history is rewritten.
    git(["push", "origin", "HEAD:refs/heads/gh-pages"], directory);
  }
  console.log("Published branch: gh-pages. Site: https://dovocode.github.io/workstation/");
  console.log("GitHub Pages must use gh-pages / (root); deployment may take a few minutes.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
