import { z } from "zod";
import type { CommandAgentSource } from "./command-types.js";
import type { MyCodeProvider } from "./mycode-task-types-core.js";

export const MYCODE_AGENT_PROVIDER = "glm" satisfies MyCodeProvider;
export const MYCODE_AGENT_PROVIDER_LABEL = "MyCode Agent";
export const MYCODE_COMMAND_AGENT_SOURCE = "mycodeAgent" satisfies CommandAgentSource;

export const mycodeAgentProviderSchema = z.literal(MYCODE_AGENT_PROVIDER);

export const MYCODE_COMMAND_AGENT_SOURCES = [
  MYCODE_COMMAND_AGENT_SOURCE,
] as const satisfies readonly CommandAgentSource[];

export function normalizeAgentProviderToMyCodeAgent(
  _provider?: MyCodeProvider | null,
): MyCodeProvider {
  return MYCODE_AGENT_PROVIDER;
}

export function isMyCodeAgentProvider(
  provider: MyCodeProvider | null | undefined,
): provider is typeof MYCODE_AGENT_PROVIDER {
  return provider === MYCODE_AGENT_PROVIDER;
}
