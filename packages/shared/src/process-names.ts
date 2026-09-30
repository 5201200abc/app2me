const MYCODE_PROCESS_PREFIX = "mycode";
const MAX_PROCESS_NAME_SEGMENT_LENGTH = 24;

function sanitizeProcessNameSegment(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, MAX_PROCESS_NAME_SEGMENT_LENGTH);
}

function joinMyCodeProcessName(...segments: Array<string | null | undefined>): string {
  const sanitizedSegments = segments
    .map((segment) => sanitizeProcessNameSegment(segment))
    .filter((segment): segment is string => Boolean(segment));
  return [MYCODE_PROCESS_PREFIX, ...sanitizedSegments].join("-");
}

function pickWorkspaceTag(workspacePath: string | null | undefined): string | undefined {
  const trimmedPath = workspacePath?.trim();
  if (!trimmedPath) {
    return undefined;
  }

  const parts = trimmedPath.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? trimmedPath;
}

export function formatMyCodeMainProcessName(): string {
  return joinMyCodeProcessName("main");
}

export function formatMyCodeGpuProcessName(): string {
  return joinMyCodeProcessName("gpu");
}

export function formatMyCodeHostProcessName(label?: string): string {
  return joinMyCodeProcessName("host", label);
}

export function formatMyCodeRendererProcessName(windowTitle?: string): string {
  const normalizedTitle = windowTitle?.trim();
  if (!normalizedTitle || normalizedTitle === "MyCode") {
    return joinMyCodeProcessName("renderer", "main");
  }

  if (normalizedTitle === "Resource Manager") {
    return joinMyCodeProcessName("renderer", "resource-manager");
  }

  const remoteWindowPrefix = "MyCode - ";
  if (normalizedTitle.startsWith(remoteWindowPrefix)) {
    return joinMyCodeProcessName(
      "renderer",
      "remote",
      normalizedTitle.slice(remoteWindowPrefix.length),
    );
  }

  return joinMyCodeProcessName("renderer", normalizedTitle);
}

export function formatMyCodeAgentProcessName(provider: string, workspacePath?: string): string {
  return joinMyCodeProcessName("agent", provider, pickWorkspaceTag(workspacePath));
}

export function formatMyCodeUtilityProcessName(name?: string, type = "utility"): string {
  return joinMyCodeProcessName(type, name);
}
