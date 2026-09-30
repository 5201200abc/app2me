# 3.14.3 同步与真实模型验收

- 目标提交为 29628c9acdb81b703bbd4080c207a0e7ce5e276e。283 个变更文件按品牌路径映射逐一核对；已有本地修改使用三方合并，不覆盖模型目录策略、固定 Logo 动画与界面定制。
- 全部真实模型请求使用 deepseek-flash，reasoningLevel=disabled；在实际 HTTP 请求与响应中验证，无模型替身。
- 自动化必须经过真实 Host admission、任务创建、模型产出及完成状态；记忆必须由 turn 完成后的自动提取写入；子智能体必须有独立子会话与真实子模型响应。
- CLI max-lines 保持现有 400 行规则，不通过提高阈值、禁用规则或压缩排版绕过。抽取模块后检查公开类型和运行行为。
- `.artifacts/` 是本机验证日志、旧源码备份和对照执行副本，排除 Git 与根 lint 扫描。当前产品源码仍由根及 CLI 各包原规则独立检查；不得以该目录存放生产实现或掩盖源码错误。
- 上游同步后仍保留 mycode 品牌：退出弹窗与请求来源 X-Title 均使用 MyCode；带空格的旧品牌也纳入扫描。许可证与上游仓库归属不作品牌替换。
- 恢复可访问的公开上游，保护原分支与未提交文件；freshness 必须实际 fetch，不使用 no-fetch 或虚构远端引用。
- 通过类型、Lint、构建与针对性回归检查；记录全部失败和逐文件同步决定。

## 文件拆分的边界

