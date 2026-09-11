---
title: "Embed Workstation in TypeScript"
sidebar_label: "Embed in TypeScript"
---

# Embed Workstation in TypeScript

Import the public API from `@dovocode/workstation`; internal source modules are
not a supported integration surface. The JavaScript package requires its declared
Node.js version even when the standalone CLI needs no external Node installation.

## Use a configuration file

```ts
import { createWorkstation } from "@dovocode/workstation";
import { fileURLToPath } from "node:url";

const client = createWorkstation({
  configPath: fileURLToPath(new URL("./workstation.config.ts", import.meta.url)),
  onAction: action => console.log(action.type, action.id, action.reason),
  onProgress: message => console.log(message),
});

const actions = await client.plan();
console.log(actions);
// Apply when your application's workflow is ready:
await client.build({ frozen: true, noRemove: true });
```

Planning requires existing package managers and does not persist newly resolved
pins. A frozen build needs an existing matching lock; create it with `updateLock()`
or an initial non-frozen build before using this combination. Methods evaluate
fresh definitions and throw errors instead of exiting your host process.

## Supply an inline definition

```ts
import { createWorkstation, files } from "@dovocode/workstation";

const client = createWorkstation({
  configPath: "/absolute/path/setup/workstation.config.ts",
  config: {
    resources: [files.json("~/.config/example/settings.json", { theme: "dark" })],
  },
});

const actions = await client.plan();
console.log(actions);
```

With `config`, the entry file need not exist. `configPath` still determines the
lock location and default state identity. Targets retain normal home-relative
semantics. Inline definitions can use the same factories, machines, tasks,
aliases, and resource builders as file-based configs.

## Client methods and effects

| Method | Result/use | Workstation persistence or mutation |
| --- | --- | --- |
| `configuration()` | Resolved config, paths, tasks and resource IDs | None; evaluates configuration/source inputs |
| `plan({ frozen? })` | Proposed `Action[]` | None; queries and checks may run |
| `status()` | Resource status entries | None; uses recorded pins |
| `doctor()` | Diagnostic messages | None; checks command availability |
| `history()` | Snapshot identifiers | None |
| `rollback(id)` | Restoration preview | None |
| `rollback(id, { apply: true })` | Apply supported restoration | Resource/state changes and a new snapshot |
| `updateLock(ids?)` | Lock result including `config`, `path`, `changed` | Writes lock; no prerequisite bootstrap or resource apply |
| `build({ frozen?, noRemove? })` | Applied actions | Bootstrap, locks, manifest, state, resources, hooks |
| `upgrade(ids?)` | Refreshed build actions | Refresh pins and reconcile full configuration |
| `task(name, args?)` | `{ exitCode, stdout, stderr }` | Runs selected command; no reconciliation |

Omit `ids` to refresh all packages. `upgrade` currently accepts IDs only; it does
not expose `build`'s `noRemove` option or forward the client's action/progress
callbacks. For a guarded embedded update, use `updateLock(ids)` followed by
`build({ frozen: true, noRemove: true })`, with required managers/repositories
already present. This is a two-command workflow, not one atomic transaction.

The CLI bootstraps selected Node-based tasks; `client.task()` does not. Provide
its executable/runtime before dispatch. Always inspect task exit codes:

```ts
const result = await client.task("test", ["--run"]);
if (result.exitCode !== 0) {
  throw new Error(`Task failed (${result.exitCode}): ${result.stderr}`);
}
```

This fragment assumes a `client` with a declared `test` task. Spawn failures reject
rather than returning an ordinary nonzero command result.

## Inspect the resolved configuration

```ts
import { createWorkstation, resourceId } from "@dovocode/workstation";

const client = createWorkstation({ configPath: "/absolute/path/workstation.config.ts" });
const config = await client.configuration();
console.log(config.stateFile);
console.log(config.context);
console.log(config.resources.map(resourceId));
```

This is useful before moving a setup, diagnosing machine selection, or choosing
a dependency ID. Loading executable TypeScript is not a sandbox; configuration
code can have its own side effects. Avoid printing entire resolved declarations
when they contain private values.

## Logging and custom runners

Embedded execution is silent by default. Opt into command output with:

```ts
import { createWorkstation, ProcessRunner } from "@dovocode/workstation";

const client = createWorkstation({
  configPath: "/absolute/path/workstation.config.ts",
  runner: new ProcessRunner({ progress: true, verbose: true }),
});
```

`onAction` reports build actions; `onProgress` reports build/plan progress where
supported. `ProcessRunner` captures output, inherits stdin, and directly spawns
literal argument vectors without an implicit shell. It does not allocate a PTY.

Implement `Runner.run(command, args, options)` for tests or another process
boundary. Respect `cwd`, `environment`, and exit-code semantics; return actual
observations instead of unconditional success. Reconciliation verifies results.
A custom runner controls subprocesses, **not** Workstation's direct filesystem I/O.

## Isolate file-only integration tests

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkstation, files } from "@dovocode/workstation";

const root = await mkdtemp(join(tmpdir(), "workstation-example-"));
try {
  const client = createWorkstation({
    configPath: join(root, "workstation.config.ts"),
    context: {
      home: root, configDir: root, hostname: "fixture", machine: "fixture",
      platform: "linux",
    },
    config: {
      stateFile: join(root, "state.json"),
      resources: [files.json("settings.json", { enabled: true })],
    },
  });
  await client.build();
  const actions = await client.plan();
  if (actions.length !== 0) throw new Error("Expected a converged second run");
  // Release claims through reconciliation before deleting the temporary directory.
  await createWorkstation({
    configPath: join(root, "workstation.config.ts"),
    context: {
      home: root, configDir: root, hostname: "fixture", machine: "fixture",
      platform: "linux",
    },
    config: { stateFile: join(root, "state.json"), resources: [] },
  }).build();
} finally {
  await rm(root, { recursive: true, force: true });
}
```

An explicit `context` is accepted only with inline definitions. This example
isolates file targets and state; it is not OS emulation. Native service resources
also consult the process environment, and package/provision operations can affect
the real machine. Use disposable environments for those integration tests.

For lower-level loading, locking, manifests, diagnostics, fingerprints, and runner
contracts, see the generated API reference and [development guide](development.md).
