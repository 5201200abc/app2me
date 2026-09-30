# 内置浏览器 evaluate 生命周期

## 问题与证据

- 2026-09-27 的真实 `deepseek-flash` 会话中，页面评估返回一个 Promise，`requestAnimationFrame` 回调里的拼写错误使回调抛错，但没有 reject 该 Promise。
- 工具最终报告 `browser 命令 playwright 超时（32000ms）`，随后 Main 日志仍报告 CDP `pending=1`。
- `evaluateWithCdp` 只把预算传给 `Runtime.evaluate`，取消时调用全页 `Runtime.terminateExecution`。这个路径没有显式结算已经返回、但仍未完成的异步 Promise。

## 产品规则与所有者

- 保留 `normalizePlaywrightTimeout` 的现有预算，不通过延长 Host 或 MCP 超时处理挂起。
- 单次 evaluate 调用拥有自己的页面端完成/拒绝句柄、计时器、取消监听和 CDP object group。
- 到期或取消只结算本次调用的等待，不能终止同一页面中其他调用，也不能把已发生的页面副作用描述为撤销。
- 页面函数正常返回、抛错、返回已完成或被拒绝的 Promise 时，保留现有返回值与错误语义。
- 页面回调抛错但未拒绝 Promise 时，按本次 evaluate 预算返回 timeout；释放等待和 remote object 后，后续调用仍可执行。
- 不新增持久状态，不修改 owner/lease、workspace identity 或协议；Desktop 和手机恢复链路复用同一 Main 执行边界。

```text
MCP / Host -> Main evaluate call -> request-owned remote handle
                                   | value / rejection / deadline / abort
                                   v
                            settle this call's promise
                                   v
                          release remote object group
                                   v
                         existing result / event path
```

## 验收

1. 普通值和异步值返回正确，结束后没有 remote object 或 CDP 等待残留。
2. 同步抛错和异步拒绝保留实际错误，随后正常调用成功。
3. 永不完成的 Promise 在既有预算内失败，不等 Host 兜底，pending 归零。
4. 已取消请求不下发；执行期间取消能结束等待并清理句柄。
5. 取消其中一个并发 evaluate 不影响另一个，不调用全页 terminateExecution。
6. 模拟页面回调抛错且 Promise 未拒绝，验证有界失败、清理与后续调用恢复。
7. 通过 MyCode 内置浏览器的真实 MCP 调用验证成功、超时、恢复；单元测试不能替代此项。
