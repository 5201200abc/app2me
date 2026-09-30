# Cua Driver 完成核验

## 结论

本机 macOS 的原生 Cua Driver 接入、内置浏览器超时恢复和开发启动入口已实施并重新验证。不能据此宣称 Windows、正式签名/ASAR 产物或完整 Agent UI 工作流已经通过验收。

## 中断现场

1. 重新读取引用对话 `01a0e353-3751-71a3-9a92-9baa9894673b`，确认范围为替换原生桌面引擎、保留内置浏览器。用户后续直接确认了 macOS 开发入口修正。
2. 搜索当前源码与文件，确认 Main owner、Host bridge、严格协议、权限入口、插件种子、下载及打包配置已存在。不是依据先前对话中的“已完成”声明。
3. 中断后的 `dev.mjs` 仍直接 spawn Electron，没有 LaunchServices 修改。旧 `/tmp` 验收日志已经不存在，不能作为当前执行证据。
4. 重跑当时已有的 16 个测试，全部通过；freshness 与架构检查通过。随后仅继续未落地的启动入口、复验和复查发现的相关遗漏。

## 实际步骤与依据

1. 更新 [产品与所有者规则](./cua-driver-integration.md)，再修改启动入口。Main 是 driver owner；开发脚本是启动 owner；Host 不持有第二份 daemon 状态。
2. 新增 `packages/desktop/dev-launch-entry.mjs` 与 `scripts/devElectronLaunch.mjs`。macOS 使用 `open -n -W` 启动开发 app；环境文件与 app 输出日志均为 0600，入口异步读取环境文件后立即删除。单测验证私有权限、参数中不包含环境凭据、含空格路径正确以及异常后的清理。实际发现日志默认 0644 后已修正；诊断日志分享前仍需脱敏。
3. 实机发现 Main 的 `process.title` 会覆盖启动参数，原命令行匹配清理方案不能成立。依据为 `packages/desktop/src/main/index.ts` 和 Main PID 的原始 `ps` 输出。改为私有 socket 握手绑定 PID；连接关闭撤销所有权，软停止请求 app.quit，强制停止只作用于仍持有连接的 PID。单测验证错误 launch id 被拒绝、早到停止请求、绑定 PID 和连接关闭后的无效信号。
4. 恢复 Main 的项目入口参数，避免深链接注册指向一次性 wrapper。开发日志的 `entry` 实际为 `packages/desktop/`，不是 `dev-launch-entry.mjs`。
5. 复查权限桥，删除把授权布尔值当作 AX 功能探针成功的字段。新增测试证明只读授权状态不伪造功能探针。保留同名用户 MCP 配置、禁用 gate 和远端隔离测试。
6. 使用实际 Electron、公开 Cua Driver SDK 和 MyCode MCP adapter 重跑原生验收。两项系统权限均为 true；58 个 MCP 工具；两个并发 connect 共享 generation；restart 后 generation 改变。
7. 原生 `list_windows` 按测试进程 PID 找到隔离窗口，`get_window_state` 返回 92 个 AX 元素及 1280x720 截图。像素采样含 58 种颜色；实际打开截图确认内容为测试窗口和 Pause 按钮，不是用户窗口。没有把轻量桌面列表误当作截图/AX 功能验收。
8. 实际 CDP 验证未完成 Promise 在 3006ms 返回；后续同步值、Promise.resolve、DOM 点击均成功；pending 为 0。原生 daemon 的两次退出日志明确记录 lifetime pipe 关闭并 shutdown；退出后原始进程查询没有残留 daemon。
9. 实际启动完整开发 app，Main/Host/Preload/Scheduler 四个构建成功，renderer 加载成功。停止开发后 Main PID 12480 和 Host PID 13029 均不存在；原始进程查询没有对应开发入口或 utility 子进程。测试后重新启动开发 app 供用户使用。
10. 最终重跑 19 个针对性测试：19 通过、0 失败。`pnpm typecheck` 实际退出 0；`pnpm lint` 为 63 warnings、0 errors；架构检查为 baseline 0 / new 0；修改文件格式检查通过。

## 当前证据

原始输出存放于忽略的本地 runtime 目录，不写入测试源码或提交：

- `.mycode-runtime/cua-driver-tests-final.log`：19 项测试及计数。
- `.mycode-runtime/cua-driver-typecheck-final.log`：根目录 typecheck；修复测试类型收窄后又直接执行一次，退出 0。
- `.mycode-runtime/cua-driver-lint-final.log`：63 warnings / 0 errors。
- `.mycode-runtime/cua-driver-native-final.log`：本次 JSON 结果、两项权限、并发代际、AX/截图、58 个工具、restart、exitCode 0。
- `.mycode-runtime/cua-driver-native-final-error.log`：实际 daemon socket 与 lifetime shutdown。
- `.mycode-runtime/cua-driver-fixture.png`：仅包含隔离测试窗口的原生截图。
- `.mycode-runtime/cua-driver-dev-final.log` 及该日志标出的 app output：完整开发启动、构建和 renderer 证据。
- `.mycode-runtime/cua-driver-dev-open.log`：测试完成后重新打开开发应用的日志。

## 未覆盖与风险

- 额外执行 `tsc --noEmit -p packages/desktop/tsconfig.main.json`，仍有 86 条诊断。日志在 `.mycode-runtime/cua-driver-main-types-current.log`；没有诊断落在新增 Cua Driver/Main 权限文件中。没有证明这些全部是历史失败，因此不称其为“已知基线”，也不把 Main 类型检查写成通过。
- `tsconfig.json` 的 files 为空，仅列 project references；对它执行普通 noEmit 不能证明 Main 类型正确。根目录 typecheck 也不覆盖全部 Main 文件。
- Windows CLI 的 release 资产名称已通过 [官方 0.30.4 release](https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.30.4) 元数据核对；本机 CLI 实际返回 `cua-driver 0.30.4`。Windows 机器、正式打包/签名和 ASAR 运行未验证，不能由 macOS dev 验收推导。
- 完整开发日志还出现 `renderer-action-trace config is invalid` 和 `Unknown channel: off-peak-task`。它们不是本次 CUA 验收通过的证据，也没有在本任务中调查或修复。
- 没有新跑完整 LLM/Agent UI 投递、手机重连或跨 Host 场景；本次覆盖严格协议、远端拒绝、MCP 注入和真实本机 native/browser 执行。原有 owner/lease、CommandInbox 和 replay/continuous 代码未因本次启动修改而重写。
- 插件保持显式启停。Host 从插件服务读取 enabled；禁用时不会启动本机 driver。没有为让测试通过而改写用户插件配置。

## 回头检查

- 不使用旧日志、记忆、`open` 的退出码或过滤后的进程列表单独证明完成。原生结果由实际 MCP 断言和 JSON exitCode 0 证明，清理由原始 PID/进程查询证明。
- 修复了实机才暴露的 process.title 清理失效与深链接入口问题；补齐了截图/AX 强验收和只读权限不冒充功能探针的测试。
- 保留所有无关本地修改。新增启动入口、辅助模块及测试共 260 行；`dev.mjs` 相对 Git 为 +30/-8，其中包含已有 MyCode 命名迁移，不将该整份差异归因于本次工作。
- 未覆盖项目已逐项标明；没有把根目录 typecheck 通过扩展成“全仓全部检查通过”。
