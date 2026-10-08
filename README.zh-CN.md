<h1 align="center">app2me</h1>

<div align="center">
  <img src="public/logo/icons/1024x1024.png" alt="app2me" width="128" height="128" />
</div>
<p align="center">
  <a href="README.md">English</a> | 简体中文
</p>

app2me 是包含 MyCode 编程工作台和 MyChat 聊天模式的项目。本仓库包含桌面应用、Web 客户端、后端服务、共享 UI，以及 MyCode Agent CLI 与运行时源码。

## 初始化

准备 Git、Node.js **24.14.0** 和 pnpm **10.33.2**，版本以 [mise.toml](mise.toml) 为准。以下开发和打包命令均在仓库根目录执行。

```bash
pnpm bootstrap
```

`pnpm bootstrap` 安装 workspace 依赖、准备桌面本地运行资源，再执行 `build:bootstrap`。

根据需要选择其他初始化或构建入口：

| 命令                           | 用途                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| `pnpm install`                 | 安装依赖                                                          |
| `pnpm prepare:desktop-runtime` | 准备桌面运行资源，默认包含远程资源准备                            |
| `pnpm prepare:remote-assets`   | 单独准备远程运行资源                                              |
| `pnpm bootstrap:with-remote`   | 初始化依赖、本地与远程资源，并串行构建相关包；跳过桌面应用 bundle |
| `pnpm build`                   | 递归执行各 workspace 包的构建脚本，包括包内的资源准备步骤         |

默认 `bootstrap` 跳过远程资源准备，适合本地桌面开发。使用远程工作区或验证远程发行资源时，再运行对应准备命令。

## 开发与运行

### 桌面版

```bash
pnpm dev:desktop

# 使用测试环境
pnpm dev:desktop:test
```

`pnpm dev:desktop` 默认等同于 `pnpm dev:desktop:prod`，使用生产服务配置。启动脚本会准备本地运行资源、构建桌面 Agent，再启动 Electron 和源码监听。

需要独立开发数据目录时，可设置 `MYCODE_DATA_BASE_DIR`。例如在 macOS / Linux 中：

```bash
MYCODE_DATA_BASE_DIR="$HOME/.mycode-dev-home" pnpm dev:desktop:test
```

### 远程功能（SSH/WSL）

先执行 `pnpm bootstrap:with-remote` 准备远程资源（mock-cdn），再 `pnpm dev:desktop`；连接远程项目时资源选择「本地下载后上传」。开发态资源取自本地 `packages/desktop/mock-cdn` 和本地构建产物，经 SFTP 上传到远程，不访问 CDN。

### Web 开发

修改 Web 或后端源码时，使用开发模式：

```bash
pnpm dev:web

# 指定后端工作区（macOS / Linux）
MYCODE_SERVER_WORKSPACE=/path/to/project pnpm dev:web
```

该命令同时启动 Web 开发服务器（默认 `http://localhost:5173`）和后端（默认 `http://localhost:3030`）；浏览器访问前者。`/ws` 和一般 `/api` 请求代理到本地后端。

Agent 源码修改后，执行 `pnpm --filter @mycode/cli... build` 并重启服务。需要验证完整发行包时，按下方“MyCode 命令行版”打包章节解压运行。

### MyCode 命令行版

命令行发行包包含 TUI、Web 和 Agent，统一使用 `mycode` 启动：无参数进入 TUI；第一个参数为 `--web` 时启动 Web；其他参数交给现有 Agent CLI 处理。两种模式都在本机运行，无需 Electron。

```bash
# 默认进入终端交互界面
mycode

# 启动 Web 界面
mycode --web

# 指定项目和端口，不自动打开浏览器
mycode --web --workspace /path/to/project --port 3030 --no-open

# 查看 CLI 或 Web 参数
mycode --help
mycode --web --help
```

Web 模式默认工作目录为当前目录，监听 `127.0.0.1`，默认不启用访问令牌，自动选择空闲端口并打开浏览器。访问终端输出的地址，按 `Ctrl+C` 停止服务。局域网访问可使用 `--host 0.0.0.0`；监听非本机地址时默认生成访问令牌，使用终端输出的带令牌链接。可通过 `--token` 指定令牌或 `--no-token` 关闭令牌认证。

直接启动通用 Web 服务的 HTTP 入口时，通过 `MYCODE_SERVER_AUTH_TOKEN` 配置 API／WebSocket 认证；通过程序接口创建服务时，使用 `authToken` 选项。

构建方式见下方打包章节。`pnpm build:mycode` 只生成发行包，不会替换 `PATH` 中已有的 `mycode`。如果命令仍指向旧安装或其他源码目录，macOS / Linux 可用 `command -v mycode` 检查，Windows 可用 `where.exe mycode` 检查。

### CLI 源码开发

直接开发 TUI 或 Agent 时，运行源码入口：

```bash
pnpm --filter @mycode/cli dev --help
pnpm --filter @mycode/cli dev

# 构建 CLI 及其 workspace 依赖
pnpm --filter @mycode/cli... build
node apps/mycode-cli/packages/cli/dist/mycode.cjs --help
```

这个入口直接运行 Agent CLI，不经过发行包的 `--web` 分流。开发 Web 用 `pnpm dev:web`；验证统一的 `mycode` 命令，用下方解压后的 `bin/mycode.mjs`。

## 配置

根目录 [.env.example](.env.example) 提供服务地址与构建配置示例，可按需复制到 `.env`，本地覆盖放入 `.env.local`。Desktop 的开发环境通过 `dev:desktop:test` / `dev:desktop:prod` 选择。

