import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyEarlyDataBaseDirBootstrap } from "./desktopDataBaseDirBootstrap.js";
import { setDataBaseDir } from "@mycode/services/node";

test("隔离桌面从显式 home 引导数据目录，不读取真实 home 的启动设置", async () => {
  const isolatedHome = await mkdtemp(join(tmpdir(), "mychat-bootstrap-"));
  const original = process.env.MYCODE_DESKTOP_HOME_DIR;
  try {
    process.env.MYCODE_DESKTOP_HOME_DIR = isolatedHome;
    const directory = join(isolatedHome, ".mycode", "v2");
    await mkdir(directory, { recursive: true });
    const data = join(isolatedHome, "data");
    await writeFile(join(directory, "setting.json"), JSON.stringify({ dataBaseDir: data }));
    assert.equal(applyEarlyDataBaseDirBootstrap(), data);
  } finally {
    if (original === undefined) delete process.env.MYCODE_DESKTOP_HOME_DIR;
    else process.env.MYCODE_DESKTOP_HOME_DIR = original;
    setDataBaseDir(null);
    await rm(isolatedHome, { recursive: true, force: true });
  }
});
