# API and documentation development

All supported consumer imports come from `@dovocode/workstation`. The generated API
reference covers builders, resource types, configuration loading, locks,
manifest serialization, and the process runner.

## Read-only config loading

```ts
import { findConfig, loadConfig } from "@dovocode/workstation";

const path = await findConfig();
const config = await loadConfig(path, "studio");
console.log(config.context.machine, config.resources.length);
```

Loading evaluates your TypeScript and hashes local custom-tool sources; it does
not install resources. Arbitrary side effects in your own config are still
ordinary TypeScript side effects. `lockConfig` queries package managers and
writes the lock, while `writeManifest` persists resolved declarations.

`resourceId` supplies the stable identity and `fingerprint` hashes the full
resolved declaration. `ProcessRunner` executes commands without an implicit
shell and returns exit status/output. Internal reconciliation modules are not
exported as a supported package API.

## Generate the docs

```sh
corepack pnpm run docs
```

Open `dist/docs/index.html`. TypeDoc builds the public API
from `src/index.ts` and includes these Markdown guides. Generated output is
ignored by Git and a package build may clean `dist`; regenerate docs afterward.
No hosting or publishing is performed by this command.

Edit API comments at their declarations and guides under `docs/`.
Named functions and methods in the implementation also carry JSDoc describing
their responsibility and relevant effects. Inline iteration callbacks are
covered by their enclosing function rather than becoming separate API pages.

Run `corepack pnpm check`, `corepack pnpm test`, and `corepack pnpm run docs`
before submitting documentation or API changes. Source lives under `src/api`, `src/config`, `src/resources`, `src/rendering`,
`src/reconciliation`, and `src/persistence`.