| 配置                                  | 用途                                             |
| ------------------------------------- | ------------------------------------------------ |
| `MYCODE_DATA_BASE_DIR`                | 应用数据基目录，数据写入其下的 `.mycode/`        |
| `MYCODE_SERVER_WORKSPACE`             | Web 后端的工作区路径                             |
| `MYCODE_BUILTIN_PROVIDER_CONFIG_FILE` | 本地 Provider 配置文件路径；未设置时使用内置配置 |
| `MYCODE_DIST_BASE_URL`                | 命令行安装脚本使用的下载根地址                   |

运行时变量可在启动命令的环境中显式设置。随客户端发布的内置模型配置见 [mycode-builtin.json](config/provider/mycode-builtin.json)。

## 打包

### 桌面版

```bash
pnpm bundle:desktop

# 指定目标平台与 CPU 架构
pnpm bundle:desktop -- --os win --arch x64

pnpm bundle:desktop -- --help
```

默认目标为当前系统和 CPU 架构，输出目录为 `releases/current/`。`bundle:desktop` 与 `release` 共用构建入口，产物名为 `app2me-YYYY-MM-DD`。`pnpm release:publish` 发布至 GitHub 固定 `latest`。`--os` 支持 `mac`、`win`、`linux`，`--arch` 支持 `x64`、`arm64`；实际打包与签名需要目标平台对应的工具和配置。

安装：双击打开产物 DMG，将 app2me 拖入"应用程序"。本地构建未签名，首次打开若被 macOS 拦截，执行：

```bash
sudo xattr -rd com.apple.quarantine /Applications/app2me.app
```

### MyCode 命令行版

构建入口为 `pnpm build:mycode`。脚本会依次构建 CLI/TUI、后端和 Web，收集 TUI 的原生库、worker 与运行时依赖，再组装发行包；运行发行包仍需要 Node.js，版本以 `mise.toml` 为准。

打包前必须设置下载根地址 `MYCODE_DIST_BASE_URL`（可放在 `.env`、`.env.local` 或环境变量中），也可以通过 `--base-url` 传入。以下地址是占位示例，发布时替换为实际托管地址：

```bash
pnpm build:mycode --base-url https://downloads.example.com/mycode/

# 已配置 MYCODE_DIST_BASE_URL 时
pnpm build:mycode

# 仅重新组包，复用已有的 Agent、后端和 Web 构建产物
pnpm build:mycode --skip-build

# 查看版本、输出目录等可选参数
pnpm build:mycode --help
```

默认版本取根目录 `package.json`，输出目录为 `dist/mycode/`：

- `releases/<version>/mycode-<version>.tar.gz`：运行包。
- `releases/<version>/sha256.txt`：校验摘要。
- `latest.json`、`install.sh`：版本索引和安装脚本。

完整目录可上传到配置的下载根地址。安装脚本从该地址下载运行包，默认安装到 `~/.mycode/runtime`，并在 `~/.local/bin` 创建 `mycode` 命令。安装目录可通过 `MYCODE_DIST_HOME` 修改，命令目录可通过 `MYCODE_DIST_BIN_DIR` 修改。

本地调试打包产物时，可直接解压运行，无需上传或安装：

```bash
mycode_version=$(node -p "require('./dist/mycode/latest.json').version")
mkdir -p dist/mycode/debug
tar -xzf "dist/mycode/releases/$mycode_version/mycode-$mycode_version.tar.gz" \
  -C dist/mycode/debug
# 默认启动 TUI
node dist/mycode/debug/mycode/bin/mycode.mjs

# 启动 Web
node dist/mycode/debug/mycode/bin/mycode.mjs --web \
  --workspace "$PWD" --port 3030 --no-open
```

浏览器打开 `http://127.0.0.1:3030`，即可验证同一后端服务托管 Web 页面和 Agent 的完整链路。该端口需要空闲；如正在运行 `pnpm dev:web`，可改用其他 `--port`。

## 仓库结构

| 目录                                                 | 职责                                       |
| ---------------------------------------------------- | ------------------------------------------ |
| `packages/desktop`                                   | Electron Main、Host、Renderer 与桌面打包   |
| `packages/web`                                       | Web 客户端                                 |
| `packages/server`                                    | HTTP / WebSocket 服务与远程连接            |
| `packages/mycode-server-cli`                         | 独立 Server 启动与进程管理                 |
| `packages/ui`                                        | 共享 React 组件、hooks 与 Zustand 状态     |
| `packages/services`                                  | 业务服务与持久化                           |
| `packages/shared`、`packages/rpc`、`packages/client` | 共享协议和类型、RPC 框架、Agent 客户端 SDK |
| `packages/provider`、`packages/provider-node`        | Provider 公共能力与 Node 实现              |
| [apps/mycode-cli](apps/mycode-cli/README.md)         | Agent CLI、TUI、运行时与工具               |
| `scripts`、`config`、`third-party`                   | 构建维护脚本、内置配置与第三方声明材料     |

## 自动发布

每次推送到 `main`（含 PR 合并）后，[GitHub Actions](.github/workflows/release.yml) 为每条新代码提交准备递增的内部版本，并构建 macOS、Windows、Linux 的 x64 和 arm64 安装包。六个目标均通过严格许可与产物校验后，统一覆盖 GitHub 固定 `latest` 发布。日期命名保持 `app2me-YYYY-MM-DD`。已随提交更新的版本直接复用，重跑同一提交不重复增加版本，旧任务不能覆盖更新版本。手动重试使用工作流的提交 SHA 输入。

工作流需要仓库允许 Actions 写入版本提交和 Releases；若分支保护禁止机器人直接写入 `main`，应为该工作流配置合适的 GitHub App 权限。安装包默认未签名；签名需单独配置对应平台凭据。

## 许可

[Apache-2.0](LICENSE) · [项目声明](NOTICE.md) · [第三方声明](THIRD-PARTY-NOTICES.md)
