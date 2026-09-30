// ============================================================
// Node Skill Adapter
// ============================================================

import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type {
  SkillContent,
  SkillDiagnostic,
  SkillLoadOutcome,
  SkillMetadata,
  SkillOperationOptions,
  SkillPort,
  SkillRoot,
} from "@mycode/contracts";
import { resolveDefaultSkillRoots } from "./roots.js";
import { scanSkillFilesUnderRoot } from "./scan.js";
import {
  type NodeSkillAdapterOptions,
  safeRealpathSync,
  throwIfAborted,
  matchesSkillRequest,
  DEFAULT_MAX_SKILL_BYTES,
  readFirstBytes,
  stripFrontmatter,
  isNotFoundError,
  extractFrontmatter,
  parseFlatYaml,
  parseScalar,
  MAX_DESCRIPTION_LENGTH,
  SAFE_FRONTMATTER_KEYS,
  readPluginNameForSkillRoot,
} from "./skills-node-skill-adapter-options.js";

export class NodeSkillAdapter implements SkillPort {
  private readonly disabledPaths: ReadonlySet<string>;
  private readonly pluginNameBySkillRoot = new Map<string, Promise<string | undefined>>();

  constructor(private readonly options: NodeSkillAdapterOptions = {}) {
    this.disabledPaths = new Set(
      Array.from(options.disabledPaths ?? []).flatMap((path) => {
        const resolvedPath = resolve(path);
        const canonicalPath = safeRealpathSync(resolvedPath);
        return canonicalPath && canonicalPath !== resolvedPath
          ? [resolvedPath, canonicalPath]
          : [resolvedPath];
      }),
    );
  }

  async discoverSkills(
    request: { workingDirectory: string; roots?: SkillRoot[] },
    options?: SkillOperationOptions,
  ): Promise<SkillLoadOutcome> {
    throwIfAborted(options);

    const workingDirectory = resolve(request.workingDirectory);
    const roots = request.roots ?? (await resolveDefaultSkillRoots(workingDirectory, this.options));
    const diagnostics: SkillDiagnostic[] = [];
    const selected = new Map<string, SkillMetadata>();
    let totalDiscovered = 0;

    for (const root of roots.toSorted((a, b) => a.priority - b.priority)) {
      throwIfAborted(options);
      const skillPaths = await this.skillFilesUnderRoot(root, diagnostics);
      for (const path of skillPaths) {
        throwIfAborted(options);
        const parsed = await this.parseSkill(path, root, diagnostics);
        if (!parsed) continue;
        if (await this.isDisabledSkillPath(parsed.path)) continue;
        totalDiscovered++;
        // 同名技能可能来自不同技能生态或版本，不能只按 name 去重；路径才是安装项身份。
        if (selected.has(parsed.path)) {
          continue;
        }
        selected.set(parsed.path, parsed);
      }
    }

    return {
      skills: Array.from(selected.values()).toSorted((a, b) => a.name.localeCompare(b.name)),
      diagnostics,
      totalDiscovered,
    };
  }

  async loadSkill(
    request: { name: string; workingDirectory: string; roots?: SkillRoot[]; maxBytes?: number },
    options?: SkillOperationOptions,
  ): Promise<SkillContent> {
    throwIfAborted(options);

    const outcome = await this.discoverSkills(
      {
        workingDirectory: request.workingDirectory,
        roots: request.roots,
      },
      options,
    );
    const metadata = outcome.skills.find((skill) => matchesSkillRequest(skill, request.name));
    if (!metadata) {
      throw new Error(`Skill not found: ${request.name}`);
    }

    const maxBytes = request.maxBytes ?? DEFAULT_MAX_SKILL_BYTES;
    const info = await stat(metadata.path);
    const truncated = info.size > maxBytes;
    const buffer = truncated
      ? await readFirstBytes(metadata.path, maxBytes)
      : await readFile(metadata.path);
    const rawContent = buffer.toString("utf8");
    const content = stripFrontmatter(rawContent).trim();

    return {
      metadata,
      content,
      baseDirectory: metadata.directory,
      bytesRead: buffer.byteLength,
      sizeBytes: info.size,
      truncated,
    };
  }

