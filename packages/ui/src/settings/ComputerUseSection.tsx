/* eslint-disable max-lines -- 保留既有 macOS 授权返回的单次恢复与 workspace 失效保护。 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CuaOsSupport, RemoteTarget } from "@mycode/shared";
import {
  DesktopCommandIds,
  isRemoteWorkspaceIdentity,
  MYCODE_CUA_OFFICIAL_PLUGIN_ID,
} from "@mycode/shared";
import { isCuaPermissionStatusAvailable, type CuaPermissionRestartOptions } from "@mycode/services";
import { toast } from "@/components/ui/toast.js";
import { Switch } from "@/components/ui/switch.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { useMyCodeIntl } from "@/i18n/IntlProvider.js";
import { useCuaPermissionStatus } from "@/hooks/useCuaPermissionStatus.js";
import {
  claimCuaPermissionReturnRecovery,
  completeCuaPermissionReturnRecovery,
  captureCuaPermissionReturnRecovery,
  createCuaPermissionReturnRecoveryState,
  isCuaPermissionReturnRecoveryCurrent,
  markCuaPermissionOnboardingOpened,
  shouldRestartHelperAfterCuaPermissionReturn,
  type CuaPermissionReturnRecoveryClaim,
} from "@/lib/cuaPermissionAction.js";
import { usePluginManagementStore } from "@/store/pluginManagementStore.js";
import { SettingsGroupCard } from "@/settings/SettingsPageParts.js";
import { SettingsCapabilityRow } from "@/settings/SettingsCapabilityRow.js";
import { isCuaPermissionTccGranted } from "@/lib/cuaPermissionStatusStore.js";
import { supportsLocalMacCuaPermissionOnboarding } from "@/lib/cuaPlatform.js";
import { runAfterSuccessfulPluginEnabledChange } from "@/settings/pluginEnabledChange.js";
import { createCuaPermissionOnboardingOperationId } from "@/lib/cuaPermissionOnboardingOperation.js";
import { waitForAccessibilityNotStale } from "@/settings/cuaPermissionRestartVerify.js";
import { requiredCuaPermissionsForFreshStatus } from "@/settings/cuaPermissionPreparation.js";
import {
  isComputerUseRemoteOrLinux,
  resolveComputerUseAvailability,
} from "@/settings/computerUseAvailability.js";

interface ComputerUseSectionProps {
  isDesktop?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  workspacePath?: string | null;
  workspaceIdentity?: string;
  remoteSessionId?: string | null;
  remoteTarget?: RemoteTarget | null;
  // SSH 远端设置页里 workspacePath 是远端路径；本机 Helper 状态查询必须使用本机 workspace 路径。
  localWorkspacePath?: string | null;
}

export function ComputerUseSection({
  isDesktop = false,
  isMacDesktop,
  isWindowsDesktop = false,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  remoteTarget,
  localWorkspacePath,
}: ComputerUseSectionProps) {
  const { intl } = useMyCodeIntl();
  const services = useServices();
  const platform = usePlatform();
  const pluginManagementService = services.pluginManagementService;
  // cuaPermissionService 在 main 是可选字段（远端 host 无 CUA）；下方各 handler 在缺失时早退。
  const cuaPermissionService = services.cuaPermissionService;
  const isLocalWorkspace =
    !remoteSessionId &&
    !remoteTarget &&
    !(workspaceIdentity?.trim() && isRemoteWorkspaceIdentity(workspaceIdentity.trim()));
  // Windows 复用插件总开关；macOS 额外通过既有 TCC 授权链完成启用前确认。
  const supportsLocalMacWorkspace =
    !isWindowsDesktop &&
    (isMacDesktop ?? supportsLocalMacCuaPermissionOnboarding(platform)) &&
    isLocalWorkspace;
  const supportsLocalWindowsWorkspace = isWindowsDesktop && isLocalWorkspace;
  const supportsComputerUseSettings = supportsLocalMacWorkspace || supportsLocalWindowsWorkspace;
  const availability = resolveComputerUseAvailability({
    isDesktop: isDesktop || isWindowsDesktop || supportsLocalMacWorkspace,
    isMacDesktop: isMacDesktop || supportsLocalMacWorkspace,
    isWindowsDesktop,
    remoteSessionId,
    remoteTarget,
    workspaceIdentity,
  });
  // CUA 权限是 macOS 本机属性：仅完整 macOS 设置需要 Helper workspace 路径。
  const path = supportsLocalMacWorkspace ? (localWorkspacePath ?? workspacePath) : null;
  // 展示复用权限快照；只有 fresh 确认的缺权结果可以触发自动关闭。
  const { status, fresh, refresh } = useCuaPermissionStatus(path ?? null, workspaceIdentity);
  const availableStatus = status && isCuaPermissionStatusAvailable(status) ? status : null;

  // macOS 版本门槛：低版本系统上 Helper 被 LaunchServices -10825 拒启，表象是授权反复无响应。
  // 查询一次主进程判定（GetCuaOsSupport），低于地板时渲染提示卡并隐藏授权操作区。
  // 查询失败不虚构系统版本；权限仍由事件驱动的既有查询链确认。
  const [osSupport, setOsSupport] = useState<CuaOsSupport | null>(null);
  useEffect(() => {
    if (!supportsLocalMacWorkspace || typeof platform.executeDesktopCommand !== "function") return;
    let cancelled = false;
    void platform
      .executeDesktopCommand(DesktopCommandIds.GetCuaOsSupport)
      .then((result) => {
        if (!cancelled) setOsSupport(result as CuaOsSupport);
      })
      .catch(() => {
        /* 查询失败按无门槛处理，不阻塞设置页 */
      });
    return () => {
      cancelled = true;
    };
  }, [supportsLocalMacWorkspace, platform]);

  const macOsBelowCuaFloor = osSupport?.kind === "macos-below-minimum";

  // 总开关 = mycode-cua 插件启用态（读自插件管理 store；切换即同步启用/禁用插件及其 MCP + skill）。
  const plugins = usePluginManagementStore((state) => state.plugins);
  const setPluginEnabled = usePluginManagementStore((state) => state.setEnabled);
  const initializePlugins = usePluginManagementStore((state) => state.initialize);
  const togglingPluginId = usePluginManagementStore((state) => state.togglingPluginId);
  const cuaPlugin = plugins.find((plugin) => plugin.id === MYCODE_CUA_OFFICIAL_PLUGIN_ID);
  const cuaEnabled = cuaPlugin?.enabled ?? false;
  const cuaToggling = togglingPluginId === MYCODE_CUA_OFFICIAL_PLUGIN_ID;

  const initRef = useRef<string | null>(null);
  const pluginInitializationKey = workspaceIdentity?.trim() || workspacePath || "";
  useEffect(() => {
    if (
      initRef.current === pluginInitializationKey ||
      !supportsComputerUseSettings ||
      !workspacePath ||
      !pluginManagementService
    )
      return;
    initRef.current = pluginInitializationKey;
    // 复用 Plugins 分区同一条初始化路径，确保 store 已加载 mycode-cua 的 enabled 态。
    void initializePlugins({
      workspacePath,
      workspaceIdentity,
      pluginService: pluginManagementService,
    });
  }, [
    supportsComputerUseSettings,
    pluginInitializationKey,
    workspacePath,
    workspaceIdentity,
    pluginManagementService,
    initializePlugins,
  ]);

  // 授权返回的 Helper 恢复保持 single-flight，不并发轮换 broker 凭据。
  const restartPromiseRef = useRef<Promise<boolean> | null>(null);
  const pendingGrantSessionIdRef = useRef<string | undefined>(undefined);
  const returnRecoveryRef = useRef(createCuaPermissionReturnRecoveryState());
  useEffect(() => {
    returnRecoveryRef.current = createCuaPermissionReturnRecoveryState(
      workspaceIdentity?.trim() || path || "<none>",
    );
    pendingGrantSessionIdRef.current = undefined;
  }, [path, workspaceIdentity]);
  const [preparing, setPreparing] = useState(false);
  const preparingRef = useRef(false);
  const revokedStatusRef = useRef<typeof status>(null);
  // 卸载守卫：异步 fetch / 重启 / 切换完成时若组件已卸载，跳过 setState。
  const mountedRef = useRef(true);
  const pluginToggleGenerationRef = useRef(0);
  const pluginToggleContextKey = [
    workspacePath ?? "",
    workspaceIdentity ?? "",
    localWorkspacePath ?? "",
    remoteSessionId ?? "",
    remoteTarget ? "remote" : "local",
  ].join("\u0000");
  const pluginToggleContextKeyRef = useRef(pluginToggleContextKey);
  pluginToggleContextKeyRef.current = pluginToggleContextKey;
  const helperContextKey = [path ?? "", workspaceIdentity?.trim() ?? ""].join("\u0000");
  const helperContextKeyRef = useRef(helperContextKey);
  helperContextKeyRef.current = helperContextKey;
  const activeOnboardingOperationIdRef = useRef<string | null>(null);
  const permissionStatusCheckTokenRef = useRef<symbol | null>(null);
  const platformRef = useRef(platform);
  platformRef.current = platform;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pluginToggleGenerationRef.current += 1;
      permissionStatusCheckTokenRef.current = null;
      const operationId = activeOnboardingOperationIdRef.current;
      activeOnboardingOperationIdRef.current = null;
      if (operationId) {
        platformRef.current.cancelCuaPermissionOnboarding?.(operationId);
      }
    };
  }, []);

  // 同一设置页实例切换 workspace 时也要退出旧 participant；否则旧调用返回后会恢复错误的 Helper。
  useEffect(
    () => () => {
      permissionStatusCheckTokenRef.current = null;
      const operationId = activeOnboardingOperationIdRef.current;
      activeOnboardingOperationIdRef.current = null;
      if (operationId) {
        platformRef.current.cancelCuaPermissionOnboarding?.(operationId);
      }
    },
    [path, workspaceIdentity],
  );

  const onRestart = useCallback(
    (
      targetPath = path,
      targetWorkspaceIdentity = workspaceIdentity,
      restartOptions?: CuaPermissionRestartOptions,
    ): Promise<boolean> => {
      if (!targetPath || !services || !cuaPermissionService) return Promise.resolve(false);
      if (restartPromiseRef.current) return restartPromiseRef.current;
      const targetContextKey = [targetPath, targetWorkspaceIdentity?.trim() ?? ""].join("\u0000");
      const operation = (async (): Promise<boolean> => {
        let queuedActiveProbe = false;
        try {
          const result = await cuaPermissionService.restartHelper(
            targetPath,
            targetWorkspaceIdentity,
            restartOptions,
          );
          if (!result.ok && mountedRef.current) {
            toast(
              intl.formatMessage(
                { id: "cuaPermission.modal.restartFailed" },
                { error: result.reason ?? "unknown error" },
              ),
            );
            return false;
          }
          if (!result.ok) return false;

          // Helper socket 已健康不代表 tccd 状态已经传播完成；短轮询确认 stale 是否消失。
          await waitForAccessibilityNotStale(() =>
            cuaPermissionService.getStatus(targetPath, targetWorkspaceIdentity),
          );
          // 授权过程中可能切换 workspace；旧操作仍完成必要副作用，但不能污染新页面的升级提示。
          if (mountedRef.current && helperContextKeyRef.current === targetContextKey) {
            // 后台权限轮询必须保持只读，真实截图只能跟随显式的授权返回/重启。
            // restart single-flight 已经把同一 Helper 恢复合并为一次，这里只排一个主动探针；
            // hook 会继续合并 focus/refresh，避免重复触发 macOS 隐私采集。
            refresh({ includeFunctionalProbes: true });
            queuedActiveProbe = true;
          }
          return true;
        } catch (error) {
          if (mountedRef.current) {
            toast(
              intl.formatMessage(
                { id: "cuaPermission.modal.restartFailed" },
                {
                  error: error instanceof Error ? error.message : String(error),
                },
              ),
            );
          }
          return false;
        } finally {
          restartPromiseRef.current = null;
          if (mountedRef.current) {
            // 失败路径仍只读刷新；成功路径已在当前 workspace 精确排入一次主动探针。
            if (!queuedActiveProbe) refresh();
          }
        }
      })();
      restartPromiseRef.current = operation;
      return operation;
    },
    [path, workspaceIdentity, services, refresh, intl],
  );

  const applyPendingGrant = useCallback(
    async (
      expectedClaim?: CuaPermissionReturnRecoveryClaim,
      target?: { workspacePath: string; workspaceIdentity?: string },
      onboardingSessionId?: string,
    ): Promise<boolean> => {
      const claim = expectedClaim ?? captureCuaPermissionReturnRecovery(returnRecoveryRef.current);
      if (!claim || !isCuaPermissionReturnRecoveryCurrent(claim.state, claim)) {
        return false;
      }
      // 授权前若已有 restart，先等它结束，再启动一个真正位于授权之后的新 Helper。
      const existing = restartPromiseRef.current;
      if (existing) await existing;
      if (!isCuaPermissionReturnRecoveryCurrent(claim.state, claim)) return false;
      // A 发起授权后切到 B，返回结果仍属于当前 renderer/host 的 A runtime。用点击时捕获的 identity
      // 完成必要 restart；只让后续展示刷新服从当前 props，不能因 UI generation 变化丢掉副作用。
      const ok = await onRestart(target?.workspacePath, target?.workspaceIdentity, {
        reason: "permission_granted",
        ...((onboardingSessionId ?? pendingGrantSessionIdRef.current)
          ? {
              onboardingSessionId: onboardingSessionId ?? pendingGrantSessionIdRef.current,
            }
          : {}),
      });
      completeCuaPermissionReturnRecovery(claim, ok);
      return ok;
    },
    [onRestart],
  );

  // 打开 macOS 系统设置引导用户授权指定权限（Accessibility / Screen Recording）。
  const openPermissionSettings = useCallback(async (): Promise<boolean> => {
    if (
      typeof platform.openCuaPermissionOnboarding !== "function" ||
      activeOnboardingOperationIdRef.current ||
      permissionStatusCheckTokenRef.current
    ) {
      return false;
    }
    const checkToken = Symbol("cua-permission-status-check");
    permissionStatusCheckTokenRef.current = checkToken;
    const operationContextKey = helperContextKey;
    let operationId: string | null = null;
    const recoveryState = returnRecoveryRef.current;
    const recoveryTarget = path
      ? {
          workspacePath: path,
          ...(workspaceIdentity ? { workspaceIdentity } : {}),
        }
      : null;
    try {
      if (!path || !cuaPermissionService) {
        toast(intl.formatMessage({ id: "cuaPermission.modal.unavailable" }));
        return false;
      }
      // 设置页行按钮过去直接使用 lastKnown 状态；另一窗口刚完成授权或当前刷新
      // in-flight 时仍会打开过期 pane。点击边沿重新查询 Helper，只允许当前 denied/stale 的精确项。
      let currentStatus = await cuaPermissionService.getStatus(path, workspaceIdentity, {
        includeFunctionalProbes: false,
      });
      // 从系统设置授权返回后 App 会重启 Helper 才能读到新 TCC 授权，这段窗口内查询拿到的是
      // 不可用状态（授权完立刻点行按钮，预检查退化成「暂时无法确认」
      // 而非「已授权」）。状态不可用时短重试 2 次、间隔 2s，等 Helper 就绪后走到「已授权」
      // 或真实缺权分支；期间守卫失效（卸载/重复点击/上下文切换）直接放弃，不再重试。
      for (
        let attempt = 0;
        attempt < 2 && !isCuaPermissionStatusAvailable(currentStatus);
        attempt += 1
      ) {
        await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        if (
          !mountedRef.current ||
          permissionStatusCheckTokenRef.current !== checkToken ||
          helperContextKeyRef.current !== operationContextKey ||
          returnRecoveryRef.current !== recoveryState
        ) {
          return false;
        }
        currentStatus = await cuaPermissionService.getStatus(path, workspaceIdentity, {
          includeFunctionalProbes: false,
        });
      }
      // React concurrent commit 可能已经收到 workspace A→B 更新但 passive effect 尚未清理 A。
      // render 同步更新的 context ref 是这段窗口内唯一可靠的失效信号；让出一个 macrotask后再判，
      // 迟到的 A 状态不能为 B 打开原生设置页。
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (
        !mountedRef.current ||
        permissionStatusCheckTokenRef.current !== checkToken ||
        helperContextKeyRef.current !== operationContextKey ||
        returnRecoveryRef.current !== recoveryState
      ) {
        return false;
      }
      if (isCuaPermissionStatusAvailable(currentStatus) && isCuaPermissionTccGranted(currentStatus))
        return true;
      const requiredPermissions = isCuaPermissionStatusAvailable(currentStatus)
        ? requiredCuaPermissionsForFreshStatus(currentStatus)
        : [];
      // unknown / 查询失败不是缺权证据，不能猜测授权项或提前启用插件。
      if (!requiredPermissions.length) {
        toast(intl.formatMessage({ id: "cuaPermission.modal.unavailable" }));
        refresh();
        return false;
      }
      operationId = createCuaPermissionOnboardingOperationId();
      activeOnboardingOperationIdRef.current = operationId;
      const result = await platform.openCuaPermissionOnboarding({
        initialPermission: requiredPermissions[0],
        operationId,
        requiredPermissions,
      });
      if (
        !mountedRef.current ||
        activeOnboardingOperationIdRef.current !== operationId ||
        helperContextKeyRef.current !== operationContextKey
      ) {
        return false;
      }
      if (shouldRestartHelperAfterCuaPermissionReturn(result)) {
        markCuaPermissionOnboardingOpened(recoveryState);
        pendingGrantSessionIdRef.current = result.sessionId;
        const claim = claimCuaPermissionReturnRecovery(recoveryState);
        if (claim && recoveryTarget) {
          if (!(await applyPendingGrant(claim, recoveryTarget, result.sessionId))) return false;
        }
      } else if (result?.success && result.returnedFromSettings) {
        // 同一 renderer 对 main session 的重复 join 只刷新；不同窗口各自会拿到本 host 的 recovery。
        refresh();
      }
      if (result?.success === false && !result.canceled) {
        toast(
          intl.formatMessage(
            { id: "chat.cuaPermission.openFailed" },
            { error: result.error ?? "unknown error" },
          ),
        );
      }
      if (!result?.success || result.canceled) return false;
      const verified = await cuaPermissionService.getStatus(path, workspaceIdentity, {
        includeFunctionalProbes: false,
      });
      refresh();
      // 授权窗口结束不等于已授权；双权限真值和原上下文都确认后才允许继续启用。
      return (
        mountedRef.current &&
        activeOnboardingOperationIdRef.current === operationId &&
        helperContextKeyRef.current === operationContextKey &&
        isCuaPermissionStatusAvailable(verified) &&
        isCuaPermissionTccGranted(verified)
      );
    } catch (error) {
      if (
        mountedRef.current &&
        permissionStatusCheckTokenRef.current === checkToken &&
        helperContextKeyRef.current === operationContextKey
      ) {
        toast(
          operationId
            ? intl.formatMessage(
                { id: "chat.cuaPermission.openFailed" },
                {
                  error: error instanceof Error ? error.message : String(error),
                },
              )
            : intl.formatMessage({ id: "cuaPermission.modal.unavailable" }),
        );
      }
      return false;
    } finally {
      if (permissionStatusCheckTokenRef.current === checkToken) {
        permissionStatusCheckTokenRef.current = null;
      }
      if (operationId && activeOnboardingOperationIdRef.current === operationId) {
        activeOnboardingOperationIdRef.current = null;
      }
    }
  }, [platform, path, services, workspaceIdentity, intl, applyPendingGrant, refresh]);

  const permissionsGranted =
    !supportsLocalMacWorkspace ||
    (!!cuaPermissionService && !!availableStatus && isCuaPermissionTccGranted(availableStatus));
  const onTogglePlugin = useCallback(
    async (next: boolean) => {
      if (!pluginManagementService || preparingRef.current || cuaToggling) return;
      const operationGeneration = ++pluginToggleGenerationRef.current;
      const operationContextKey = pluginToggleContextKey;
      const isCurrent = () =>
        mountedRef.current &&
        pluginToggleGenerationRef.current === operationGeneration &&
        pluginToggleContextKeyRef.current === operationContextKey;
      preparingRef.current = true;
      setPreparing(true);
      try {
        if (next && supportsLocalMacWorkspace) {
          // 旧配置可能已启用但权限未确认；授权期间必须保持实际插件关闭，而非只关闭视觉开关。
          if (cuaEnabled && !permissionsGranted) {
            const closed = await setPluginEnabled(
              MYCODE_CUA_OFFICIAL_PLUGIN_ID,
              false,
              pluginManagementService,
            );
            if (!closed || !isCurrent()) return;
          }
          if (macOsBelowCuaFloor || !(await openPermissionSettings()) || !isCurrent()) return;
        }
        // 插件 store 仍是唯一启用事实 owner，准备态仅阻止乐观投影提前打开开关。
        const completed = await runAfterSuccessfulPluginEnabledChange({
          submit: () =>
            setPluginEnabled(MYCODE_CUA_OFFICIAL_PLUGIN_ID, next, pluginManagementService),
          isCurrent,
          onSuccess: () => {
            if (supportsLocalMacWorkspace) refresh();
            if (!next) toast(intl.formatMessage({ id: "settings.computerUse.disabledToast" }));
          },
        });
        if (!completed && isCurrent()) {
          const message = usePluginManagementStore.getState().error;
          if (message) toast(message);
        }
      } catch (error) {
        if (isCurrent()) toast(error instanceof Error ? error.message : String(error));
      } finally {
        preparingRef.current = false;
        if (mountedRef.current) setPreparing(false);
      }
    },
    [
      cuaToggling,
      cuaEnabled,
      intl,
      macOsBelowCuaFloor,
      openPermissionSettings,
      permissionsGranted,
      pluginManagementService,
      pluginToggleContextKey,
      refresh,
      setPluginEnabled,
      supportsLocalMacWorkspace,
    ],
  );

  useEffect(() => {
    if (!supportsLocalMacWorkspace || !fresh || !availableStatus || preparing || cuaToggling)
      return;
    if (permissionsGranted) {
      revokedStatusRef.current = null;
      return;
    }
    // 仅新鲜且确定缺权的快照触发关闭；失败不自循环重试，下一次真实刷新再判断。
    if (
      cuaEnabled &&
      requiredCuaPermissionsForFreshStatus(availableStatus).length &&
      revokedStatusRef.current !== status
    ) {
      revokedStatusRef.current = status;
      void onTogglePlugin(false);
    }
  }, [
    availableStatus,
    cuaEnabled,
    cuaToggling,
    fresh,
    onTogglePlugin,
    permissionsGranted,
    preparing,
    status,
    supportsLocalMacWorkspace,
  ]);

  if (!supportsComputerUseSettings) {
    // 远端 / Linux 环境若直接 return null，设置页只剩标题，会让用户误以为页面加载失败。
    // 保留入口并明确能力边界，且不渲染任何会触发本地 CUA 写操作的控件。
    return (
      <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-ui-base text-warning">
        <p className="font-medium">
          {intl.formatMessage({ id: "settings.computerUse.unsupported.title" })}
        </p>
        <p className="mt-1 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({
            id: isComputerUseRemoteOrLinux(availability)
              ? availability.kind === "local-linux"
                ? "settings.computerUse.unsupported.linuxDescription"
                : "settings.computerUse.unsupported.remoteDescription"
              : "settings.computerUse.unsupported.remoteDescription",
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-computer-use-settings>
      <SettingsGroupCard>
        <SettingsCapabilityRow
          kind="computer"
          label={intl.formatMessage({ id: "settings.computerUse.toggleLabel" })}
          description={intl.formatMessage({ id: "settings.computerUse.toggleDescription" })}
          control={
            <Switch
              className="settings-capability-switch"
              aria-label={intl.formatMessage({ id: "settings.computerUse.toggleLabel" })}
              aria-busy={preparing || cuaToggling}
              checked={
                cuaEnabled &&
                permissionsGranted &&
                !macOsBelowCuaFloor &&
                !preparing &&
                !cuaToggling
              }
              disabled={
                preparing ||
                cuaToggling ||
                !workspacePath ||
                !cuaPlugin ||
                !pluginManagementService ||
                macOsBelowCuaFloor
              }
              onCheckedChange={(checked) => void onTogglePlugin(checked)}
            />
          }
        />
      </SettingsGroupCard>
      {macOsBelowCuaFloor ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-ui-sm text-warning">
          <p>
            {intl.formatMessage(
              { id: "cuaPermission.osFloorTitle" },
              {
                minimum: osSupport?.minimumMacOs ?? "12.0",
                current: osSupport?.currentMacOs ?? "12 以下",
              },
            )}
          </p>
          <p>{intl.formatMessage({ id: "cuaPermission.osFloorDescription" })}</p>
        </div>
      ) : null}
    </div>
  );
}
