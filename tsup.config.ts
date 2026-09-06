import { defineConfig } from "tsup";

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
    clean: false,
    sourcemap: false,
    noExternal: [/.*/],
  },
]);
