/* global console, process */
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seaRoot = resolve(packageRoot, "dist", "sea");
const binaryRoot = resolve(packageRoot, "dist", "bin");
const blobPath = resolve(seaRoot, "workstation.blob");
const outputPath = resolve(binaryRoot, `workstation-${process.platform}-${process.arch}`);
const configPath = resolve(seaRoot, "sea-config.json");

await mkdir(binaryRoot, { recursive: true });
await writeFile(
  configPath,
  `${JSON.stringify(
    {
      main: resolve(seaRoot, "workstation.cjs"),
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    },
    null,
    2,
  )}\n`,
);

execFileSync(process.execPath, ["--experimental-sea-config", configPath], { stdio: "inherit" });
await copyFile(process.execPath, outputPath);
await chmod(outputPath, 0o755);

if (process.platform === "darwin") {
  execFileSync("codesign", ["--remove-signature", outputPath], { stdio: "ignore" });
}

const postject = resolve(packageRoot, "node_modules", ".bin", "postject");
const postjectArgs = [
  outputPath,
  "NODE_SEA_BLOB",
  blobPath,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
];
if (process.platform === "darwin") {
  postjectArgs.push("--macho-segment-name", "NODE_SEA");
}
execFileSync(postject, postjectArgs, { stdio: "inherit" });

if (process.platform === "darwin") {
  execFileSync("codesign", ["--sign", "-", outputPath], { stdio: "inherit" });
}

console.log(outputPath);
