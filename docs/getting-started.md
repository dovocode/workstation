# Getting started

## Prerequisites

- macOS or Linux. The native executable does not require Node.js, npm, Corepack,
  or pnpm. The JavaScript CLI requires Node.js 26.8.1 or later.
- Workstation bootstraps mise when a mise resource or Node-based task needs it.
  It also bootstraps Homebrew when a Homebrew formula or cask is declared.
  Newly installed tools are available in the same run; no shell restart is needed.
- A selected `node`, `npm`, `npx`, or `pnpm` task bootstraps Node.js 26.8.1 through
  mise. A selected `pnpm` task also bootstraps pnpm 12.3.4.
- APT, DNF, YUM, pacman, Flatpak, and mas are not bootstrapped.
- Build tools required by custom executables must be available when their build runs.

## Install the native executable

The release binaries support macOS and Linux on Intel/AMD 64-bit (`x64`) and
ARM 64-bit (`arm64`) systems. Install the latest release into `~/.local/bin`.

### Install with curl

```sh
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
  x86_64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac
mkdir -p "$HOME/.local/bin"
curl -fL "https://github.com/dovocode/workstation/releases/latest/download/workstation-${os}-${arch}" \
  -o "$HOME/.local/bin/workstation"
chmod +x "$HOME/.local/bin/workstation"
```

### Install with wget

```sh
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
  x86_64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac
mkdir -p "$HOME/.local/bin"
wget -O "$HOME/.local/bin/workstation" \
  "https://github.com/dovocode/workstation/releases/latest/download/workstation-${os}-${arch}"
chmod +x "$HOME/.local/bin/workstation"
```

Add `~/.local/bin` to your shell's PATH if it is not already present. For Zsh:

```sh
printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$HOME/.zshrc"
export PATH="$HOME/.local/bin:$PATH"
```

For Bash:

```sh
printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$HOME/.bashrc"
export PATH="$HOME/.local/bin:$PATH"
```

Verify the installation:

```sh
workstation --help
```

macOS binaries are ad-hoc signed but not notarized. If Gatekeeper blocks the
download, review the release and then remove the quarantine attribute explicitly:

```sh
xattr -d com.apple.quarantine "$HOME/.local/bin/workstation"
```

### macOS: Homebrew and mise

Homebrew and mise are recommended companions: Homebrew manages system packages
and applications; mise manages development runtimes such as Node.js and Go.
They are required only when your configuration uses those backends, and Workstation
installs either one on demand. The commands below remain useful for manual setup.

