# Architecture and maintenance

This documents the implementation. The HTML roadmap describes future work.
`src/index.ts` is the public import boundary; internal source paths are not a stable
consumer API. Importing the library must never execute the CLI or exit the host.

## Module ownership

| Module | Responsibility |
| --- | --- |
| `api/` | Typed declarations, helpers and embedded client |
| `cli/arguments.ts` | Argument parsing and incompatible-option validation |
| `commands.ts` | Command names, descriptions and reserved-name lookup |
| `cli/run.ts` | Testable dispatch and command-specific console output |
| `cli.ts` | Process entry point and top-level error exit status |
| `config/` | Evaluation, path resolution, identity and validation |
| `persistence/` | Validated locks, manifests and state serialization |
| `config/value-validation.ts`, `persistence/validation.ts` | Shared data predicates and strict serialized-field readers |
| `rendering/` | Deterministic content transforms without filesystem mutation |
| `resources/` | Inspections, backend commands and individual resource changes |
| `reconciliation/` | Ordering, apply guard, snapshots, verification and checkpoints |
| `diagnostics.ts` | Read-only status and executable checks |

## Execution contracts

The CLI passes its public API to the config loader as a virtual-module fallback
for `@dovocode/workstation`. A resolvable project package takes precedence.
This keeps the loader independent of the public entry point (no circular import),
avoids materializing a fake package on disk, and leaves third-party resolution
unchanged. Direct library callers retain normal project resolution unless they
explicitly supply the optional bundled API to `loadConfig`.

CLI and embedded builds share `reconciliation/build.ts`. A machine/state guard covers
prerequisite preparation, lock resolution, manifest writes, reconciliation and hooks.
Repository resources converge before package queries. A per-action pending journal
preserves intended ownership across interrupted mutations. See [managed setup](managed-setup.md).

Plan resolves pins with `write: false` and inspects resources. It does not bootstrap
or write Workstation state, locks or manifests. TypeScript configuration is executable
user code; native metadata queries may maintain their own caches. Status compares
against recorded pins instead of querying new versions.

## Identity and storage

`resourceId` identifies packages by manager/name (plus Flatpak scope/branch) and
file-like resources by destination. `fingerprint` orders object keys deterministically;
array order remains significant. Lock fingerprints describe declarations, whereas
state fingerprints describe resolved resources, including their applied pins.

Default state hashes the absolute configuration path and machine. An explicit
`stateFile` overrides isolation; moving a config changes the default namespace.
Legacy state requires deliberate reuse/migration. Separate namespaces do not yet
detect overlapping targets. Do not silently infer or transfer ownership.

Changing a resource shape requires updating config validation, manifest encoding and
decoding, and state validation. TypeScript types alone do not validate persisted data.
Never persist executable functions. State backups and snapshots can contain plaintext
configuration and secrets; encrypted persistence is not implemented.

## Restoration and concurrency

Adopted resources are not automatically owned for removal. Overwrite may retain an
original file or symlink; injection manages a marked region; dotenv merge manages
declared keys. Tests must cover preserving later edits outside owned content.

Rollback is compensating reconciliation, not a transaction or VM snapshot. Existing
generated-file updates and exact mise updates are supported. Creation/removal,
injection changes, policy changes, other backends and application data are excluded.
Rollback checks state again under the apply guard and does not rewrite source or lock.

`mapConcurrent` limits independent reads, preserves result order and drains active
work on failure. Mutations use fixed ordering and supported native batches. Explicit dependency edges supplement phase ordering, and a machine guard serializes local mutations.
Partial batches may have succeeded; checkpoint verified results, not assumptions.

## Extension workflow

1. Define the public behavior and failure semantics before choosing abstractions.
2. Add a command to the shared registry, parser/dispatch and CLI documentation.
3. Add a resource to all validation/persistence boundaries, dispatch, ordering and
   ownership logic. Add a backend to capabilities, version resolution and batching.
4. Write preservation, failure and idempotence tests with temporary targets and state.
5. Export supported APIs through `index.ts`; test the public entry point.
6. Run type-checking, lint, relevant tests and generated documentation.

Prefer named option interfaces to repeated anonymous shapes. Keep backend-specific
parsing inside adapters. Use the injectable Runner for processes and literal argument
vectors. Catch only expected filesystem errors. Comments should explain invariants,
ordering and failure handling instead of paraphrasing code.

## Test isolation

Never smoke-test a real build against the default user home. Every test that applies
resources must specify temporary targets and state (or an inline temporary Context).
Never source test dotenv files. Environment helpers are command-construction tasks;
they are not ownership-managed resources, and fake-runner tests do not prove runtime
integration. Actual package integration requires disposable environments.
