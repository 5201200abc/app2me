import { access, cp, mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

// 开发只暂存 JS 会丢失插件内容；开发与打包必须在同一入口复制并校验这些资源。
const browserUseRequiredRuntimePaths = [
  "scripts/browser-client.mjs",
  "docs/api.json",
  "docs/documents.json",
  "docs/overview.md",
  // documents.json 已暴露 recording lookup，桌面安装包不能复用缺少正文的 runtime。
  "docs/recording.md",
  "docs/workflow.md",
  "skills/control-browser/SKILL.md",
  "skills/web-gui-tester/SKILL.md",
];
export const officialPluginPackages = [
  {
    packageName: "@mycode/cua-driver-plugin",
    relativePath: "packages/cua-driver-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["docs/computer-use.md", "skills/computer-use/SKILL.md"],
    stagedPath: "packages/cua-driver-plugin",
  },
  {
    // browser-use 只携带自己的 client script 与 skill/docs；node_repl MCP runtime 归
    // @mycode/node-repl-host（见上方常量注释）。
    packageName: "@mycode/browser-use-plugin",
    relativePath: "apps/mycode-cli/packages/browser-use-plugin",
    requiresRuntime: true,
    requiredRuntimePaths: browserUseRequiredRuntimePaths,
    runtimeBuildScript: "scripts/build.mjs",
    stagedPath: "packages/browser-use-plugin",
  },

  {
    // Browser Use 的 node_repl 宿主没有 listing，但首启 seed 仍需要它的 dist runtime。
    // 原生 Computer Use 的 runtime 由 Main 持有，不经过这个宿主。
    packageName: "@mycode/node-repl-host",
    relativePath: "apps/mycode-cli/packages/node-repl-host",
    requiresRuntime: true,
    requiredRuntimePaths: ["dist/mcp/server.js"],
    runtimeBuildScript: "scripts/build.mjs",
    stagedPath: "packages/node-repl-host",
  },
];
// 随 CLI 内置的技能包（不是插件）：bootstrap 的 resolveBundledSkillRoots 沿官方插件同款候选目录
// 在 mycode.cjs 旁找 packages/bundled-skills 并原地读取。漏 stage 它，桌面包的 /workflow 会展开成
// 「先加载 dynamic-workflows 技能」而技能文件不存在，因此必须随 Agent 一起打包。
const bundledSkillPack = {
  relativePath: "apps/mycode-cli/packages/bundled-skills",
  requiredPaths: [
    "skills/dynamic-workflows/SKILL.md",
    "skills/dynamic-workflows/patterns.md",
    "skills/dynamic-workflows/examples.md",
  ],
  stagedPath: "packages/bundled-skills",
  topLevelPaths: ["skills"],
};
const includedOfficialPluginTopLevelPaths = new Set([
  ".mcp.json",
  ".mycode-plugin",
  "README.md",
  // Electron 生产资源复制有独立白名单，遗漏 agents 会让首启 filesystem seed 永久缺少子代理。
  "agents",
  "commands",
  "dist",
  "docs",
  "hooks",
  "output-styles",
  "package.json",
  "scripts",
  "skills",
  "templates",
]);
const excludedOfficialPluginAssetNames = new Set([
  ".DS_Store",
  ".venv",
  "__pycache__",
  "node_modules",
]);

function shouldCopyOfficialPluginAsset(sourcePath) {
  const name = basename(sourcePath);
  return !excludedOfficialPluginAssetNames.has(name) && !name.endsWith(".pyc");
}

export async function validateAgentAssets(repoRoot) {
  for (const plugin of officialPluginPackages) {
    for (const relativePath of [
      ".mycode-plugin/plugin.json",
      ...(plugin.requiredRuntimePaths ?? []),
      ...(plugin.requiredSeedPaths ?? []),
    ]) {
      await access(resolve(repoRoot, plugin.relativePath, relativePath));
    }
  }
  for (const relativePath of bundledSkillPack.requiredPaths) {
    await access(resolve(repoRoot, bundledSkillPack.relativePath, relativePath));
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function stageAgentAssets({ repoRoot, glmDir, log = console.log }) {
  for (const plugin of officialPluginPackages) {
    const sourceRoot = resolve(repoRoot, plugin.relativePath);
    const targetRoot = resolve(glmDir, plugin.stagedPath);
    await mkdir(targetRoot, { recursive: true });
    for (const entryName of includedOfficialPluginTopLevelPaths) {
      const sourcePath = resolve(sourceRoot, entryName);
      if (!(await exists(sourcePath))) continue;
      await cp(sourcePath, resolve(targetRoot, entryName), {
        recursive: true,
        filter: shouldCopyOfficialPluginAsset,
      });
    }
    log(`[stage:agent-bundle] staged official plugin ${plugin.stagedPath}`);
  }
  const sourceRoot = resolve(repoRoot, bundledSkillPack.relativePath);
  const targetRoot = resolve(glmDir, bundledSkillPack.stagedPath);
  await mkdir(targetRoot, { recursive: true });
  for (const entryName of bundledSkillPack.topLevelPaths) {
    await cp(resolve(sourceRoot, entryName), resolve(targetRoot, entryName), {
      recursive: true,
      filter: shouldCopyOfficialPluginAsset,
    });
  }
  log(`[stage:agent-bundle] staged bundled skill pack ${bundledSkillPack.stagedPath}`);
}
