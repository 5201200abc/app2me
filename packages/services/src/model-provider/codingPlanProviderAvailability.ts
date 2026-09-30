import type { ProviderFamilyDomain } from "@mycode/shared";

export type CodingPlanUnavailableReason =
  | "coding_plan_not_authenticated"
  | "coding_plan_not_connected"
  | "coding_plan_auth_failed"
  | "coding_plan_not_entitled";

export type CodingPlanAvailabilityResult =
  | { kind: "available"; models?: readonly string[] }
  | { kind: "pending"; effectiveAt: number; models: readonly string[] }
  | { kind: "unavailable"; reason: CodingPlanUnavailableReason }
  | { kind: "unknown" };

export interface CodingPlanAvailabilityProvider {
  readonly providerId: string;
  readonly family: ProviderFamilyDomain;
  readonly planKind: "start-plan" | "individual-coding-plan" | "team-coding-plan";
  readonly apiKey?: string | null;
}

function removedFamilyAvailability(
  providers: readonly CodingPlanAvailabilityProvider[],
  family: ProviderFamilyDomain,
): Partial<Record<string, CodingPlanAvailabilityResult>> {
  // 旧账号查询路径保持可调用，但所有套餐都明确不可用，不读取凭据或联网。
  return Object.fromEntries(
    providers
      .filter((provider) => provider.family === family)
      .map((provider) => [
        provider.providerId,
        { kind: "unavailable", reason: "coding_plan_not_connected" },
      ]),
  );
}

export function validateZaiAccountProviderAvailability(
  providers: readonly CodingPlanAvailabilityProvider[],
  _context: unknown,
): Promise<Partial<Record<string, CodingPlanAvailabilityResult>>> {
  return Promise.resolve(removedFamilyAvailability(providers, "zai"));
}

export function validateBigModelAccountProviderAvailability(
  providers: readonly CodingPlanAvailabilityProvider[],
  _context: unknown,
): Promise<Partial<Record<string, CodingPlanAvailabilityResult>>> {
  return Promise.resolve(removedFamilyAvailability(providers, "bigmodel"));
}
