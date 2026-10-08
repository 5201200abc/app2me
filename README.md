<h1 align="center">app2me</h1>

<div align="center">
  <img src="public/logo/icons/1024x1024.png" alt="app2me" width="128" height="128" />
</div>
<p align="center">
  English | <a href="README.zh-CN.md">简体中文</a>
</p>

app2me contains the MyCode coding workspace and MyChat chat mode. This repository includes the desktop and Web clients, backend services, shared UI, and MyCode Agent CLI/runtime.

## Setup

Install Git, Node.js **24.14.0**, and pnpm **10.33.2**. [mise.toml](mise.toml) is the source of truth for tool versions. Run all development and packaging commands below from the repository root.

```bash
pnpm bootstrap
```

`pnpm bootstrap` installs workspace dependencies, prepares local desktop runtime assets, and runs `build:bootstrap`.

Additional setup and build commands:

| Command                        | Purpose                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                 | Install dependencies                                                                                                                |
| `pnpm prepare:desktop-runtime` | Prepare desktop runtime assets, including remote assets by default                                                                  |
| `pnpm prepare:remote-assets`   | Prepare remote runtime assets separately                                                                                            |
| `pnpm bootstrap:with-remote`   | Set up dependencies and local and remote assets, then build the relevant packages sequentially; skip the desktop application bundle |
| `pnpm build`                   | Recursively run each workspace package's build script, including its asset preparation steps                                        |

The default `bootstrap` skips remote asset preparation and is suitable for local desktop development. Run the corresponding preparation command when working with remote workspaces or validating remote distribution assets.

## Development and Usage

### Desktop

```bash
pnpm dev:desktop

# Use the test environment
pnpm dev:desktop:test
```

`pnpm dev:desktop` defaults to `pnpm dev:desktop:prod` and uses production service configuration. The startup script prepares local runtime assets, builds the desktop Agent, then starts Electron and source watchers.

Set `MYCODE_DATA_BASE_DIR` to use a separate development data directory. For example, on macOS / Linux:

```bash
MYCODE_DATA_BASE_DIR="$HOME/.mycode-dev-home" pnpm dev:desktop:test
```

### Remote workspaces (SSH/WSL)

Run `pnpm bootstrap:with-remote`, then `pnpm dev:desktop`. When connecting a remote project, choose “Download locally and upload.” Development assets come from `packages/desktop/mock-cdn` and local builds and are uploaded over SFTP.

### Web Development

Use development mode when editing Web or backend source code:

```bash
pnpm dev:web

# Set the backend workspace (macOS / Linux)
MYCODE_SERVER_WORKSPACE=/path/to/project pnpm dev:web
```

This starts both the Web development server (default: `http://localhost:5173`) and the backend (default: `http://localhost:3030`). Open the Web development server in your browser. `/ws` and general `/api` requests are proxied to the local backend.

After changing Agent source code, run `pnpm --filter @mycode/cli... build` and restart the service. To validate the complete distribution, extract and run it as described under Packaging → MyCode CLI distribution below.

### MyCode CLI distribution

The command-line distribution includes the TUI, Web client, and Agent behind one `mycode` command. With no arguments it starts the TUI; a leading `--web` starts Web mode; all other arguments go to the existing Agent CLI. Both modes run locally without Electron.

```bash
# Start the terminal UI by default
mycode

# Start the Web interface
mycode --web

# Set the project and port without opening a browser automatically
mycode --web --workspace /path/to/project --port 3030 --no-open

# Show CLI or Web options
mycode --help
mycode --web --help
```

In Web mode, it uses the current directory as the workspace, listens on `127.0.0.1` without token authentication by default, selects an available port, and opens a browser. Use the URL printed in the terminal and press `Ctrl+C` to stop the service. For LAN access, use `--host 0.0.0.0`; listening on a non-local address generates an access token by default. Use the token-bearing URL printed in the terminal. Set a token with `--token`, or disable token authentication with `--no-token`.

When starting the general Web service's HTTP entry directly, configure API/WebSocket authentication with `MYCODE_SERVER_AUTH_TOKEN`. When creating the service programmatically, use the `authToken` option.

See Packaging below for build instructions. `pnpm build:mycode` only creates the distribution; it does not replace an existing `mycode` on `PATH`. If the command still points to an older installation or another checkout, check it with `command -v mycode` on macOS / Linux or `where.exe mycode` on Windows.

### CLI Source Development

Use the source entry when developing the TUI or Agent:

```bash
pnpm --filter @mycode/cli dev --help
pnpm --filter @mycode/cli dev

# Build the CLI and its workspace dependencies
pnpm --filter @mycode/cli... build
node apps/mycode-cli/packages/cli/dist/mycode.cjs --help
```

This entry runs the Agent CLI directly and does not handle the distribution's `--web` switch. Use `pnpm dev:web` for Web development, or the extracted `bin/mycode.mjs` shown below to test the unified command.

## Configuration

The root [.env.example](.env.example) provides sample service URLs and build configuration. Copy it to `.env` as needed and place local overrides in `.env.local`. Select the Desktop development environment with `dev:desktop:test` or `dev:desktop:prod`.

