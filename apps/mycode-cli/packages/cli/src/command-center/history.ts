import type { TuiPromptInput } from "@mycode/tui";
import type { CommandCenterDeps } from "./types.js";

const API_KEY_LOGIN_PATTERN = /(?:^|\s)(?:bigmodel|zai)-coding-plan-api-key(?:\s|$)/u;

export async function recordSlashCommandInHistory(
  deps: CommandCenterDeps,
  input: TuiPromptInput,
): Promise<void> {
  const text = typeof input === "string" ? input : input.text;
  // 旧 /login 已退役；历史输入仍可能包含密钥，不能写入命令历史。
  if (!deps.recordInputHistory || API_KEY_LOGIN_PATTERN.test(text)) return;
  try {
    await deps.recordInputHistory(input, "slash_command");
  } catch {
    // Input history is recall UX; command execution must not depend on it.
  }
}
