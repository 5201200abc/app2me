# 500K 上下文窗口：执行与复核记录

## 结果

MyCode 源码中的默认上下文窗口已改为 500,000 tokens。内置通用配置、本地模型目录、压缩默认值和空会话默认值一致；模型显式覆盖与历史事件继续有效。真实推理服务是否能承载 500K 尚未验证，不能由客户端配置推导。

## 执行步骤与依据

1. **确认范围**：用户明确选择“MyCode 项目中的上下文窗口”。因此不修改 Codex 个人配置。
2. **检查工作基线**：`rtk proxy node scripts/check-workspace-freshness.mjs` 返回 main 与 origin/main 同步。`node --version` 为 v24.14.0，与 `mise.toml` 一致。Git 工作区已有大量修改；对本次五个既有目标文件保存了修改前副本，最终逐文件比较，未恢复或覆盖无关修改。
3. **确认架构约束**：阅读根/CLI AGENTS 与 architecture-governance 技能；修改前后 `pnpm architecture:check --changed` 均为 violations 0 / baseline 0 / new 0。读取 provider-node、shared、mycode-cli 的 architecture:context；这些模块当前为 unmanaged，未发现 module.ts，因此不能将检查通过解释为完整的受管模块契约证明。没有新增跨包依赖，常量通过既有 `@mycode/shared/model-config` 公开入口导入。
4. **定位限制**：`config/provider/mycode-builtin.json` 通用规则和 `packages/provider-node/src/local-model-catalog.ts` 原来均为 32,768；`core/src/compact/policy.ts` 和 `contracts/src/events/event-reducer-helpers.ts` 原来为 200,000。这由实际源码及修改前副本确认，不是从 UI 数字猜测。
5. **追踪消费链**：阅读 Provider release 选择/物化、模型 resolver、bootstrap 的 provider-registry-selection、Runtime 的 compact-auto-compact-if-needed、V4 的模型/会话投影，以及 UI 的 V4ComposerToolbar 和 tokenNumberFormat。Runtime 消费模型 properties.contextWindow；工具条消费 snapshot.usage.contextWindow.maxTokens。无需新增 UI 状态或修改协议。
6. **先定义 spec**：先写入 `specs/context-window-500k.md`，定义 500K 的单位、默认与显式配置的优先级、窗口所有者、事件路径、缓存迁移及验收条件。
7. **先写回归测试**：新增 provider-node 的 contextWindow.test.ts 和 harness 的 mycode-context-window.test.mjs。修改实现前，测试实际复现 200000 != 500000、32768 != 500000、32768 != 64000。测试夹具最初缺少 ModelSelected.modelSelection 和 hydration begin/complete 调用，依据实际接口补齐；这些是测试夹具问题，不归为产品缺陷。
8. **修改实现**：内置窗口改为 500,000，revision 4→5；移除本地目录对窗口的硬编码覆盖；shared 导出 DEFAULT_MODEL_CONTEXT_WINDOW，Core 与 Contracts 引用同一默认值。保留既有输出上限、压缩缓冲和历史显式窗口。新增中文注释解释原来的限制原因。
9. **运行相关验证**：下表列出实际命令和结果。回归覆盖新旧窗口阈值、缓存迁移、配置继承、输出预留、实时/冷回放和容量标签。
10. **检查交付入口**：读取 Desktop 的 desktopProviderConfig.ts、electron-builder.config.js，CLI 的 provider-runtime-env.ts、sea-provider-config-assets.mjs，Server 的 bundledMyCodeBuiltinProviderConfig.ts、tsup.config.ts，以及 scripts/builtin-provider-config.mjs。实际调用 loadBuiltinProviderConfig，确认选中仓库 config/provider/mycode-builtin.json、revision 5、窗口 500,000；调用 stageBuiltinProviderConfig 写入临时目录并比对内容完全一致，随后删除临时目录。未执行完整应用打包或部署。
11. **回头复核**：将五个既有实现/配置文件与修改前副本逐项对比，确认实现仅增加 10 行、删除 6 行；另新增两个测试和两份文档。根/CLI 两套格式检查通过，显式目标 lint 无警告/错误；重新检索窗口定义，确认本地目录不再覆盖 32K。

## 验证结果

为防止摘要误判，最终结果以原始工具退出码和日志为依据。最初 rtk 对根 typecheck 的自动改写只运行了 tsc 帮助；改用 rtk proxy 保留完整命令后成功。condense 曾把成功的 27 个任务摘要成“27 diagnostics”，也把 lint 警告摘要成失败；已复核原始输出并纠正，未将摘要当作失败事实。

