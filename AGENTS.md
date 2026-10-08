## Core Principles

- Before adding or changing existing behavior, update the relevant spec. Create its directory when needed; do not assume a fixed versioned design directory exists. Define product rules, state ownership, interfaces, and acceptance scenarios before implementation. Bug fixes that restore behavior already specified are exempt.
- Treat the checked-out source, `package.json`, and architecture policy as authoritative. Document only capabilities, commands, and files available in this repository. When removing features, also remove their references from instructions and skills.
- When investigating an issue, investigate the cause first unless code changes were explicitly requested. Combine source, logs, and runtime evidence, distinguishing confirmed causes from hypotheses that still need verification.
- Preserve unrelated local changes. Do not restore removed modules or internal dependencies on your own.

## Commands and Repository Structure

Use the Node version specified in `mise.toml`. Run these commands from the repository root:

| Purpose                         | Command                                               |
| ------------------------------- | ----------------------------------------------------- |
| Type checking                   | `pnpm typecheck`                                      |
| Lint                            | `pnpm lint` / `pnpm lint:fix`                         |
| Formatting check                | `pnpm fmt:check`                                      |
| Desktop development             | `pnpm dev:desktop`                                    |
| Web development                 | `pnpm dev:web`                                        |
| Pre-push checks                 | `pnpm verify:pre-push` (lint and architecture checks) |
| Architecture check              | `pnpm architecture:check --changed`                   |
| Module reading context          | `pnpm architecture:context <module-id>`               |
| Unused dependencies and exports | `pnpm knip`                                           |
| Export reference lookup         | `pnpm dep:refs --list-exports <file>`                 |

Use the target package's current `package.json` and actual test files to identify test entry points. Do not assume a shared unit-test or E2E command exists.

- `packages/desktop`: Electron main, host, and renderer.
- `packages/web`, `packages/server`: Web client and server.
- `packages/ui`: shared React components, hooks, and Zustand stores.
- `packages/services`: business services; `packages/rpc`: RPC framework.
- `packages/shared`: shared protocols and types; `packages/client`: Agent client SDK.
- `apps/mycode-cli`: Agent CLI and runtime.
- `CONTEXT.md`: plugin marketplace terminology; read before changing related UI.
- `DESIGN.md`: UI design guidelines; read before changing UI.

## Implementation and Verification

Verify in this order:

1. Before starting, run `node scripts/check-workspace-freshness.mjs` to check the baseline.
2. Before changing code, follow `.agents/skills/architecture-governance/SKILL.md`, run `pnpm architecture:check --changed`, and read the target module's controlled context.
3. Before finishing, run `pnpm typecheck` and `pnpm lint`.
4. Before committing, run `pnpm verify:pre-push`.

- Report actual results. Do not describe existing failures as passing checks.
- Avoid duplicate state and multiple write paths. Define a single owner, interfaces, dependency direction, event ordering, and idempotency boundaries. Do not hide synchronization problems behind timeouts.
- Add corresponding tests before behavior changes; interaction changes require E2E scenarios. Check that tests match the implementation and run the available verification. Report checks that were not run or were limited by the environment.
- When fixing bugs, explain the cause and evidence in Chinese comments. Discuss design defects with the user before proceeding; do not keep adding fallback branches.
- Use diagrams to show owners and event ordering for designs involving state, timing, remote execution, or asynchronous synchronization.
- Use asynchronous file and network I/O. Use public entry points for cross-package imports and respect existing path aliases.
- UI must not call repositories directly; services must not reference concrete runtime implementations. Avoid cross-domain implementation imports and circular dependencies.

## UI and Platform Boundaries

- Follow `DESIGN.md`, reuse existing components, and cover desktop and mobile Web layouts, interactions, themes, and internationalization.
- Components access services through `packages/ui/src/hooks/`. Route platform operations through `IPlatformService` (`packages/shared/src/platform.ts`), rather than calling `window.mycode` directly.
- Use dependency injection for differences between Desktop, Web, local, and remote environments, covering Windows, macOS, and Linux.
- Zustand state lives in `packages/ui/src/store/`. Prevent feedback loops for broadcast-synchronized fields such as theme and language. Do not treat UI-local state as server-side facts.
- Use `.tsx` for hook files containing JSX.

## Processes, Protocols, and Remote Control

- The Desktop app communicates with the Agent over stdio. Update `packages/shared/src/mycode-protocol/index.ts` alongside protocol changes, with strict types and runtime validation.
- Main owns windows, native operations, process scheduling, and message forwarding, not task/session business state.
- Each window uses one window-scoped Local Host, shared by local workspaces. A connection registry within the window manages remote workspaces; do not create a separate Desktop Remote Host.
- Mobile remote control connects to an existing desktop Host attachment and reuses its session runtime. Do not start separate Agents, Local Hosts, or remote sessions for mobile.
- Distinguish Desktop's `desktop-continuous` live stream from mobile's `web-remote-replayable` recovery stream. Verify both semantics when changing streams, snapshots, queues, or reconnection.
- External relays and Main handle only authentication, pairing, heartbeats, forwarding, and attachment scheduling. They do not store business state such as task queues or snapshots.
- The CLI/runtime `CommandInbox` serializes admission of accepted busy/running input. Renderer retains only unsubmitted drafts and pending optimistic overlays; Host owner/lease handles routing.
- Preserve owner/lease checks, cross-Host routing, and stale-run protection. Do not remove boundary checks based on a single execution path.

## Workspace Identity

- `workspaceIdentity` provides identity isolation; `workspacePath` is used for file operations, command cwd, Git, and path display.
- Use `workspaceIdentity?.trim() || workspacePath` as the identity key for deduplication, binding, caches, queues, persistence, and request correlation.
- Propagate `workspaceIdentity` and `remoteSessionId` throughout remote flows. Do not match solely by path.
- New interfaces retain a local-path fallback. Reuse existing builders and parsers for remote identity; do not handcraft its format in business code.

## Logging

- UI uses `packages/ui/src/logger.ts`, not direct `console.log` or `window.mycode?.log` calls.
- Agent/session/runtime service logs use `createServiceLogger(scope)` (`packages/services/src/logger/serviceLogger.ts`).
- Use `debug` for frequent diagnostics such as raw protocol data, streaming chunks, and individual tool updates. These are not written to disk in production.
- Use `info` for production events such as process and session lifecycles, permission results, and one-time initialization.
- Use `warn` for recoverable exceptions and `error` for unrecoverable failures such as crashes, handshake failures, or lost authentication.

## Open-Source Content and Sensitive Information

- Repository licensing and attribution are documented in the root [LICENSE](LICENSE), [NOTICE.md](NOTICE.md), and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Before introducing third-party code, documents, prompts, or assets, verify their source, license, and permitted use. Preserve copyright, attribution, and modification notices as required by applicable licenses. Do not remove applicable attribution during open-source cleanup.
- Documents, examples, test data, logs, and commit messages must not contain real credentials, private user data, internal service addresses, personal working directories, or material not authorized for public disclosure. Use fictional data and placeholders in examples.
- Before publishing, check the actual delivery scope. If Git history is included, check it too. Deleting or replacing current files does not clean historical records.

## Commit Guidelines

- Create a separate commit for each feature-level change, small enough for independent review.
- Do not mix unrelated features, refactors, dependency updates, and formatting changes in one commit.
- Commit all files for a single feature together.
- If a task requires multiple feature-level changes, split them into independent commits in review order.