Install Homebrew using its [official installer](https://docs.brew.sh/Installation):

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the installer's **Next steps** to add `brew shellenv` to your shell profile.
The default prefix is `/opt/homebrew` on Apple Silicon and `/usr/local` on Intel.
Open a new terminal, then install mise:

```sh
brew install mise
```

Add this line to `~/.zshrc`, then open a new terminal:

```sh
eval "$(mise activate zsh)"
```

For Bash, use `eval "$(mise activate bash)"` in `~/.bashrc` instead.
See [mise installation](https://mise.jdx.dev/installing-mise.html) for other shells.

### Linux: mise and the distro package manager

On Linux, mise is the recommended additional tool; Homebrew is not needed.
Workstation installs mise on demand. The commands below show the equivalent manual setup.
Workstation uses APT on Debian/Ubuntu, DNF on distributions that provide it,
legacy YUM, or pacman on Arch Linux. `tools.system(...)` checks PATH in that order. Package mutations
use `sudo`; the distro package manager and `sudo` must already be installed.

Install mise with its [official installer](https://mise.jdx.dev/getting-started.html):

```sh
curl https://mise.run | sh
```

If `curl` is missing, install it with your distro's package manager first
(`sudo apt-get install curl`, `sudo dnf install curl`, `sudo yum install curl`,
or `sudo pacman -S curl`).

Add this line to `~/.bashrc`, then open a new terminal:

```sh
eval "$(~/.local/bin/mise activate bash)"
```

For Zsh, use `eval "$(~/.local/bin/mise activate zsh)"` in `~/.zshrc` instead.

### Optional application backends

For Mac App Store declarations on macOS, install the
[mas CLI](https://github.com/mas-cli/mas#installation) and sign in using the App Store app:

```sh
brew install mas
mas list
```

Acquire each declared app in the App Store first. `mas` can request administrator
authentication during mutations; Workstation does not purchase apps or manage
your Apple Account. macOS compatibility depends on the installed mas release.

For Flatpak declarations on Linux, install Flatpak with your distro's manager
(`sudo apt-get install flatpak`, `sudo dnf install flatpak`,
`sudo yum install flatpak`, or `sudo pacman -S flatpak`). Follow
[Flatpak's setup guide](https://flatpak.org/setup/) for your distribution, then
configure Flathub in user scope to match Workstation's defaults:

```sh
flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
```

For `scope: "system"`, configure the system remote instead:

```sh
sudo flatpak remote-add --system --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
```

Flatpak and mas must be installed before Workstation resolves their declarations;
declaring the backend executable itself as a package in the same first run does
not bootstrap it before version resolution and inspection.

### Node.js and building Workstation

The native Workstation executable can run without Node.js. When a selected task's
command is `node`, `npm`, `npx`, or `pnpm`, Workstation installs the pinned Node.js
version with mise if needed; `pnpm` tasks similarly install the pinned pnpm version.
For manual source builds, mise can provide Node.js on either platform:

```sh
mise use --global node@26.8.1
node --version
```

Make sure Corepack is available (`npm install --global corepack` if needed).

The source package is built locally; this repository does not imply an npm release.
The following commands run from the repository root:

```sh
corepack pnpm install
corepack pnpm build
node dist/cli.js --help
```

## Your first configuration

Run `workstation init` to create `workstation.config.ts` in the current directory.
Use `workstation init --config setup/workstation.config.ts` for a custom path;
missing parent directories are created. Existing files and symlinks are never
overwritten. Initialization does not install dependencies, execute configuration,
or create a lock, manifest, or ownership state. The starter uses a type-only
import; make the package available in your project for editor types and helpers.

The starter includes empty shared and machine-specific resources plus a harmless
`hello` task and `hi` alias. Add resources using a default export like this:

```ts
import { defineConfig, files, tools } from "@dovocode/workstation";

export default defineConfig({
  resources: [
    tools.mise({ node: "lts" }),
    files.json("~/.config/example/settings.json", { enabled: true }),
  ],
});
```

Then execute it:

```sh
corepack pnpm workstation
```

This resolves package versions into `workstation.lock`, writes a private
resolved TOML manifest, and reconciles your machine. This repository does not contain a personal setup; create your own entry point.
Generated files overwrite by default and retain an original backup in local state.

## CLI reference

| Invocation | Behavior |
| --- | --- |
| `workstation init` | Create a starter configuration without applying it |
| `workstation init --config setup/workstation.config.ts` | Create a starter at a custom path |
| `workstation` | Execute `workstation.config.ts` in the current directory |
| `workstation --config /path/workstation.config.ts` | Use another entry point |
| `workstation --machine studio` | Override the machine name for configuration and state |
| `workstation --help` | Show help without loading or executing configuration |

Within this repository use `node dist/cli.js` in place
of `workstation` if it is not installed on PATH. Config discovery does not
walk parent directories. Unknown options fail.

Run as the target login user. APT/DNF/YUM/pacman mutations, system Flatpak installs, and system-scope systemd actions
invoke sudo for the individual privileged steps; do not run the entire CLI as root.

## Native executable

```sh
corepack pnpm build:native
```

The Node SEA build writes an executable for the current platform/architecture
under `dist/bin/`. It embeds Node and CLI dependencies.
Keep @dovocode/workstation available for `import ... from "@dovocode/workstation"` in
your configuration. The GitHub Actions workflow builds macOS and Linux artifacts for x64 and arm64 on native runners.
