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

## RPM backend integration tests

The regular test suite uses fake command results and does not change system packages.
With Docker running, exercise actual DNF 5 (Fedora), DNF 4 (Amazon Linux 2023), and
legacy YUM (Amazon Linux 2) in disposable containers:

```sh
WORKSTATION_RPM_INTEGRATION=1 corepack pnpm exec vitest run test/rpm.integration.test.ts
```

This downloads the images and tests locking, installation, verification, repeat
runs, removal, and upgrades/downgrades when an older package is available.
It also verifies multi-package installation and removal in one native transaction.
The test containers are removed afterward; downloaded images remain cached.

## APT, pacman and Flatpak integration tests

```sh
WORKSTATION_APP_INTEGRATION=1 corepack pnpm exec vitest run test/app-packages.integration.test.ts test/apt-batch.integration.test.ts
```

These use disposable Ubuntu, Arch Linux and Fedora containers, including native
multi-package installs/removals. Flatpak uses tiny local
test apps and a runtime, exercising user/system installs, pinned updates, rollback
to a retained commit, and removal without downloading desktop runtimes.
On ARM Docker hosts, Arch runs under x86 emulation; the test adapter disables
only pacman's downloader syscall sandbox because QEMU cannot install its seccomp
filters. Production Workstation commands retain pacman's normal sandboxing.
The containers are removed afterward; image caches and temporary fixtures remain.
MAS mutation tests use recorded command responses and do not install, update,
purchase, or remove apps from your Apple Account.

## Publish a release

The `build.yml` workflow publishes to npm only for pushed `v*` tags, after all
four Linux/macOS builds pass. The tag must equal `v` plus the version in
`package.json`. Stable versions use npm's `latest` tag; prereleases use `next`.
Branch pushes, pull requests, and manual workflow runs do not publish.

Authentication uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
with GitHub OIDC and provenance, without a stored npm token. The npm package must
trust GitHub repository `dovocode/workstation`, workflow filename `build.yml`,
with publishing allowed and no environment restriction.

Use Conventional Commits for new commits, for example
`feat(packages): add a package backend`, `fix(migration): restore completion links`,
or `docs: clarify setup requirements`. Record user-visible changes in
`CHANGELOG.md` under Unreleased as part of each change. Existing history does not
need to be rewritten.

To release, update the package version and move the Unreleased changes into a
dated changelog section. Verify the release, commit it with
`chore(release): <version>`, then push the matching tag only when npm publication
is intended. For example, after preparing version `0.1.1`:

```sh
corepack pnpm check
corepack pnpm test
corepack pnpm build:native
corepack pnpm run docs
git add package.json CHANGELOG.md
git commit -m "chore(release): 0.1.1"
git push origin main
git tag -a v0.1.1 -m "chore(release): 0.1.1"
git push origin v0.1.1
```

Use a new version for each release; npm versions cannot be overwritten. Do not
tag the already-published `0.1.0` expecting it to publish again.
