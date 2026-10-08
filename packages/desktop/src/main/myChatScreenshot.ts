import { clipboard } from "electron";
import { spawn } from "node:child_process";
export async function captureInteractiveScreenshot(): Promise<{
  name: string;
  dataUrl: string;
} | null> {
  if (process.platform === "darwin") {
    const completed = await new Promise<boolean>((resolve, reject) => {
      const child = spawn("/usr/sbin/screencapture", ["-i", "-c"], { stdio: "ignore" });
      child.once("error", reject);
      child.once("close", (code) => resolve(code === 0));
    });
    if (!completed) return null;
  }
  const image = clipboard.readImage();
  return image.isEmpty() ? null : { name: "capture.png", dataUrl: image.toDataURL() };
}
