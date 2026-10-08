import type { AgentSummary } from "@mycode/shared";

export function getSubagentDisplayName(
  agent: Pick<AgentSummary, "name" | "scope" | "source">,
): string {
  // 展示名与配置键分离，避免列表重命名后丢失已有内置模型覆盖，也不重命名同名用户/插件助手。
  if (agent.scope === "built-in" || agent.source === "built-in") {
    if (agent.name === "general-purpose") return "Worker";
    if (agent.name === "Explore") return "Searcher";
  }
  return agent.source === "plugin" && agent.name.includes(":")
    ? agent.name.slice(agent.name.indexOf(":") + 1)
    : agent.name;
}
