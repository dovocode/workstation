/* global console, process */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const missing = [];
let checked = 0;

/** Check named source functions and methods; inline callbacks belong to their documented enclosing function. */
async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      await checkDirectory(path);
    } else if (path.endsWith(".ts")) {
      const source = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true);
      /** Visit declarations and record missing JSDoc with a source location. */
      function visit(node) {
        const namedArrow = (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) &&
          node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer));
        if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ||
            ts.isMethodSignature(node) || ts.isConstructorDeclaration(node) || namedArrow) {
          checked += 1;
          const owner = ts.isVariableDeclaration(node) ? node.parent.parent : node;
          if (!ts.getJSDocCommentsAndTags(owner).length) {
            const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            missing.push(`${path}:${line} ${node.name?.getText(source) ?? "constructor"}`);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
}

await checkDirectory(sourceRoot);
if (missing.length) {
  console.error(`Missing JSDoc:\n${missing.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`JSDoc present for all ${checked} named functions and methods.`);
}
