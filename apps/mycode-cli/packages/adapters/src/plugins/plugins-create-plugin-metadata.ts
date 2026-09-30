import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CustomCommandRoot,
  HookEventName,
  HookMatcherConfig,
  PluginDiagnostic,
  PluginHookDetail,
  PluginMetadata,
  SkillRoot,
} from "@mycode/contracts";
import { fileExists, isRecord, resolveInside } from "./helpers.js";
import { scanSkillFilesUnderRootSync } from "../skills/scan.js";
import { resolvePluginMcpServers } from "./mcp.js";
import { enumeratePluginComponents } from "./plugin-components.js";
import { normalizeAuthorValue } from "./marketplace.js";
import type { LoadedPlugin, PluginComponents } from "./types.js";
import {
  resolveSkillRoots,
  resolveComponentRoots,
  normalizeGeneratedCommandName,
  trimRelativePrefix,
  stripMarkdownFrontmatter,
} from "./plugins-resolve-skill-roots.js";
import { createHookPluginContext } from "./plugins-node-plugin-adapter-options.js";

export function createPluginMetadata(
  loaded: LoadedPlugin,
  component: PluginComponents,
  dataPath: string,
  enabled: boolean,
  declaredMcpServerNames: string[],
  configuredOptions: Record<string, string | number | boolean>,
): PluginMetadata {
  // manifest 的 author/homepage 作为详情页信息区的回退来源（商店 listing 优先）。
  const author = normalizeAuthorValue(loaded.manifest.author);
  const homepage =
    typeof loaded.manifest.homepage === "string" && loaded.manifest.homepage.trim().length > 0
      ? loaded.manifest.homepage
      : undefined;
  return {
    ...(author?.name ? { author: author.name } : {}),
    ...(author?.url ? { authorUrl: author.url } : {}),
    ...(homepage ? { homepage } : {}),
    commandRootCount: component.commandRoots.length,
    // 详情 UI 过去靠 plugin.skillCount（权威计数）+ 一条 UI 侧 join（按 pluginName 过滤
    // skillsService 结果）拿名称，二者数据源分离。停用插件走 emptyComponents() 使 skillCount=0、
    // 且 UI join 对停用插件不产出名称（skillsService 里 `if (!enabled) continue`），导致：停用时
    // 整个技能分组消失、启用时只有数量没有名称。这里改为对插件根目录做权威枚举（与启用态无关），
    // 直接把名称+描述随 list 下发，UI 不再需要脆弱的 join。
    components: enumeratePluginComponents(loaded.rootPath, loaded.manifest, { loaded }),
    configuredOptions,
    dataPath,
    declaredMcpServerNames,
    description: loaded.manifest.description,
    enabled,
    id: loaded.id,
    manifestPath: loaded.manifestPath,
    marketplace: loaded.marketplace,
    mcpServerNames: Object.keys(component.mcpServers),
    name: loaded.manifest.name,
    hookDetails: component.hookDetails,
    rootPath: loaded.rootPath,
    skillCount: component.skillCount,
    skillRootCount: component.skillRoots.length,
    source: loaded.source,
    userConfig: loaded.manifest.userConfig,
    version: loaded.manifest.version,
  };
}

export function resolveEnabledComponents(input: {
  dataPath: string;
  diagnostics: PluginDiagnostic[];
  env: Record<string, string | undefined>;
  hookDetails: PluginHookDetail[];
  hookEvents: Partial<Record<HookEventName, HookMatcherConfig[]>>;
  loaded: LoadedPlugin;
  mcpServerDefinitions: Record<string, unknown>;
  options: Record<string, string | number | boolean>;
  priority: number;
  workingDirectory: string;
}): PluginComponents {
  mkdirSync(input.dataPath, { recursive: true });

  const skillRoots = resolveSkillRoots(input, input.priority);
  return {
    commandRoots: resolveCommandRoots(input, input.priority + 1),
    hooks: input.hookEvents,
    hookDetails: input.hookDetails,
    mcpServers: resolvePluginMcpServers({
      ...input,
      definitions: input.mcpServerDefinitions,
    }),
    // 插件页要展示真实技能数量。之前只统计 skills root 数，
    // document-skills 这种一个 root 下有多个 SKILL.md 的插件会被显示成 1。
    skillCount: countSkillFiles(skillRoots),
    skillRoots,
  };
}

export function resolveCommandRoots(
  input: { dataPath: string; diagnostics: PluginDiagnostic[]; loaded: LoadedPlugin },
  priority: number,
): CustomCommandRoot[] {
  const roots = resolveComponentRoots<CustomCommandRoot>(
    "commands",
    input,
    priority,
    createHookPluginContext(input.loaded, input.dataPath),
  );
  const generatedRoot = materializeCommandMetadataRoot(input, priority + 1);
  if (generatedRoot) roots.push(generatedRoot);
  return roots;
}

