// ============================================================
// Bash Tool Handler
// ============================================================

import {
  BashInputJsonSchema,
  BashInputSchema,
  BashOutputJsonSchema,
  BashOutputSchema,
  CoreErrorType,
  createCoreError,
  type BashInput,
  type BashOutput,
} from "@mycode/contracts";
import { DEFAULT_BASH_TIMEOUT_POLICY, type BashTimeoutPolicy } from "../bash-timeout-policy.js";
import type { ToolEntry, ToolExecutionContext, ToolHandler } from "../types.js";
import { supportsBashBackgroundLifecycle } from "./bash-background-lifecycle.js";
import { isBashAutoBackgroundEligible } from "./bash-background-policy.js";
import { resolveBashPermissionRulePolicy } from "./bash-command-permission-policy.js";
import { decideBashCwdPolicy } from "./bash-cwd-policy.js";
import { formatBashModelContent, formatPersistedBashModelContent } from "./bash-model-content.js";
import { toBashOutput, type BashProgressTiming } from "./bash-output.js";
import { createBashProviderDescription } from "./bash-prompt.js";
import { applyBashReadFileStateEffects } from "./bash-read-file-state.js";
import {
  startBashCommandTelemetry,
  emptyBashOutput,
  createExecutionRequest,
  createExecutionRunOptions,
  finishBashCommandTelemetry,
  toBackgroundedBashOutput,
  BASH_PROVIDER_DESCRIPTION,
  resolveBashPermissionCapability,
  MAX_INLINE_OUTPUT_BYTES,
} from "./bash-max-inline-output-bytes.js";
import {
  createBashTimeoutBudgetResolver,
  createBashInputJsonSchema,
} from "./bash-create-bash-timeout-budget-resolver.js";

export {
  getBashActivityDescription,
  getBashAutoClassifierInput,
  getBashDescription,
  getBashToolUseSummary,
  getBashUserFacingName,
} from "./bash-metadata.js";

const bashHandler: ToolHandler = (input, context) =>
  executeBashHandler(input, context, DEFAULT_BASH_TIMEOUT_POLICY);

function createBashHandler(timeoutPolicy: BashTimeoutPolicy): ToolHandler {
  return (input, context) => executeBashHandler(input, context, timeoutPolicy);
}

async function executeBashHandler(
  input: unknown,
  context: ToolExecutionContext,
  timeoutPolicy: BashTimeoutPolicy,
): Promise<BashOutput> {
  const parsed = BashInputSchema.parse(input) as BashInput;
  const executionPort = context.executionPort;

  if (!executionPort) {
    throw createCoreError(
      CoreErrorType.ConfigurationError,
      "ExecutionPort is not configured for Bash tool",
      {
        context: {
          toolCallId: context.toolCallId,
          toolName: "Bash",
        },
        recoverable: false,
      },
    );
  }

  if (parsed.command.trim().length === 0) {
    const commandTelemetry = startBashCommandTelemetry(parsed, context);
    commandTelemetry?.finishCompleted();
    return emptyBashOutput(parsed);
  }

  const request = createExecutionRequest(parsed, context, timeoutPolicy);
  const progressTiming: BashProgressTiming = {};
  const commandTelemetry = startBashCommandTelemetry(parsed, context);
  const runOptions = createExecutionRunOptions(context, progressTiming, commandTelemetry);
  // 后台命令完成后 runTaskNotificationBatch 会另起一轮通知 turn，该 turn 不带
  // turnExecutionModel，闲时 turn 结束/失败后就会落到用户自己的套餐上跑完整 agent loop。
  // 与 subagent runner 的 BACKGROUND_UNAVAILABLE 对称：闲时 turn 拒绝显式后台，也关闭超时自动转后台。
  const backgroundDisabled = context.offPeakTurn === true;
  if (parsed.run_in_background && backgroundDisabled) {
    throw createCoreError(
      CoreErrorType.ToolExecutionFailed,
      "Idle-time tasks do not support background commands. Run this command in the foreground without run_in_background.",
      {
        context: {
          toolCallId: context.toolCallId,
          toolName: "Bash",
        },
        recoverable: true,
      },
    );
  }
  const eligibleForAutoBackground = !backgroundDisabled && isBashAutoBackgroundEligible(parsed);
  const backgroundLifecyclePort = supportsBashBackgroundLifecycle(executionPort)
    ? executionPort
    : undefined;

  if (parsed.run_in_background && !backgroundLifecyclePort) {
    throw createCoreError(
      CoreErrorType.ConfigurationError,
      "ExecutionPort does not support the Bash background lifecycle",
      {
        context: {
          toolCallId: context.toolCallId,
          toolName: "Bash",
        },
        recoverable: false,
      },
    );
  }

  const runCommand = async () =>
    parsed.run_in_background && backgroundLifecyclePort
      ? backgroundLifecyclePort.runBashWithBackgroundLifecycle(
          request,
          { mode: "explicit" },
          runOptions,
        )
      : eligibleForAutoBackground && backgroundLifecyclePort
        ? backgroundLifecyclePort.runBashWithBackgroundLifecycle(
            request,
            { mode: "auto_on_timeout" },
            runOptions,
          )
        : {
            kind: "foreground" as const,
            result: await executionPort.run(request, runOptions),
          };
  const runResult = commandTelemetry
    ? await commandTelemetry.run(async () => {
        const observed = await runCommand();
        if (observed.kind === "backgrounded") {
          commandTelemetry.finishBackgrounded();
        } else {
          finishBashCommandTelemetry(commandTelemetry, observed.result);
        }
        return observed;
      })
    : await runCommand();

  if (runResult.kind === "backgrounded") {
    return toBackgroundedBashOutput(runResult.task, parsed);
  }

  const result = runResult.result;
  const cwdDecision = decideBashCwdPolicy({
    status: result.status,
    exitCode: result.exitCode,
    resolvedCwd: result.resolvedCwd,
    workspaceRoot: context.workspaceRoot,
    runtimeScope: context.runtimeScope,
  });
  if (cwdDecision.nextWorkingDirectory) {
    // 主线程 Bash 成功后会保留项目内 cwd；
    // 离开项目边界时 reset 回原始工作区，并把 reset 文案放进 Bash stderr。
    await context.setWorkingDirectory?.(cwdDecision.nextWorkingDirectory);
  }
  const output = await toBashOutput(result, parsed, context, {
    progressTiming,
    stderrSuffix: cwdDecision.stderrSuffix,
  });
  await applyBashReadFileStateEffects({
    command: parsed.command,
    context,
    output,
    result,
  });
  return output;
}

