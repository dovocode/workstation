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
        if (isDocumentedDeclaration(node)) {
          checked += 1;
          const owner = ts.isVariableDeclaration(node) ? node.parent.parent : node;
          if (!ts.getJSDocCommentsAndTags(owner).length) {
            recordMissing(node, source, path);
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

/** Identify named declarations whose contracts require documentation. */
function isDocumentedDeclaration(node) {
  if ([ts.isFunctionDeclaration, ts.isMethodDeclaration, ts.isMethodSignature, ts.isConstructorDeclaration].some((check) => check(node))) return true;
  if (!ts.isVariableDeclaration(node) && !ts.isPropertyAssignment(node)) return false;
  return isFunctionInitializer(node.initializer);
}

/** Recognize function-valued properties and variables independently of their declaration owner. */
function isFunctionInitializer(value) {
  return value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value));
}

/** Record a precise source location for a missing declaration contract. */
function recordMissing(node, source, path) {
            const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            missing.push(`${path}:${line} ${node.name?.getText(source) ?? "constructor"}`);
}
