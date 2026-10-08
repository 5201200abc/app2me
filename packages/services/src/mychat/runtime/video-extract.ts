import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const exists = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
import { join } from "node:path";

export async function extractVideoFramesNative(
  filePath: string,
  maxFrames = 32,
  targetFps = 1.0,
): Promise<{ duration: number; fps: number; frames: string[]; timestamps?: number[] }> {
  if (!filePath || !(await exists(filePath)))
    return { duration: 0, fps: 1, frames: [], timestamps: [] };

  const binaryPaths = [
    ...(process.env.MYCODE_MYCHAT_VIDEO_EXTRACTOR
      ? [process.env.MYCODE_MYCHAT_VIDEO_EXTRACTOR]
      : []),
    fileURLToPath(new URL("../native/mychat-video-extract", import.meta.url)),
    join(process.cwd(), "packages/services/src/mychat/native/mychat-video-extract"),
  ];
  const binary = (
    await Promise.all(binaryPaths.map(async (path) => ((await exists(path)) ? path : null)))
  ).find(Boolean);

  if (binary) {
    return new Promise((resolve) => {
      execFile(
        binary,
        [filePath, String(maxFrames), String(targetFps)],
        { maxBuffer: 60 * 1024 * 1024 },
        (err, stdout) => {
          if (err || !stdout) {
            resolve({ duration: 0, fps: targetFps, frames: [], timestamps: [] });
            return;
          }
          try {
            const parsed = JSON.parse(stdout.trim()) as {
              duration?: number;
              fps?: number;
              frames?: string[];
              timestamps?: number[];
            };
            resolve({
              duration: parsed.duration || 0,
              fps: parsed.fps || targetFps,
              frames: parsed.frames || [],
              timestamps: parsed.timestamps || [],
            });
          } catch {
            resolve({ duration: 0, fps: targetFps, frames: [], timestamps: [] });
          }
        },
      );
    });
  }

  if (process.platform === "darwin" && (await exists("/usr/bin/swift"))) {
    const swiftCode = `
import AVFoundation; import CoreGraphics; import ImageIO; import Foundation
let asset = AVURLAsset(url: URL(fileURLWithPath: "${filePath.replace(/"/g, '\\"')}"))
let dur = CMTimeGetSeconds(asset.duration)
guard dur > 0 && !dur.isNaN else { print("{\\"duration\\":0,\\"fps\\":1,\\"frames\\":[],\\"timestamps\\":[]}"); exit(0) }
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true; gen.maximumSize = CGSize(width: 768, height: 768)
let totalNeeded = max(1, Int(ceil(dur * ${targetFps})))
var samplePoints: [Double] = []
if totalNeeded <= ${maxFrames} {
    for i in 0..<totalNeeded { samplePoints.append(min(Double(i) / ${targetFps}, max(0, dur - 0.05))) }
} else {
    for i in 0..<${maxFrames} { samplePoints.append(dur * Double(i) / Double(${maxFrames} - 1)) }
}
var frames: [String] = []
var timestamps: [Double] = []
for sec in samplePoints {
  let time = CMTime(seconds: sec, preferredTimescale: 600)
  if let cg = try? gen.copyCGImage(at: time, actualTime: nil) {
    let mut = CFDataCreateMutable(nil, 0)!
    if let dest = CGImageDestinationCreateWithData(mut, "public.jpeg" as CFString, 1, nil) {
      CGImageDestinationAddImage(dest, cg, [kCGImageDestinationLossyCompressionQuality: 0.75] as CFDictionary)
      if CGImageDestinationFinalize(dest) {
        frames.append("data:image/jpeg;base64," + (mut as Data).base64EncodedString())
        timestamps.append((sec * 10).rounded() / 10.0)
      }
    }
  }
}
let res = "{\\"duration\\":\\(dur),\\"fps\\":${targetFps},\\"frames\\":[" + frames.map { "\\"" + $0 + "\\"" }.joined(separator: ",") + "],\\"timestamps\\":[" + timestamps.map { String($0) }.joined(separator: ",") + "]}"
print(res)
`;
    return new Promise((resolve) => {
      execFile(
        "/usr/bin/swift",
        ["-e", swiftCode],
        { maxBuffer: 60 * 1024 * 1024 },
        (err, stdout) => {
          if (err || !stdout) {
            resolve({ duration: 0, fps: targetFps, frames: [], timestamps: [] });
            return;
          }
          try {
            const parsed = JSON.parse(stdout.trim()) as {
              duration?: number;
              fps?: number;
              frames?: string[];
              timestamps?: number[];
            };
            resolve({
              duration: parsed.duration || 0,
              fps: parsed.fps || targetFps,
              frames: parsed.frames || [],
              timestamps: parsed.timestamps || [],
            });
          } catch {
            resolve({ duration: 0, fps: targetFps, frames: [], timestamps: [] });
          }
        },
      );
    });
  }

  return { duration: 0, fps: 1, frames: [], timestamps: [] };
}
