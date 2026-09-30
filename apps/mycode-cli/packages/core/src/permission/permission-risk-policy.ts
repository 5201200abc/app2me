import { type RiskLevel } from "@mycode/contracts";

import {
  type PermissionToolCapability,
  type ResolvedPermissionCapability,
} from "./service-permission-context.js";
export function isMcpToolCapability(capability: ResolvedPermissionCapability): boolean {
  return capability.permissionName === "mcp";
}

export function getPermissionRiskLevel(
  toolName: string,
  toolCapability?: PermissionToolCapability,
): RiskLevel {
  if (toolCapability?.riskLevel) {
    return toolCapability.riskLevel;
  }

  if (isReadOnlyTool(toolName)) {
    return "low";
  }

  if (isWriteTool(toolName)) {
    return "medium";
  }

  if (isDestructiveTool(toolName)) {
    return "high";
  }

  return "medium";
}

export function isReadOnlyTool(name: string): boolean {
  return new Set([
    "Read",
    "Glob",
    "Grep",
    "WebSearch",
    "WebFetch",
    "TodoRead",
    "TodoWrite",
    "AskUserQuestion",
    "Agent",
    "Task",
    "Skill",
  ]).has(name);
}

export function isWriteTool(name: string): boolean {
  return new Set(["Write", "Edit", "ApplyPatch", "Bash"]).has(name);
}

export function isDestructiveTool(name: string): boolean {
  return new Set(["Bash"]).has(name);
}