  private async skillFilesUnderRoot(
    skillRoot: SkillRoot,
    diagnostics: SkillDiagnostic[],
  ): Promise<string[]> {
    try {
      // manifest 的 skills 项既可指向单个技能目录，也可指向包含多个技能的根目录。
      // 共享 scan helper 会检查根自身的 SKILL.md，再扫描一层子目录，排除策略与桌面端一致。
      // 信任边界：plugin-scope 内容不可信，不跟随符号链接（目录级与文件级逃逸
      // 一并拒绝）；用户级根保持跟随，symlink 技能导入能力不变。
      return await scanSkillFilesUnderRoot(skillRoot.path, {
        followSymbolicLinks: skillRoot.source !== "plugin",
      });
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }
      diagnostics.push({
        code: "skill_scan_failed",
        severity: "warning",
        message:
          error instanceof Error ? error.message : `Failed to scan skill root: ${skillRoot.path}`,
        path: skillRoot.path,
      });
      return [];
    }
  }

  private async parseSkill(
    path: string,
    root: SkillRoot,
    diagnostics: SkillDiagnostic[],
  ): Promise<SkillMetadata | null> {
    let rawContent: string;
    try {
      rawContent = await readFile(path, "utf8");
    } catch (error) {
      if (isNotFoundError(error)) return null;
      diagnostics.push({
        code: "skill_read_failed",
        severity: "warning",
        message: error instanceof Error ? error.message : `Failed to read skill: ${path}`,
        path,
      });
      return null;
    }

    const frontmatter = extractFrontmatter(rawContent);
    // 无 frontmatter 的手写 skill 仍可按目录名加载，避免设置页/CLI 出现无修复价值的错误。
    const parsed = frontmatter
      ? parseFlatYaml(frontmatter, path, diagnostics)
      : { values: {}, keys: [] };
    const name =
      parseScalar(parsed.values.name) ?? (frontmatter ? undefined : basename(dirname(path)));
    if (!name) {
      diagnostics.push({
        code: "skill_missing_name",
        severity: "error",
        message: `Skill frontmatter must include a name: ${path}`,
        path,
      });
      return null;
    }
    const rawDescription = parseScalar(parsed.values.description);
    if (!rawDescription && frontmatter) {
      diagnostics.push({
        code: "skill_missing_description",
        severity: "error",
        message: `Skill frontmatter must include a description: ${path}`,
        path,
        skillName: name,
      });
      return null;
    }
    const description = rawDescription ?? "";
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      diagnostics.push({
        code: "skill_description_too_long",
        severity: "error",
        message: `Skill description is too long: ${name}`,
        path,
        skillName: name,
      });
      return null;
    }

    // 第三方/旧版 skill 常带 version、homepage 等扩展字段。
    // 这些字段不影响加载，不再作为 warning 暴露，只保留 safeToAutoLoad 的保守判断。
    const pluginAlias = await this.resolvePluginSkillAlias(name, root);

    return {
      name,
      description,
      whenToUse: parseScalar(parsed.values.when_to_use),
      ...pluginAlias,
      path,
      directory: dirname(path),
      rootPath: root.path,
      scope: root.scope,
      source: root.source,
      safeToAutoLoad: parsed.keys.every((key) => SAFE_FRONTMATTER_KEYS.has(key)),
      frontmatterKeys: parsed.keys,
      policy: {
        allowImplicitInvocation: true,
      },
    };
  }

  private async isDisabledSkillPath(path: string): Promise<boolean> {
    const resolvedPath = resolve(path);
    if (this.disabledPaths.has(resolvedPath)) {
      return true;
    }
    const canonicalPath = await realpath(resolvedPath).catch(() => resolvedPath);
    // UI 可能把 symlink 目标真实路径写入 config，而 agent 从 ~/.mycode/skills 的链接路径扫描。
    // 同时比对扫描路径和真实路径，避免同一个 SKILL.md 因路径形态不同绕过禁用开关。
    return this.disabledPaths.has(canonicalPath);
  }

  private async resolvePluginSkillAlias(
    skillName: string,
    root: SkillRoot,
  ): Promise<Pick<SkillMetadata, "pluginId" | "pluginName" | "qualifiedName"> | undefined> {
    if (root.source !== "plugin") return undefined;
    const pluginName = await this.resolvePluginName(root.path);
    if (!pluginName) return undefined;

    return {
      ...(root.pluginId ? { pluginId: root.pluginId } : {}),
      pluginName,
      qualifiedName: `${pluginName}:${skillName}`,
    };
  }

  private async resolvePluginName(skillRootPath: string): Promise<string | undefined> {
    const resolvedRoot = resolve(skillRootPath);
    let cached = this.pluginNameBySkillRoot.get(resolvedRoot);
    if (!cached) {
      cached = readPluginNameForSkillRoot(resolvedRoot);
      this.pluginNameBySkillRoot.set(resolvedRoot, cached);
    }
    return cached;
  }
}

export function createNodeSkillAdapter(options: NodeSkillAdapterOptions = {}): NodeSkillAdapter {
  return new NodeSkillAdapter(options);
}

export type { NodeSkillAdapterOptions } from "./skills-node-skill-adapter-options.js";
