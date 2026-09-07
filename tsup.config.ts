import { defineConfig } from "tsup";
import { readFile } from "node:fs/promises";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
  },
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: true,
    noExternal: [/.*/],
    banner: {
      js: '#!/usr/bin/env node\nimport { createRequire as workstationCreateRequire } from "node:module";\nconst require = workstationCreateRequire(import.meta.url);',
    },
  },
  {
    entry: { workstation: "src/cli.ts" },
    format: ["cjs"],
    outDir: "dist/sea",
    platform: "node",
    target: "node26",
    esbuildPlugins: [{
      name: "sea-filesystem-imports",
      setup(build) {
        // SEA's injected script has a builtin-only import callback. Give Jiti
        // Node's filesystem ESM loader, retaining asynchronous modules and TLA.
        build.onLoad({ filter: /[/\\]jiti-static\.mjs$/ }, async ({ path }) => {
          const source = await readFile(path, "utf8");
          const original = "const nativeImport = (id) => import(id);";
          if (!source.includes(original)) throw new Error("Jiti import adapter changed; review SEA loader integration");
          return { contents: source.replace(original,
            'const nativeImport = require("node:vm").compileFunction("return import(id)", ["id"], { filename: process.execPath, importModuleDynamically: require("node:vm").constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });'), loader: "js" };
        });
      },
    }],
    clean: false,
    sourcemap: false,
    noExternal: [/.*/],
  },
]);