| 验证                                                                                                                                                                                                                                                                                                                                 | 实际结果                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `rtk proxy pnpm exec tsx --test packages/provider-node/test/contextWindow.test.ts packages/provider-node/test/localCatalogIntegration.test.ts packages/provider-node/test/localModels.test.ts packages/provider-node/test/catalogPolicy.test.ts harness/mycode-context-window.test.mjs harness/mycode-upstream-regressions.test.mjs` | 20 tests / 20 pass / 0 fail；含本次新增 5 项                                                    |
| `rtk proxy pnpm typecheck`                                                                                                                                                                                                                                                                                                           | 退出 0，无诊断；最后一次重新执行确认                                                            |
| `rtk proxy pnpm lint`                                                                                                                                                                                                                                                                                                                | 退出 0，63 warnings / 0 errors；并非零警告                                                      |
| `rtk proxy pnpm --dir apps/mycode-cli typecheck`                                                                                                                                                                                                                                                                                     | 退出 0，27 successful / 27 total，12 cached                                                     |
| `rtk proxy pnpm --dir apps/mycode-cli lint`                                                                                                                                                                                                                                                                                          | 退出 0，14 successful / 14 total；各包有警告，无 errors                                         |
| `rtk pnpm architecture:check --changed`                                                                                                                                                                                                                                                                                              | violations 0 / baseline 0 / new 0                                                               |
| 针对本次文件的 oxfmt --check（根目录与 CLI 分别运行）                                                                                                                                                                                                                                                                                | 根目录 6 文件、CLI 2 文件均通过；oxfmt 不支持 --no-ignore，首次该参数被拒绝后改为在对应目录运行 |
| 针对本次文件的 oxlint 与 git diff --check                                                                                                                                                                                                                                                                                            | 目标 lint 0 warnings / 0 errors；已跟踪修改无空白错误                                           |
| 构建配置加载与临时资源物化                                                                                                                                                                                                                                                                                                           | revision 5、500,000、资源内容完全一致                                                           |

CLI Turbo 还报告 browser-use-plugin 不在 lockfile 的警告；未因此失败，也未为本任务改动 lockfile。

## 验收复核与剩余边界

| 要求                 | 证据与结论                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 默认窗口 500K        | 配置与默认值一致性测试、本地/DeepSeek 模板解析测试通过                                                                  |
| 不能只修改显示数字   | Runtime 压缩阈值和配置解析测试通过；既有模型事件驱动 UI 数值                                                            |
| 旧缓存升级           | revision 4 / 32,768 Active 升到 revision 5 / 500,000，并验证重复读取稳定                                                |
| 显式较小窗口有效     | 64,000 继承及 42,808 压缩阈值测试通过                                                                                   |
| 不错误改写历史       | 历史 64,000 保留；旧 32,768 会话在新 ModelSelected 事件后更新为 500,000                                                 |
| 实时与恢复一致       | live applyEvent 和 begin/apply/completeHydrationReplay 的 contextWindow 完全一致；未进行实际手机网络 E2E                |
| 解释 500K 与自动压缩 | 500K 为总窗口；本地 8,192 输出上限下阈值 478,808，通用 16,384 下阈值 470,616，无显式输出上限时为 466,000                |
| 文件范围             | 实际读取限于规则、上下文配置/消费/发布链、相关测试与验证入口；缺少已有专题 spec 时创建新 spec，没有假设未打开的业务文件 |

仍可能影响实际使用的条件：

- **外部推理服务容量**：仓库检索未找到 llama-server 启动命令、ctx-size/n_ctx 配置。还需用户实际使用的 llama.cpp 启动脚本或服务定义文件，以及服务容量响应/启动日志，以核对每个 slot 的真实窗口。其路径未提供，不能指定一个虚构文件名或宣称已调整服务。
- **实际 500K 推理**：未发送 500K 的真实模型请求，因此没有证明 KV cache 内存、模型自身能力、质量或延迟。新测试使用 token 计数验证预算，不等同真实长请求。
- **已运行进程与已发布应用**：本次修改的是当前源码。Desktop/CLI/Server 的旧进程或旧打包资源需要重新加载/构建；未宣称已部署到这些实例。
- **更高优先级配置**：个人显式窗口、环境变量指定的替代配置和更高 revision 远端配置仍可覆盖默认值。构建 smoke 只确认本次环境实际选中的是仓库配置。
- **UI 与平台**：本次没有更改交互；覆盖了容量标签函数和协议投影，未做真实窗口截图、手机网络、Windows 或 Linux E2E。
