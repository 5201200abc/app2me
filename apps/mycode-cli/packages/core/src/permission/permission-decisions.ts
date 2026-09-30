import {
  type PermissionContext,
  type PermissionDecisionResult,
  type PermissionBehavior,
  type ResolvedPermissionCapability,
} from "./service-permission-context.js";
export function allowPermission(
  context: PermissionContext,
  capability: ResolvedPermissionCapability,
  ruleId: string,
  reason?: string,
): PermissionDecisionResult {
  return permissionDecision("allow", context, capability, ruleId, reason);
}

export function askPermission(
  context: PermissionContext,
  capability: ResolvedPermissionCapability,
  ruleId: string,
  reason: string,
): PermissionDecisionResult {
  return permissionDecision("ask", context, capability, ruleId, reason);
}

export function denyPermission(
  context: PermissionContext,
  capability: ResolvedPermissionCapability,
  ruleId: string,
  reason: string,
): PermissionDecisionResult {
  return permissionDecision("deny", context, capability, ruleId, reason);
}

export function permissionDecision(
  decision: PermissionBehavior,
  context: PermissionContext,
  capability: ResolvedPermissionCapability,
  ruleId: string,
  reason?: string,
): PermissionDecisionResult {
  return {
    decision,
    allowed: decision === "allow",
    escalated: decision === "ask",
    mode: context.mode,
    reason,
    riskLevel: capability.riskLevel,
    ruleId,
    sideEffectScope: capability.sideEffectScope,
    ...(capability.alwaysAsk ? { alwaysAsk: true } : {}),
  };
}
