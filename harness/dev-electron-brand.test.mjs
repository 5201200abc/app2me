import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareDevElectronAppBundle } from "../packages/desktop/scripts/devElectronAppBundle.mjs";

test("the macOS dev app applies and refreshes its product icon without changing Electron", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycode-dev-brand-"));
  try {
    const electronAppPath = join(root, "Electron.app");
    const resources = join(electronAppPath, "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    await mkdir(join(electronAppPath, "Contents", "MacOS"));
    await writeFile(join(electronAppPath, "Contents", "MacOS", "Electron"), "runtime");
    const originalPlist = `<plist><dict><key>CFBundleDisplayName</key><string>Electron</string><key>CFBundleIdentifier</key><string>com.github.Electron</string><key>CFBundleName</key><string>Electron</string><key>CFBundleIconFile</key><string>electron.icns</string></dict></plist>`;
    await writeFile(join(electronAppPath, "Contents", "Info.plist"), originalPlist);
    await writeFile(join(resources, "electron.icns"), "original");
    const iconSourcePath = join(root, "brand.icns");
    await writeFile(iconSourcePath, "first-brand");
    const options = {
      electronAppPath,
      runtimeRoot: join(root, "runtime"),
      electronVersion: "test",
      arch: "arm64",
      iconSourcePath,
    };
    const bundle = await prepareDevElectronAppBundle(options);
    const icon = join(bundle.appPath, "Contents", "Resources", "mycode.icns");
    assert.equal(await readFile(icon, "utf8"), "first-brand");
    assert.match(
      await readFile(join(bundle.appPath, "Contents", "Info.plist"), "utf8"),
      /<key>CFBundleIconFile<\/key>\s*<string>mycode.icns<\/string>/,
    );
    await writeFile(iconSourcePath, "updated-brand");
    await prepareDevElectronAppBundle(options);
    assert.equal(await readFile(icon, "utf8"), "updated-brand");
    assert.equal(
      await readFile(join(electronAppPath, "Contents", "Info.plist"), "utf8"),
      originalPlist,
    );
    assert.equal(await readFile(join(resources, "electron.icns"), "utf8"), "original");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
