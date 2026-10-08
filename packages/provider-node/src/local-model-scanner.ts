import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { isQwen38Model, localModelReasoning, type LocalModelScanResult } from "@mycode/provider";

export function getDefaultLocalModelsDirectory(): string {
  return join(homedir(), "models");
}

interface ModelFile {
  path: string;
  size: number;
}
const ignoredDirectories = new Set(["node_modules", ".cache", "websearch", "logs", ".git"]);
const shardPattern = /-(\d{5})-of-(\d{5})\.gguf$/i;

export async function discoverLocalModels(customDir?: string): Promise<LocalModelScanResult> {
  const modelsDir = customDir?.trim() || getDefaultLocalModelsDirectory();
  const warnings: string[] = [];
  const files: ModelFile[] = [];
  const visited = new Set<string>();
  let directoryExists = true;
  async function walk(path: string, depth: number): Promise<void> {
    if (depth > 8) {
      warnings.push(`Directory depth exceeded: ${path}`);
      return;
    }
    let resolved: string;
    try {
      resolved = await realpath(path);
    } catch (error) {
      if (path === modelsDir && (error as NodeJS.ErrnoException).code === "ENOENT") {
        directoryExists = false;
        return;
      }
      warnings.push(`Cannot read: ${path}`);
      return;
    }
    if (visited.has(resolved)) return;
    visited.add(resolved);
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      warnings.push(`Cannot list: ${path}`);
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignoredDirectories.has(entry.name)) continue;
      const full = join(path, entry.name);
      try {
        const info = await stat(full);
        if (info.isDirectory()) await walk(full, depth + 1);
        else if (info.isFile() && /\.gguf$/i.test(entry.name))
          files.push({ path: full, size: info.size });
      } catch {
        warnings.push(`Cannot inspect: ${full}`);
      }
    }
  }
  await walk(modelsDir, 0);
  const candidates = files.filter(
    (file) =>
      !/mmproj/i.test(basename(file.path)) &&
      (!shardPattern.test(file.path) || file.path.match(shardPattern)?.[1] === "00001"),
  );
  const byPath = new Map(files.map((file) => [file.path, file]));
  const models: LocalModelScanResult["models"] = [];
  for (const file of candidates) {
    const shard = file.path.match(shardPattern);
    let sizeBytes = file.size;
    if (shard) {
      const count = Number(shard[2]);
      const parts = Array.from({ length: count }, (_, index) =>
        byPath.get(
          file.path.replace(
            shardPattern,
            `-${String(index + 1).padStart(5, "0")}-of-${shard[2]}.gguf`,
          ),
        ),
      );
      if (count < 1 || parts.some((part) => !part)) {
        warnings.push(`Incomplete model shards: ${file.path}`);
        continue;
      }
      sizeBytes = parts.reduce((total, part) => total + part!.size, 0);
    }
    const parent = dirname(file.path);
    const parentId = relative(modelsDir, parent).split(/[/\\]/).join("/");
    const stem = basename(file.path)
      .replace(/\.gguf$/i, "")
      .replace(/-\d{5}-of-\d{5}$/i, "");
    // 单模型目录沿用 llama router 的目录 ID；多量化文件必须保留独立身份。
    const sameDirectory = candidates.filter((candidate) => dirname(candidate.path) === parent);
    const id =
      parentId && sameDirectory.length === 1 ? parentId : parentId ? `${parentId}/${stem}` : stem;
    const name = parentId && sameDirectory.length === 1 ? parentId : stem;
    // 目录只是用户分类，不能让放在 Qwen 目录下的其他模型获得三档思考。
    const capabilityName = stem;
    const reasoning = localModelReasoning(capabilityName);
    const mmprojPath =
      files.find(
        (candidate) =>
          dirname(candidate.path) === parent && /mmproj/i.test(basename(candidate.path)),
      )?.path ?? null;
    models.push({
      id,
      name,
      path: file.path,
      mmprojPath,
      sizeBytes,
      vision: Boolean(mmprojPath),
      // Qwen3.8-27B 的 GGUF context_length 为 262144，不能继承通用 500K 声明。
      ...(isQwen38Model(capabilityName) ? { contextWindow: 262_144 } : {}),
      reasoningControl: isQwen38Model(capabilityName) ? "effort" : "toggle",
      reasoningLevels: reasoning.values,
      defaultReasoningLevel: reasoning.values.at(-1)!,
      reasoningCelMap: reasoning.map,
    });
  }
  return { modelsDir, directoryExists, models, warnings };
}