| Setting                               | Purpose                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| `MYCODE_DATA_BASE_DIR`                | Base directory for application data, stored under its `.mycode/` subdirectory           |
| `MYCODE_SERVER_WORKSPACE`             | Workspace path for the Web backend                                                      |
| `MYCODE_BUILTIN_PROVIDER_CONFIG_FILE` | Path to a local provider configuration file; uses the built-in configuration when unset |
| `MYCODE_DIST_BASE_URL`                | Download base URL used by the CLI distribution installer                                |

Runtime variables can be set explicitly in the environment of the startup command. See [mycode-builtin.json](config/provider/mycode-builtin.json) for the built-in model configuration shipped with the client.

## Packaging

### Desktop

```bash
pnpm bundle:desktop

# Set the target platform and CPU architecture
pnpm bundle:desktop -- --os win --arch x64

pnpm bundle:desktop -- --help
```

The default target is the current OS and CPU architecture. Output is written to `releases/current/`. `bundle:desktop` and `release` use the same build entry point, producing `app2me-YYYY-MM-DD` artifacts. `pnpm release:publish` publishes to the fixed GitHub `latest` release. `--os` accepts `mac`, `win`, or `linux`; `--arch` accepts `x64` or `arm64`. Packaging and signing require the tools and configuration for the target platform.

Install on macOS by opening the DMG and dragging app2me into Applications. If macOS blocks an unsigned local build on first launch, run:

```bash
sudo xattr -rd com.apple.quarantine /Applications/app2me.app
```

### MyCode CLI distribution

Run `pnpm build:mycode` to build the CLI/TUI, backend, and Web client, collect the TUI native libraries, workers, and runtime dependencies, then assemble the distribution. Running the distribution still requires Node.js; use the version specified in `mise.toml`.

Before packaging, set the download base URL with `MYCODE_DIST_BASE_URL` in `.env`, `.env.local`, or the process environment, or pass it through `--base-url`. The URL below is a placeholder; replace it with your hosting URL when publishing:

```bash
pnpm build:mycode --base-url https://downloads.example.com/mycode/

# When MYCODE_DIST_BASE_URL is already configured
pnpm build:mycode

# Repackage existing Agent, backend, and Web build outputs
pnpm build:mycode --skip-build

# Show options for the version, output directory, and more
pnpm build:mycode --help
```

The version defaults to the root `package.json` version. Output is written to `dist/mycode/`:

- `releases/<version>/mycode-<version>.tar.gz`: runtime package.
- `releases/<version>/sha256.txt`: checksum file.
- `latest.json` and `install.sh`: version index and installer.

Upload the entire directory to the configured download base URL. The installer downloads the runtime package from that URL, installs it to `~/.mycode/runtime` by default, and creates the `mycode` command in `~/.local/bin`. Override these directories with `MYCODE_DIST_HOME` and `MYCODE_DIST_BIN_DIR`, respectively.

To test a packaged build locally, extract and run it directly without uploading or installing it:

```bash
mycode_version=$(node -p "require('./dist/mycode/latest.json').version")
mkdir -p dist/mycode/debug
tar -xzf "dist/mycode/releases/$mycode_version/mycode-$mycode_version.tar.gz" \
  -C dist/mycode/debug
# Start the TUI by default
node dist/mycode/debug/mycode/bin/mycode.mjs

# Start Web mode
node dist/mycode/debug/mycode/bin/mycode.mjs --web \
  --workspace "$PWD" --port 3030 --no-open
```

Open `http://127.0.0.1:3030` to validate the complete flow, with one backend serving the Web pages and running the Agent. The port must be available; if `pnpm dev:web` is already running, choose another `--port`.

## Repository Structure

| Directory                                            | Responsibility                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/desktop`                                   | Electron Main, Host, Renderer, and desktop packaging                                    |
| `packages/web`                                       | Web client                                                                              |
| `packages/server`                                    | HTTP / WebSocket services and remote connections                                        |
| `packages/mycode-server-cli`                         | Standalone server startup and process management                                        |
| `packages/ui`                                        | Shared React components, hooks, and Zustand state                                       |
| `packages/services`                                  | Business services and persistence                                                       |
| `packages/shared`, `packages/rpc`, `packages/client` | Shared protocols and types, RPC framework, and Agent client SDK                         |
| `packages/provider`, `packages/provider-node`        | Common provider capabilities and Node implementations                                   |
| [apps/mycode-cli](apps/mycode-cli/README.md)         | Agent CLI, TUI, runtime, and tools                                                      |
| `scripts`, `config`, `third-party`                   | Build and maintenance scripts, built-in configuration, and third-party notice materials |

## Automatic releases

After each push to `main` (including PR merges), [GitHub Actions](.github/workflows/release.yml) prepares an increasing shared internal version for each new source commit and builds x64 and arm64 installers for macOS, Windows, and Linux. All six targets must pass strict license and artifact checks before replacing the fixed GitHub `latest` release. Artifact names remain `app2me-YYYY-MM-DD`. Already prepared versions are reused; retrying a commit does not increment its version again, and superseded jobs cannot overwrite a newer version. Use the workflow’s commit-SHA input for a manual retry.

The repository must allow Actions to commit version updates and write Releases. If branch protection prevents the bot from writing directly to `main`, configure suitable GitHub App permissions for this workflow. Installers are unsigned by default; signing requires separate platform credentials.

## License

[Apache-2.0](LICENSE) · [Project notice](NOTICE.md) · [Third-party notices](THIRD-PARTY-NOTICES.md)