export const bashToolEntry: ToolEntry = {
  capability: "Execute platform shell commands through the execution adapter",
  metadata: {
    name: "Bash",
    description: BASH_PROVIDER_DESCRIPTION,
    readOnly: false,
    destructive: false,
    concurrentSafe: false,
    timeoutMs: DEFAULT_BASH_TIMEOUT_POLICY.defaultTimeoutMs,
    maxOutputBytes: 10_000_000,
    sideEffectScope: "system",
    riskLevel: "high",
    needsApproval: true,
  },
  formatModelContent: formatBashModelContent,
  formatPersistedModelContent: formatPersistedBashModelContent,
  handler: bashHandler,
  resolveTimeoutBudgetMs: createBashTimeoutBudgetResolver(DEFAULT_BASH_TIMEOUT_POLICY),
  resolvePermissionCapability: resolveBashPermissionCapability,
  resolvePermissionRulePolicy: resolveBashPermissionRulePolicy,
  inputSchema: BashInputJsonSchema,
  outputSchema: BashOutputJsonSchema,
  runtimeInputSchema: BashInputSchema,
  runtimeOutputSchema: BashOutputSchema,
  permission: {
    permission: "bash",
    reason: "Bash can run subprocesses and may affect workspace, git, network, or system state",
    riskLevel: "high",
    sideEffectScope: "system",
    needsApproval: true,
    patternSources: ["command"],
    alwaysAllowPatternSources: ["command"],
    denyPriority: "beforeAsk",
  },
  resultBudget: {
    maxInlineBytes: MAX_INLINE_OUTPUT_BYTES,
    maxModelBytes: 30_000,
    strategy: "artifact",
    preview: {
      maxBytes: 30_000,
      direction: "tail",
    },
    artifact: {
      enabled: true,
      retention: "session",
    },
  },
  timeout: {
    defaultMs: DEFAULT_BASH_TIMEOUT_POLICY.defaultTimeoutMs,
    maxMs: DEFAULT_BASH_TIMEOUT_POLICY.maxTimeoutMs,
    allowCallOverride: true,
    cleanupGraceMs: 6_000,
  },
  cancellation: {
    supported: true,
    cleanup: "bestEffort",
    userVisibleMessage: "Bash was cancelled and the child process was asked to stop",
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
};

export function createBashToolEntry(
  options: {
    bashTimeoutPolicy?: BashTimeoutPolicy;
    embeddedSearchEnabled?: boolean;
  } = {},
): ToolEntry {
  const timeoutPolicy = options.bashTimeoutPolicy ?? DEFAULT_BASH_TIMEOUT_POLICY;
  return {
    ...bashToolEntry,
    handler: createBashHandler(timeoutPolicy),
    inputSchema: createBashInputJsonSchema(timeoutPolicy),
    resolveTimeoutBudgetMs: createBashTimeoutBudgetResolver(timeoutPolicy),
    metadata: {
      ...bashToolEntry.metadata,
      description: createBashProviderDescription({
        defaultTimeoutMs: timeoutPolicy.defaultTimeoutMs,
        embeddedSearchEnabled: options.embeddedSearchEnabled,
        maxTimeoutMs: timeoutPolicy.maxTimeoutMs,
      }),
      timeoutMs: timeoutPolicy.defaultTimeoutMs,
    },
    timeout: {
      defaultMs: timeoutPolicy.defaultTimeoutMs,
      maxMs: timeoutPolicy.maxTimeoutMs,
      allowCallOverride: true,
      cleanupGraceMs: 6_000,
    },
  };
}