- 状态仍由原运行时或适配器实例持有。模块级可变绑定与其写入函数位于同一模块，不能新增镜像状态。
- 顶层函数、类型和常量按依赖方向移动；原公开入口保留导出。声明合并、重载、初始化依赖和副作用顺序必须保持。
- 事件投影处理按会话、目标、队列、工具与权限分组；事件类型、处理函数体和应用顺序保持不变。
- 数据库迁移按原 ID 提取；SQL 字符串、版本号、ID 及数组执行顺序必须逐项完全相同。这次不修改数据库结构。
- 大接口按已有能力分组继承；不改变任何成员类型、可选性或可见性。
- SQLite 会话存储的基础类持有唯一连接、路径和故障注入状态；原公开类继承辅助存储端口。分叉及共享上下文事务按职责提取，保留首个写入守卫、每个 await、commit/rollback 和故障注入的顺序；转发方法直接返回事务 Promise。
- 遥测的唯一 writer 集合、容量门限和释放由注册器持有；模型调用/重试工厂复用该注册器，保留父子 trace。审核命令仍由控制器队列串行执行，快照、策略校验和落盘后终态顺序不变。
- 模型请求组装、失败恢复、成功持久化及工具结果闭合分别提取。可变 turn 状态仍归原运行时所有；失败处理中最新流快照与请求 ID 保持读取时求值。取消时先提交同批 sibling tool results，再传播 checkpoint 取消。
- 后台通知的领取、发送失败释放和被修订替代的 run 抑制语义不变；新建和恢复工作流共用原生命周期端口。通过失败路径回归、移动函数体核对和重新构建后的真实模型请求验证。
- Turn 入口继续拥有本轮状态、目标 heartbeat 和最终资源释放。输入上下文准备、loop state 初始化、阶段计时及成功/失败结果按职责提取；被提取的异步成功收尾必须在原 try 中 await，不能绕过原失败处理。失败中目标引用更新须立即回写，保持 heartbeat 的观察结果。
- 压缩入口保留外层重试、取消与终态；每次摘要尝试从原始选区初始化，摘要生成和持久化均在原 try 内 await。内层超长输入与媒体降级，以及 ModelComplete、摘要写入、边界事件、历史替换的顺序保持不变。
- 会话发布器保留唯一 projection、保留日志与 floorSeq；只读 wire codec 从 getter 读取当前 projection。订阅交付对象独占订阅映射、帧序号和缓冲区，发布器通过 buffer/reset 方法推进它。订阅替换与 same-sub 恢复保留 reservation 身份校验、成功提交和失败回滚；重放候选完全成功后才替换权威投影并作废旧预留帧。
- 协议服务器保留请求租约、资源关闭和 post-response outbox。客户端反向请求对象独占 sink、断连错误、pending 请求及重播计时器；取消操作对象独占插件和工作区模型请求的 AbortController。分发函数只路由，保留每个方法分支、await 和 ACK 后出帧顺序。断连先拒绝全部 pending，再等待运行时关闭；关闭时保持取消顺序。
- 应用启动入口保留资源拥有关系和总失败清理；平台端口、恢复准备、工作流服务和公开能力接口分别装配。恢复对象独占 resumePrepared 与首次 shell Promise，所有用户执行入口共用该边界。附件优先读持久化不可变副本，远端文件仍通过 FileSystemPort；可选工作流能力继续成组出现。工作流 child 通过 getRuntime 与父会话同一 modelFactory 取当前选择，不能冻结一份副本。
- MCP 的内部状态基础类独占连接 records、generation、认证诊断、请求 ID 缓存与凭据存储；原入口仍只返回 McpPort。建连、关闭、工具调用、OAuth 恢复、官方认证和 transport 按职责提取为共享同一实例的函数。内部转发直接返回函数结果，不增加 async 包装；保留调用者 deadline 与共享 OAuth 事务的独立寿命、旧 generation 不能覆盖新连接、进程树先于 SDK close 清理的顺序。
- 流式模型入口继续拥有 retry loop、生成器 yield 和请求历史；准入、完成、失败重试及 finally 清理按阶段提取。每次 attempt 的终态标志与 statusContext 由一个 outcome 对象持有，各阶段在调用时读取最新上下文。失败阶段返回预算偏移，原 finally 仍在下一次请求前执行；签名修复不占普通预算，off-peak 排队不消耗次数。消费者提前关闭必须进入原 cleanup，不能让辅助生成器吞掉取消或继续发请求。
- V4 桥接按输入账本、行操作、会话分叉、会话索引、冷恢复、附件/工作流读取拆分为原 host 契约的 Pick 能力。会话注册表和持久命令索引仍只有原实例；自动消费对象独占重试计时器，并通过 getter 读取构造完成后的 executor。命令先检查子会话只读守卫，再写输入账本；共享上下文预留失败必须结算失败；冷恢复沿用 backing record，但读取所请求子会话的事件。分叉事务、关闭时先撤销投影后删除注册表、目标完成后的异步重评顺序不变。
- 自动消费依赖的 queue promotion 错误类放入无副作用的叶模块，原 handler 保留重导出，确保错误实例身份不变。直接导入自动消费模块不得触发 handler → executor → handler registry 的初始化循环；单模块加载和服务器入口均须验证。
- ProductProjection 的公开类保留原方法及类型，内部组合一个独占 snapshot、索引和 hydration 状态的 projection engine。事件处理按会话、turn、流、工具、权限、队列、子会话、压缩和目标拆分，方法仍通过同一 engine 的 this 调用；模块只以类型依赖 engine，避免处理器之间的运行时循环。装配时保留原类方法的非枚举属性。原子候选用当前 engine 原型创建，逐项复制原有状态；accept 拒绝不得泄漏 snapshot 或侧表变化，成功后才 adopt。不得把私有状态新增到 ProductProjection 公开接口。验证移动方法体、公开类型、旧实现与新实现的事件回放结果及发布器恢复边界。
- ConversationV4Gateway 同样保留公开入口，由单一内部 engine 拥有 publisher、raw sequence、READY/hydration promise、inbox、reservation 和附件缓存。按连接投递、事件入站、提交等待、索引、订阅、查询、命令、恢复和关闭分组；构造字段初始化、计时器与 host 回调顺序不变。公开方法直接返回 engine 的 Promise，避免额外异步包装。冷恢复仍在同一 buffer 合并 await 期间的原始事件，关闭先拒绝 waiter 并取消恢复，再回收状态；ACK 前的 control reservation 不得被 online flush 提前投递。两种 delivery profile、并发恢复、命令幂等与清理失败边界须复测。

```text
V4 command → gateway admission → bridge input ledger → existing executor/runtime
                               └→ shared-context reservation / terminal settlement
runtime idle → one auto-drain timer owner → current executor → same queue head
desktop continuous / mobile replayable → same gateway projection and sequence owner
```
