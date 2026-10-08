This is a TypeScript and Node.js coding Agent CLI for Windows, macOS, and Linux. Follow the [root AGENTS.md](../../AGENTS.md) for general rules; this file adds CLI-specific rules. Node.js and package-manager versions are defined in the repository root [mise.toml](../../mise.toml) and [package.json](../../package.json).

## Working Rules (Highest Priority)

- Add logs or interfaces alongside new capabilities so an agent can take over operations without human intervention.
- Prioritize long-running tasks. The core agent loop supports sustained complex work; do not impose a hard stop based on tool-call count. Resource and safety boundaries use explicit conditions such as automatic compaction at token/context limits, user cancellation, permission denial, tool timeouts, output truncation, and provider retry limits.
- Source files should not exceed 400 lines by default. If they do, split modules by high cohesion and low coupling rather than accumulating responsibilities in a large file.
- Extract strings and numbers with business meaning (timeouts, limits, protocol fields, error codes, etc.) into named constants for centralized maintenance. Exemptions: 0, 1, empty strings, log messages, and test data.
- Before changing database structure, pause and confirm the plan with the user, who may delegate to the module maintainer. The plan must address migrations, compatibility, and rollback.

## Tooling Rules

- Keep the default distribution path as a standard Node.js CLI bundle. Do not introduce other packaging or distribution forms.
- Project-owned environment variables use the `MYCODE_` prefix. Do not add them casually: first define their purpose, precedence, error behavior, and test coverage in the feature spec. Use configuration files, CLI arguments, or session configuration when these can express the capability.

## Cross-Platform Compatibility

Rules involving `fs`, `child_process`, and `process.env` apply only to the corresponding adapters. Business modules call those adapters; see “External I/O Boundaries.”

- Design all features for Windows, macOS, and Linux by default, rather than following only the current development machine's behavior.
- Prefer cross-platform Node.js APIs such as `path` and `url`. Use `fs` only within filesystem adapters. Do not hardcode path separators, absolute-path prefixes, line endings, or temporary-directory locations.
- Execute external commands in execution adapters using argument arrays with `child_process.spawn` / `execFile`. Avoid concatenated shell strings, POSIX-only syntax, pipes, redirection, and shell built-ins.
- Account for Windows `.cmd` / `.exe` files, paths with spaces, argument escaping, environment-variable case, and shell differences when invoking system commands, editors, shells, package managers, or executables.
- Filesystem logic must account for case sensitivity, permission models, symbolic links, executable bits, line endings, and path-length limits.
- Detect terminal capabilities instead of assuming fixed features. Provide fallbacks for colors, TTY, Unicode, interactive input, window sizing, and signals in noninteractive or limited environments.
- Resolve user, cache, configuration, temporary, and project directories through explicit cross-platform logic. Do not hardcode Unix-style directory layouts.
- Add or update tests for cross-platform differences when adding system interactions. Document remaining risks for behavior that cannot be verified on the current system.

## Module Boundaries and Interface Contracts

- Modules interact through explicit, limited, stable interfaces rather than coupling implementations. Each module must be independently understandable, testable, and replaceable, with strict types, interfaces, or schemas.
- Callers must not depend on another module's internals, directory structure, implicit global state, or undeclared conventions.
- Public contracts describe capabilities, inputs, outputs, errors, state changes, and side effects.
- Prefer runtime-validatable schemas when data crosses process, storage, network, plugin, tool-call, or LLM boundaries. TypeScript types alone are insufficient.
- Define interface contracts before implementing new interactions between modules.

## External I/O Boundaries

- All external side effects must support unified observation, approval, cancellation, retries, queuing, auditing, and testing. Business logic expresses intent rather than directly interacting with the outside world.
- Route all external I/O through explicit infrastructure layers or adapters, including network requests, filesystem reads/writes, subprocesses, environment variables, terminal I/O, caches, databases, system clipboard access, and external services.
- Outside entry points, infrastructure, and adapters, business modules must not directly call low-level I/O APIs such as `fetch`, `http`, `fs`, `child_process`, or `process.env`. Depend on project-defined interfaces, services, or adapters.
- Adapters expose stable types or schemas specifying inputs, outputs, error types, timeouts, cancellation, retry semantics, idempotency, and side-effect scope.
- Use a unified network-request entry point for timeouts, retries, backoff, authentication, proxies, custom certificates, rate limiting, logging, auditing, and error normalization.
- Use a unified filesystem entry point for atomic writes, concurrency, temporary files, queued writes, permission errors, path normalization, and cross-platform differences.
- Use a unified execution entry point for sandboxing, permission approval, environment variables, timeouts, cancellation, output truncation, streaming output, and exit-code normalization.
- Handle asynchronous execution, queuing, retries, degradation, and auditing at I/O boundaries, not throughout business logic.

