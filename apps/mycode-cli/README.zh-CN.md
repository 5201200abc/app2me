# MyCode CLI

[English](README.md) | 简体中文

MyCode Agent CLI、TUI、运行时与工具，使用 TypeScript 和 Node.js。工具版本以仓库根目录的 [mise.toml](../../mise.toml) 为准。

## 开发

在仓库根目录执行：

```sh
pnpm bootstrap
pnpm --filter @mycode/cli dev --help
pnpm --filter @mycode/cli dev
pnpm --filter @mycode/cli... build
node apps/mycode-cli/packages/cli/dist/mycode.cjs --help
pnpm --dir apps/mycode-cli check
```

Node CLI 产物位于本目录下的 `packages/cli/dist/mycode.cjs`。包含 TUI/Web 的完整发行包见根目录 [README](../../README.zh-CN.md)。

## 目录结构

```txt
packages/
  cli/          command parsing and CLI entry point
  tui/          terminal UI
  core/         Agent runtime and tools
  contracts/    shared interfaces and events
  adapters/     models, storage, MCP, and plugins
  bootstrap/    application and protocol wiring
scripts/        workspace build and validation scripts
```

## 插件开发

mycode 插件是本地资源包，可提供技能、自定义命令和 MCP 服务器。

插件状态保存在 `~/.mycode/cli/plugins`：

- `cache/`：已安装的市场插件代码和静态文件。
- `data/<plugin-id>/`：插件持久化数据。MCP 服务器应将运行输出写入此处，而非插件源码目录。
- `marketplaces/mycode-plugins-official/`：内置与 CDN 分区，以及合并后的插件市场元数据。

本仓库将内置插件作为 workspace 包提供。Browser Use、Document Skills、Skill Creator 和 MyCode Guide 内容插件默认启用，标识分别为 `browser-use@mycode-plugins-official`、`document-skills@mycode-plugins-official`、`skill-creator@mycode-plugins-official` 和 `mycode-guide@mycode-plugins-official`。运行依赖较多的插件以及本地数据迁移插件，如 `ios-simulator@mycode-plugins-official`、`android-emulator@mycode-plugins-official` 和 `restore-legacy-sessions@mycode-plugins-official`，由 mycode 发现后等待用户启用。

```sh
mycode plugins list
mycode plugins enable ios-simulator
mycode plugins disable browser-use
mycode plugins enable restore-legacy-sessions
mycode plugins disable ios-simulator
```

开发本地插件时，将插件放在任意目录，再添加到用户配置。配置中的本地插件目录默认启用。

```json
{
  "plugins": {
    "enabled": true,
    "dirs": ["/absolute/path/to/my-plugin"]
  }
}
```

### 插件清单

MCP 配置可直接放入 `.mycode-plugin/plugin.json` 的 `mcpServers` 字段。插件可同时提供 `.mcp.json` 和清单中的 `mcpServers`；同名服务器以选中清单中的 `mcpServers` 为准。

插件支持以下字段：

- `name`, `version`, `description`, `author`, `license`
- `skills`：包含 `SKILL.md` 的相对目录，可指定一个或多个。
- `commands`：包含 Markdown 自定义命令的相对目录，可指定一个或多个。
- `mcpServers`：内嵌 MCP 服务器配置，或指向配置文件的相对路径。
- `userConfig`：用于 `${user_config.key}` 展开的选项默认值。

在 `.mycode-plugin/plugin.json` 中内嵌 MCP 配置的示例：

```json
{
  "name": "ios-simulator",
  "version": "0.1.0",
  "skills": "skills",
  "commands": "commands",
  "mcpServers": {
    "ios-simulator": {
      "command": "node",
      "args": ["${MYCODE_PLUGIN_ROOT}/dist/mcp/server.js"],
      "cwd": "${MYCODE_PROJECT_DIR}",
      "env": {
        "PLUGIN_DATA": "${MYCODE_PLUGIN_DATA}",
        "DEFAULT_DEVICE": "${user_config.default_device}"
      }
    }
  },
  "userConfig": {
    "default_device": {
      "type": "string",
      "default": "iPhone 16"
    }
  }
}
```

### 变量

插件 MCP 配置可使用以下变量：

- `${MYCODE_PLUGIN_ROOT}`
- `${MYCODE_PLUGIN_DATA}`
- `${MYCODE_PROJECT_DIR}`
- `${user_config.key}`
- `${MYCODE_SOME_ENV}`

仅展开以 `MYCODE_` 为前缀的环境变量。缺失变量会禁用对应 MCP 服务器，并生成插件诊断信息。

### 推荐目录结构

```txt
my-plugin/
  .mycode-plugin/plugin.json
  .mcp.json
  skills/
    my-skill/SKILL.md
  commands/
    my-command.md
  src/
```

面向 mycode-cli 的 MCP 服务器宜采用常规 Node 构建和 `bin` 产物，将进程、文件和网络副作用限制在 MCP 服务器边界内。

## MCP 配置

mycode 从主 JSON 配置读取 MCP 服务器，默认用户配置路径为 `~/.mycode/cli/config.json`，服务器位于 `mcp.servers`。MCP 默认启用，仅需在显式切换时设置 `features.mcp`。CLI 不会自动发现已启用插件之外独立存在的 `mcp.json` 或 `.mcp.json`。