export function countSkillFiles(skillRoots: SkillRoot[]): number {
  // 技能识别规则收敛到共享 scan helper（根自身含
  // SKILL.md 时根自身是一个技能）；同时声明根与
  // 默认 skills/ 根会命中同一个 SKILL.md，必须按文件路径去重，否则计数翻倍。
  // 顺带修正漂移：只认 isDirectory() 会漏掉 symlink 技能子目录，统一 helper 后一并计入。
  // helper 只吞 ENOENT；权限错误（EACCES 等）会抛出，这里按原语义把该根计 0，
  // 真正的 skill_scan_failed 诊断由 skill adapter 在运行时扫描同一目录时发出。
  // 信任边界：这里只消费 plugin roots（resolveSkillRoots 产物），不跟随符号链接。
  const seenFiles = new Set<string>();
  for (const skillRoot of skillRoots) {
    try {
      for (const file of scanSkillFilesUnderRootSync(skillRoot.path, {
        followSymbolicLinks: skillRoot.source !== "plugin",
      })) {
        seenFiles.add(file);
      }
    } catch {
      // 概览计数降级为 0；扫描诊断由 skill adapter 负责。
    }
  }
  return seenFiles.size;
}

export function materializeCommandMetadataRoot(
  input: { dataPath: string; diagnostics: PluginDiagnostic[]; loaded: LoadedPlugin },
  priority: number,
): CustomCommandRoot | null {
  const spec = input.loaded.manifest.commands;
  if (!isRecord(spec)) return null;

  const generatedRoot = join(input.dataPath, "generated-commands");
  let wroteCommand = false;
  mkdirSync(generatedRoot, { recursive: true });

  for (const [rawName, rawMetadata] of Object.entries(spec)) {
    if (!isRecord(rawMetadata)) {
      input.diagnostics.push({
        code: "plugin_manifest_invalid",
        message: `Plugin command metadata must be an object: ${rawName}`,
        path: input.loaded.manifestPath,
        pluginId: input.loaded.id,
        severity: "error",
      });
      continue;
    }

    const name = normalizeGeneratedCommandName(rawName);
    if (!name) {
      input.diagnostics.push({
        code: "plugin_manifest_invalid",
        message: `Invalid plugin command name: ${rawName}`,
        path: input.loaded.manifestPath,
        pluginId: input.loaded.id,
        severity: "error",
      });
      continue;
    }

    const source = typeof rawMetadata.source === "string" ? rawMetadata.source : undefined;
    const content = typeof rawMetadata.content === "string" ? rawMetadata.content : undefined;
    if ((source && content) || (!source && !content)) {
      input.diagnostics.push({
        code: "plugin_manifest_invalid",
        message: `Plugin command '${rawName}' must provide exactly one of source or content`,
        path: input.loaded.manifestPath,
        pluginId: input.loaded.id,
        severity: "error",
      });
      continue;
    }

    let markdown = content;
    if (source) {
      const sourcePath = resolveInside(input.loaded.rootPath, trimRelativePrefix(source));
      if (!sourcePath) {
        input.diagnostics.push({
          code: "plugin_component_path_invalid",
          message: `Plugin command source escapes plugin root: ${source}`,
          path: input.loaded.manifestPath,
          pluginId: input.loaded.id,
          severity: "error",
        });
        continue;
      }
      if (!fileExists(sourcePath)) {
        input.diagnostics.push({
          code: "plugin_component_path_invalid",
          message: `Plugin command source file not found: ${source}`,
          path: sourcePath,
          pluginId: input.loaded.id,
          severity: "error",
        });
        continue;
      }
      markdown = readFileSync(sourcePath, "utf8");
    }
    if (markdown === undefined) continue;

    // 市场清单支持 commands object mapping 和 inline content。
    // MyCode 的 custom command loader 只扫描 markdown 根目录，因此把低风险命令内容
    // materialize 到插件 data 目录；生成路径不在 plugin root 外暴露，也不执行命令本身。
    writeFileSync(
      join(generatedRoot, `${name}.md`),
      applyCommandMetadataFrontmatter(markdown, rawMetadata),
      "utf8",
    );
    wroteCommand = true;
  }

  return wroteCommand
    ? {
        path: generatedRoot,
        plugin: createHookPluginContext(input.loaded, input.dataPath),
        priority,
        scope: input.loaded.source === "official" ? "system" : "user",
        source: "plugin",
      }
    : null;
}

export function applyCommandMetadataFrontmatter(
  markdown: string,
  metadata: Record<string, unknown>,
): string {
  const frontmatter = new Map<string, string>();
  if (typeof metadata.description === "string" && metadata.description.trim()) {
    frontmatter.set("description", metadata.description.trim());
  }
  if (typeof metadata.argumentHint === "string" && metadata.argumentHint.trim()) {
    frontmatter.set("argument-hint", metadata.argumentHint.trim());
  }
  if (typeof metadata.model === "string" && metadata.model.trim()) {
    frontmatter.set("model", metadata.model.trim());
  }
  if (Array.isArray(metadata.allowedTools)) {
    const allowedTools = metadata.allowedTools
      .filter((tool): tool is string => typeof tool === "string" && tool.trim().length > 0)
      .map((tool) => tool.trim());
    if (allowedTools.length > 0) frontmatter.set("allowed-tools", allowedTools.join(", "));
  }
  if (frontmatter.size === 0) return markdown;
  const body = stripMarkdownFrontmatter(markdown).trimStart();
  return `---\n${Array.from(frontmatter, ([key, value]) => `${key}: ${value}`).join("\n")}\n---\n\n${body}`;
}

export function emptyComponents(hookDetails: PluginHookDetail[] = []): PluginComponents {
  return {
    commandRoots: [],
    hooks: {},
    hookDetails,
    mcpServers: {},
    skillCount: 0,
    skillRoots: [],
  };
}
