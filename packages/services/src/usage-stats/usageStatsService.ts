import type {
  AppUsageRequest,
  AppUsageSnapshot,
  CodingPlanUsageRequest,
  CodingPlanUsageSnapshot,
  CodingPlanResetOpportunityRequest,
  CodingPlanResetOpportunityResult,
  CodingPlanResetScopeRequest,
  CodingPlanResetStatusSnapshot,
  CodingPlanResetUseRequest,
  CodingPlanResetUseResult,
  UsageEntitlementRequest,
  UsageEntitlementSnapshot,
  UsageStatsRequest,
  UsageStatsSnapshot,
} from "@mycode/shared";
import type { IMyCodeAgentService } from "../mycode-agent/mycodeAgent.js";
import type { IUsageStatsService } from "./usageStats.js";

interface UsageStatsServiceDependencies {
  /** App Usage 经 MyCode Protocol 读取 agent 数据库真实统计。 */
  mycodeAgentService: Pick<IMyCodeAgentService, "getAppUsageStats">;
}

function retiredCodingPlanError(): Error {
  return new Error("Coding Plan integration has been removed");
}

export function createUsageStatsService(
  dependencies: UsageStatsServiceDependencies,
): IUsageStatsService {
  return {
    async getAppUsageSnapshot(request: AppUsageRequest): Promise<AppUsageSnapshot> {
      // App Usage 现读取 agent 数据库真实统计（model_usage/turn_usage/tool_usage），
      // 经 MyCode Protocol usage/stats 取回。不再读本地 session JSON 估算。
      return dependencies.mycodeAgentService.getAppUsageStats({
        range: request.range,
        timeZone: request.timeZone,
      });
    },
    async getCodingPlanUsageSnapshot(
      request: CodingPlanUsageRequest,
    ): Promise<CodingPlanUsageSnapshot> {
      // Bug 原因：旧 RPC 仍可由历史客户端调用。退役后必须立即拒绝，不能继续请求官方额度接口。
      void request;
      throw retiredCodingPlanError();
    },
    async getCodingPlanResetStatus(
      request: CodingPlanResetScopeRequest,
    ): Promise<CodingPlanResetStatusSnapshot> {
      void request;
      throw retiredCodingPlanError();
    },
    async requestCodingPlanResetOpportunity(
      request: CodingPlanResetOpportunityRequest,
    ): Promise<CodingPlanResetOpportunityResult> {
      void request;
      throw retiredCodingPlanError();
    },
    async useCodingPlanReset(
      request: CodingPlanResetUseRequest,
    ): Promise<CodingPlanResetUseResult> {
      void request;
      throw retiredCodingPlanError();
    },
    async markCodingPlanResetHistoryRead(request: CodingPlanResetScopeRequest): Promise<void> {
      void request;
      throw retiredCodingPlanError();
    },
    async getSnapshot(request: UsageStatsRequest): Promise<UsageStatsSnapshot> {
      void request;
      throw retiredCodingPlanError();
    },
    async getEntitlementSnapshot(
      request: UsageEntitlementRequest = {},
    ): Promise<UsageEntitlementSnapshot> {
      void request;
      throw retiredCodingPlanError();
    },
  };
}