```json
{
  "features": {
    "mcp": true
  },
  "mcp": {
    "servers": {
      "filesystem": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
        "cwd": ".",
        "timeoutMs": 30000
      },
      "docs": {
        "type": "http",
        "url": "https://mcp.example.com/mcp",
        "headers": {
          "Authorization": "Bearer <token>"
        }
      },
      "legacy-sse": {
        "type": "sse",
        "url": "https://mcp.example.com/sse",
        "enabled": false
      }
    }
  }
}
```

支持以下服务器类型：

- `stdio`：必填 `command`，支持 `args`、`cwd`、`env`、`enabled` 和 `timeoutMs`。`cwd` 相对当前工作目录解析；服务器继承 mycode 环境，并应用 `env` 覆盖。
- `http`：必填 `url`，支持 `headers`、`enabled` 和 `timeoutMs`。
- `sse`：必填 `url`，支持 `headers`、`enabled` 和 `timeoutMs`。

MCP 工具在首次模型请求前注册，以 `mcp__<server>__<tool>` 暴露。在 CLI 内使用 `/mcp list`、`/mcp status`、`/mcp connect <server>` 和 `/mcp disconnect <server>` 查看或管理当前会话的服务器。

## Hooks 配置

Hooks 与 MCP 使用同一个主 JSON 配置文件，通常为 `~/.mycode/cli/config.json`。Hooks 默认关闭；设置 `hooks.enabled` 为 `true`，并在 `hooks.events` 中添加进程 Hook。

支持以下 Hook 事件：

- `SessionStart`：会话上下文初始化后、首次普通提示发送给模型前执行，可追加上下文；匹配器接收 `startup` 或 `resume` 等来源。
- `UserPromptSubmit`：用户提示写入历史或发送给模型前执行，可用 `continue: false` 阻止提交或追加上下文；匹配器接收原始提示文本。
- `PreToolUse`：客户端工具执行前运行，可拒绝、询问、允许、替换工具输入或追加模型可见上下文；匹配器接收工具名。
- `PermissionRequest`：工具需要审批时执行，可允许、拒绝、更新权限或修改待审批的工具输入；匹配器接收工具名。
- `PostToolUse`：工具成功后、结果返回模型前执行，可追加上下文；匹配器接收工具名。
- `PostToolUseFailure`：工具失败后、错误返回模型前执行，可追加恢复上下文；匹配器接收工具名。
- `Stop`：回合准备结束且无后续客户端工具调用时执行，可提供反馈并用 `continue: true` 请求模型继续一步。没有附加内容的 `continue: true` 会被忽略，重复继续有次数上限。

示例：

```json
{
  "hooks": {
    "enabled": true,
    "timeoutMs": 60000,
    "maxOutputBytes": 32768,
    "events": {
      "SessionStart": [
        {
          "matcher": "startup|resume",
          "hooks": [
            {
              "type": "process",
              "command": "node",
              "args": ["./scripts/session-start-hook.mjs"]
            }
          ]
        }
      ],
      "PreToolUse": [
        {
          "matcher": "^(Bash|Write|Edit)$",
          "hooks": [
            {
              "type": "process",
              "command": "node",
              "args": ["./scripts/pre-tool-hook.mjs"],
              "timeoutMs": 5000
            }
          ]
        }
      ],
      "Stop": [
        {
          "hooks": [
            {
              "type": "process",
              "command": "node",
              "args": ["./scripts/stop-hook.mjs"]
            }
          ]
        }
      ]
    }
  }
}
```

配置字段：

- `modelStream.idleTimeoutMs`：模型 SSE 事件之间的初始空闲超时，默认 `600000`。
- `hooks.enabled`：是否执行已配置的 Hook，默认 `false`。
- `hooks.timeoutMs`：每个 Hook 进程的默认超时，默认 `60000`。
- `hooks.maxOutputBytes`：Hook 标准输出与错误输出的捕获上限，默认 `32768`。
- `hooks.events.<EventName>`：匹配组数组，按配置顺序执行。
- `matcher`：可选的 JavaScript 正则表达式字符串，省略时匹配该事件的所有输入。
- `hooks`：匹配组中的进程 Hook 列表，按顺序执行。
- `type`：目前仅支持 `process`。
- `command`：可执行程序，使用 argv 调用而非 shell 字符串。
- `args`：可选 argv 数组。
- `timeoutMs`：可选的单个 Hook 超时覆盖。
- `statusMessage`：为后续 UI 展示预留的可选状态标签。

每个进程 Hook 从标准输入接收一个 JSON 输入，可向标准输出写入一个 JSON 对象。空输出视为无操作。非 JSON 输出、结构不合法的输出、超时及除 `2` 之外的非零退出码，会记录为 Hook 失败，默认不终止回合。退出码 `2` 视为明确阻止或拒绝。

常见标准输出示例：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Use the internal API migration checklist for this repository."
  }
}
```

```json
{
  "continue": false,
  "reason": "Do not run destructive shell commands in this workspace.",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Blocked by project hook."
  }
}
```

```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "additionalContext": "Before finalizing, verify that the answer mentions test coverage."
  }
}
```

## 打包

在仓库根目录执行：

```sh
pnpm --filter @mycode/cli... build
pnpm --dir apps/mycode-cli sea
pnpm --dir apps/mycode-cli sea -- --target linux-x64 --target win-x64
pnpm --dir apps/mycode-cli sea -- --all
```

SEA 将 Node CLI 打包为独立可执行文件。目标 Node.js 二进制来自与当前 `process.versions.node` 对应的 Node.js 官方发行版，并用 `SHASUMS256.txt` 校验。无法运行 SEA 产物的环境仍可使用常规 Node CLI 产物。
