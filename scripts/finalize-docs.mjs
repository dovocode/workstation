/* global console */
import { glob, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "dist/docs");
const redirects = JSON.parse(await readFile(join(root, "website/legacy-routes.json"), "utf8"));

/** Preserve published TypeDoc bookmarks while the handbook moves to Docusaurus. */
async function redirect(from, to) {
  const target = `/workstation/${to}`;
  const path = join(output, from);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Workstation documentation</title><meta name="robots" content="noindex"><link rel="canonical" href="${target}"><meta http-equiv="refresh" content="0;url=${target}"><script>location.replace(${JSON.stringify(target)} + location.search + location.hash)</script></head><body><a href="${target}">Continue to the Workstation documentation</a></body></html>\n`);
}

for (const [from, to] of Object.entries(redirects)) await redirect(from, to);

// Node's glob walks generated API pages; preserve every published symbol bookmark.
for await (const path of glob("**/*.html", { cwd: join(output, "api"), exclude: ["index.html"] })) {
  await redirect(path, `api/${path}`);
}
const files = await readdir(output);
if (!files.some(file => /^search-index.*\.json$/.test(file))) throw new Error("Missing handbook search index");
const html = await readFile(join(output, "index.html"), "utf8");
if (!html.includes("Docusaurus") && !html.includes("docusaurus")) throw new Error("Missing Docusaurus homepage");
await readFile(join(output, ".nojekyll"));
console.log("Docusaurus handbook, API reference, search index, and legacy redirects are ready.");
