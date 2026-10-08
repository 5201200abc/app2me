/** 摘要只取原命令；parsed_cmd 可能只含拆分后的首条，不能替代完整脚本。 */
export function getExecuteCommandDisplayText(input: unknown): string | undefined {
  if (typeof input === "string") return input.trim() ? input : undefined;
  if (Array.isArray(input) && input.every((item) => typeof item === "string")) {
    const shellCommandIndex = input.indexOf("-lc");
    const command = shellCommandIndex >= 0 ? input[shellCommandIndex + 1] : input.join(" ");
    return command?.trim() ? command : undefined;
  }
  if (isPlainRecord(input)) {
    for (const key of ["command", "cmd", "script"] as const) {
      const command = input[key];
      if (typeof command === "string" && command.trim()) return command;
    }
  }
  return getExecuteSecondaryText(input);
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getExecuteSecondaryText(input: unknown): string | undefined {
  if (typeof input === "string") {
    const trimmed = input.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(input) && input.every((item) => typeof item === "string")) {
    const parts = input.map((item) => item.trim()).filter(Boolean);
    if (parts.length === 0) {
      return undefined;
    }

    const shellCommandIndex = parts.findIndex((part) => part === "-lc");
    if (shellCommandIndex >= 0 && parts[shellCommandIndex + 1]) {
      return parts[shellCommandIndex + 1];
    }

    return parts.join(" ");
  }

  if (typeof input !== "object" || input === null) {
    return undefined;
  }

  const record = input as Record<string, unknown>;
  const parsedCommand = record.parsed_cmd;
  if (Array.isArray(parsedCommand)) {
    for (const item of parsedCommand) {
      if (typeof item === "string") {
        const trimmed = item.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
        continue;
      }

      if (typeof item !== "object" || item === null) {
        continue;
      }

      const parsedRecord = item as Record<string, unknown>;
      if (typeof parsedRecord.cmd === "string" && parsedRecord.cmd.trim().length > 0) {
        return parsedRecord.cmd.trim();
      }
    }
  }

  for (const key of ["command", "cmd", "script", "parsed_cmd"] as const) {
    const candidate = record[key];
    if (typeof candidate !== "string") {
      continue;
    }

    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
}
