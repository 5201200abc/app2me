import { useCallback, useRef, useState } from "react";
import type { IServiceAccessor } from "@mycode/services";
import type { MyCodeProvider } from "@mycode/shared";
import { toast } from "@/components/ui/toast.js";
import {
  buildWorkspaceSessionReloadDraftError,
  shouldDebounceWorkspaceSessionReload,
} from "@/lib/workspaceSessionReloadPlan.js";
import { resolveWorkspaceModelConfigSyncScope } from "@/lib/modelConfigSync.js";
import { prepareWorkspaceWithMyCodeSessionService } from "@/hooks/useWorkspacePrepare.js";
import { logger } from "@/logger.js";
import { useMyCodeSessionStore } from "@/store/mycodeSessionStore.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";

export function useWorkspaceSessionReload({
  intl,
  services,
  workspaceAbsPath,
  reloadSessionDisabled,
}: {
  intl: { formatMessage: (descriptor: { id: string }) => string };
  services: IServiceAccessor;
  workspaceAbsPath: string;
  reloadSessionDisabled: boolean;
}) {
  const [reloadSessionPending, setReloadSessionPending] = useState(false);
  const workspaceIdentity = useTabStore((state) => {
    if (!state.activeTabId) {
      return undefined;
    }

    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    if (!activeTab || !isWorkspaceTab(activeTab) || activeTab.workspacePath !== workspaceAbsPath) {
      return undefined;
    }

    return activeTab.workspaceIdentity;
  });
  const lastReloadSessionTriggeredAtRef = useRef<number | null>(null);

  const handleReloadSession = useCallback(
    async (options?: { resumeTaskId?: string | null; provider?: MyCodeProvider | null }) => {
      if (reloadSessionDisabled || reloadSessionPending) {
        return;
      }

      const now = Date.now();
      if (shouldDebounceWorkspaceSessionReload(lastReloadSessionTriggeredAtRef.current, now)) {
        // Header 与错误条都可触发 reload，会出现短时间双击/连点并发重建。
        // 这里在入口做时间窗防抖，避免并发调用 restartWorkspaceProcess 抢占同一 provider-workspace。
        logger.info(`[App] 忽略重复 workspace session 重建请求 workspace=${workspaceAbsPath}`);
        return;
      }
      lastReloadSessionTriggeredAtRef.current = now;
      setReloadSessionPending(true);

      const mycodeSessionStore = useMyCodeSessionStore.getState();
      const latestWorkspaceState = mycodeSessionStore.getWorkspaceState(
        workspaceAbsPath,
        workspaceIdentity,
      );
      const actionScope = resolveWorkspaceModelConfigSyncScope(latestWorkspaceState);
      const provider: MyCodeProvider = options?.provider ?? actionScope.provider;
      const resumeTaskId =
        options?.resumeTaskId?.trim() || latestWorkspaceState.activeTaskId || undefined;
      const shouldPrepareWorkspace = !resumeTaskId;

      // Reload session 之前只调用了服务层重建流程，没有同步 workspaceInit 状态到 UI store。
      // 草稿态下后续准备流程会继续读到旧状态，用户会误判本次重建没有生效。
      // 这里显式写入 initializing/ready/failed，保证重建状态和会话流程保持一致。
      mycodeSessionStore.setWorkspaceInitState(
        workspaceAbsPath,
        "initializing",
        null,
        workspaceIdentity,
      );
      if (shouldPrepareWorkspace) {
        mycodeSessionStore.setConfigOptionsStatus(workspaceAbsPath, "loading", workspaceIdentity);
        // 草稿态点击 reload 后若不清空旧错误，输入区会继续显示上一轮失败提示，
        // 用户会误判本次重建仍失败。这里在新一轮重建开始时先清空草稿错误。
        mycodeSessionStore.setDraftError(workspaceAbsPath, null, workspaceIdentity);
        mycodeSessionStore.setTaskState(workspaceAbsPath, "idle", null, workspaceIdentity);
      }

      try {
        await services.mycodeTaskService.restartWorkspaceProcess({
          workspacePath: workspaceAbsPath,
          ...(workspaceIdentity ? { workspaceIdentity } : {}),
          provider,
          resumeTaskId,
        });

        if (shouldPrepareWorkspace) {
          const prepareResult = await prepareWorkspaceWithMyCodeSessionService({
            workspacePath: workspaceAbsPath,
            workspaceIdentity,
            provider,
            mycodeSessionService: services.mycodeSessionService,
          });

          const latestAfterPrepare = mycodeSessionStore.getWorkspaceState(
            workspaceAbsPath,
            workspaceIdentity,
          );
          if (latestAfterPrepare.selectedProvider === provider) {
            const latestAfterResolve = mycodeSessionStore.getWorkspaceState(
              workspaceAbsPath,
              workspaceIdentity,
            );
            if (latestAfterResolve.selectedProvider === provider) {
              mycodeSessionStore.setConfigOptions(
                workspaceAbsPath,
                prepareResult.configOptions ?? [],
                workspaceIdentity,
              );
              mycodeSessionStore.setConfigOptionsStatus(
                workspaceAbsPath,
                "ready",
                workspaceIdentity,
              );
              mycodeSessionStore.setSlashCommands(
                workspaceAbsPath,
                prepareResult.slashCommands ?? [],
                workspaceIdentity,
              );
              mycodeSessionStore.setDraftError(workspaceAbsPath, null, workspaceIdentity);
            }
          }
        }

        mycodeSessionStore.setWorkspaceInitAttempts(workspaceAbsPath, 0, workspaceIdentity);
        mycodeSessionStore.setWorkspaceInitState(workspaceAbsPath, "ready", null, workspaceIdentity);

        logger.info(
          `[App] workspace session 重建完成 workspace=${workspaceAbsPath} provider=${provider} resumeTaskId=${resumeTaskId ?? "<none>"}`,
        );
        toast(intl.formatMessage({ id: "appHeader.reloadSessionSuccess" }));
      } catch (error) {
        const reloadDraftError = buildWorkspaceSessionReloadDraftError(error, {
          workspacePath: workspaceAbsPath,
          provider,
        });
        const message = reloadDraftError.message;
        logger.warn(
          `[App] workspace session 重建失败 workspace=${workspaceAbsPath} provider=${provider}`,
          {
            resumeTaskId: resumeTaskId ?? null,
            message,
          },
        );
        mycodeSessionStore.setWorkspaceInitState(
          workspaceAbsPath,
          "failed",
          message,
          workspaceIdentity,
        );
        if (shouldPrepareWorkspace) {
          mycodeSessionStore.setConfigOptionsStatus(workspaceAbsPath, "error", workspaceIdentity);
          // 草稿态下 reload 前会先清空旧错误；如果失败后不回填 draftError，
          // 聊天区只剩 toast，用户看不到可重试的详细报错。这里统一回填标准化错误到输入区。
          mycodeSessionStore.setDraftError(workspaceAbsPath, reloadDraftError, workspaceIdentity);
        }
        toast(intl.formatMessage({ id: "appHeader.reloadSessionFailed" }));
      } finally {
        setReloadSessionPending(false);
      }
    },
    [
      intl,
      reloadSessionDisabled,
      reloadSessionPending,
      services.mycodeTaskService,
      services.mycodeSessionService,
      workspaceAbsPath,
      workspaceIdentity,
    ],
  );

  return {
    reloadSessionPending,
    handleReloadSession,
  };
}