## Tool and Side-Effect Contracts

- Every tool declares `inputSchema`, `outputSchema`, read-only/destructive/concurrency-safe status, maximum output size, timeouts, cancellation semantics, and permission requirements.
- Declare tool side-effect scope explicitly, such as `none`, `workspace`, `git`, `network`, or `system`. Permission, sandbox, and approval systems consume these declarations instead of guessing at call sites.
- Tools with side effects should declare idempotency and recovery strategies where possible, supporting future retries, rollback, queued execution, and failure recovery.
- Do not feed large tool results directly into model context. Save them to disk or artifact/storage and return summaries, previews, and traceable references.
- External extensions such as MCP, plugins, and subagents must pass through capability declarations, schema validation, namespace isolation, and permission boundaries. Do not expose internal module implementations directly.

## Sessions, Configuration, and Observability

- Treat sessions, messages, tool calls, permissions, checkpoints, queues, and pending state as first-class state objects, supporting recovery, forks, rollback, and concurrent sessions.
- TUI owns only input collection, layout rendering, and temporary interaction state, such as cursor position, input fields, scroll position, and current popup selection. Business state such as session, mode, model, tools, todos, permissions, and checkpoints must be owned by server/bootstrap/core/session and delivered through explicit interfaces or session events.
- Prioritize keyboard operation in TUI. All core actions must be accessible from the keyboard; mouse interaction is an enhancement.
- Use `+`/`-` for TUI collapse/expand indicators (`+` collapsed, `-` expanded), not `v` or `>`.
- Design confirmation, selection, input, progress, and error recovery as stable interaction request/response interfaces or session events for both TUI and MyCode Protocol clients (defined in `packages/shared/src/mycode-protocol/index.ts`). Clients provide presentation and transport adapters; do not hardcode interaction flows in one frontend.
- Every task carries a propagatable `traceId`, representing a complete top-level session task chain by default. Child sessions, subagents, retries, background queue tasks, and asynchronous I/O share that `traceId`.
- `traceId` sits above `sessionId`. `sessionId`, `turnId`, `messageId`, `toolCallId`, `spanId`, and `parentSpanId` are structured subordinate identifiers used to reconstruct the full call chain.
- All modules, services, adapters, tool runtimes, provider clients, I/O adapters, and permission checks receive and propagate a unified execution context. Do not drop, overwrite, or generate unrelated `traceId` values.
- Avoid introducing asynchronous tasks, tool calls, external I/O, cross-module calls, or child sessions that cannot be associated with a `traceId`; these are unobservable behavior.
- Access providers, models, MCP, storage, network proxies, and certificates through adapters. Do not hardcode vendors, transports, or deployment environments in session-core.
- Define configuration layers and precedence, such as system, user, project, session, CLI arguments, and environment variables. Security-related configuration must have traceable origins.
- Configuration discovery, reading, and precedence resolution must be compatible with the `.agents Protocol` and `AGENTS.md` conventions.
- Preserve debugging and observation entry points when adding capabilities, covering model requests, context composition, tokens/cost, tool calls, I/O, permissions, retries, queue backlogs, and discarded queue items.
- Logs, traces, and debug output must avoid leaking keys, tokens, private data, and complete user content. Highly sensitive information requires explicit use of a controlled debug path.

## Error-Handling Priorities

- Treat errors as first-class design objects. Consider failure paths, ownership, propagation, and user-facing messages before implementing new functionality.
- Let errors propagate to a layer capable of handling them. Do not swallow errors in low-level modules, merely log and continue, or prematurely convert errors into ordinary strings.
- Catch errors only when recovery, retries, degradation, additional context, actionable user messages, or the CLI entry boundary justify it.
- Preserve the original cause when throwing or wrapping errors, adding necessary context without losing the call chain or system error details.
- Expose error, waiting, retry, permission, model, tool, and I/O state up the call chain to CLI/TUI interfaces while protecting keys, privacy, and complete raw content.
- Low-level business modules must not call `process.exit`, print errors directly to the terminal, or determine the final exit code. The CLI entry layer formats errors, displays messages, and sets the exit code.
- Do not control execution based on error text. Use stable error types, codes, or structured fields when distinguishing errors.
- Test critical failures, especially missing configuration, insufficient permissions, network failures, filesystem errors, invalid user input, and failed external commands.

## Verification

- For CLI code changes, run `pnpm --dir apps/mycode-cli typecheck` and `pnpm --dir apps/mycode-cli lint` in addition to root checks.
