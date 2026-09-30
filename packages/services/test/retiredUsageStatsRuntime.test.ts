import assert from "node:assert/strict";
import { test } from "node:test";
import type { IMyCodeAgentService } from "../src/mycode-agent/mycodeAgent.js";
import { createUsageStatsService } from "../src/usage-stats/usageStatsService.js";

test("usage service keeps local history and rejects retired Coding Plan RPCs", async () => {
  const calls: unknown[] = [];
  const expected = { range: "7d", timeZone: "UTC" } as const;
  const localSnapshot = { source: "agent" };
  const mycodeAgentService = {
    async getAppUsageStats(request: unknown) {
      calls.push(request);
      return localSnapshot;
    },
  } as unknown as Pick<IMyCodeAgentService, "getAppUsageStats">;
  const service = createUsageStatsService({ mycodeAgentService });

  assert.equal(await service.getAppUsageSnapshot(expected), localSnapshot);
  assert.deepEqual(calls, [expected]);

  const retiredCalls = [
    () => service.getCodingPlanUsageSnapshot({} as never),
    () => service.getCodingPlanResetStatus({} as never),
    () => service.requestCodingPlanResetOpportunity({} as never),
    () => service.useCodingPlanReset({} as never),
    () => service.markCodingPlanResetHistoryRead({} as never),
    () => service.getSnapshot({} as never),
    () => service.getEntitlementSnapshot(),
  ];
  for (const call of retiredCalls) {
    await assert.rejects(call(), /Coding Plan integration has been removed/);
  }
  assert.deepEqual(calls, [expected]);
});
