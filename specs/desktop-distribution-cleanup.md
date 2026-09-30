# 桌面发行包与临时产物清理

## 范围

- 仅清理可重新生成的临时文件与发行包内的非运行时内容；保留源码、依赖和现有未提交改动。
- 从当前工作树构建 MyCode 3.14.3：macOS arm64、macOS x64；按用户最新要求取消 Windows。
- 使用现有 `packages/desktop/scripts/bundle.mjs` 作为唯一组包入口，复用原生依赖裁剪、sourcemap 清理和依赖闭包检查。
- 平台产物分别输出到独立目录，最终安装包与 SHA-256 校验文件集中保存；未解包目录和调试清单不作为下载包。

## 保留规则

- 保留 LICENSE、第三方声明、目标平台原生库、Agent、内置插件和 SSH 远端资源。
- `mock-cdn` 的当前版本 manifest 所引用资源属于运行时必需内容；不能因体积大而直接删除。
- 不删除正在使用的构建目录、Node 依赖、应用数据或用户会话。
- 已有 Lint、Knip 错误单独报告，不据此扩大源码清理范围。

## 验收

- 类型检查、Lint 和架构检查实际执行并记录真实结果。
- 每个平台打包入口通过现有运行时依赖闭包检查和 500 MiB 体积检查。
- 下载包包含可安装产物与校验值；macOS 执行可用的本机启动验证。
- 本地未签名产物明确标注；打包或验证失败的产物不标记为已验收下载包。

## 本地构建记录

- 当前版本的 `mock-cdn` 资源已准备，发行组包复用现有 manifest 引用；删除旧版本 `3.14.0` 缓存。
- 生产构建实际完成，main / host / preload / scheduler 与 renderer 均由当前源码重新生成。
- 本机 Swift 工具链缺少 x86_64 兼容静态库。Intel 窗口辅助程序使用 macOS 12 目标、`-runtime-compatibility-version none -disable-autolinking-runtime-compatibility-concurrency` 编译，再与 arm64 合为 universal 产物；未修改辅助程序源码。
- CUA 的 macOS 发行资源本身是 universal，同一份已准备资源复用于两个 macOS 架构。
- 下载目录只保留 DMG、SHA-256 和安装说明；验证后删除重复 ZIP、未解包应用及构建调试清单。
- 类型检查与架构检查通过；原始 Lint 日志为 63 个警告、0 个错误，退出状态为 0。
- Apple Silicon 的 DMG 已完成完整性校验和镜像内应用的主界面启动验证。本机没有 Rosetta，Intel 包执行结构、架构、依赖闭包和镜像校验，不宣称完成 Intel 安装启动验证。
