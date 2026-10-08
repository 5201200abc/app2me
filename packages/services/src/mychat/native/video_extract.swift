import AVFoundation
import CoreGraphics
import ImageIO
import Foundation

struct VideoResult: Codable {
    let duration: Double
    let fps: Double
    let frames: [String]
    let timestamps: [Double]
}

guard CommandLine.arguments.count > 1 else {
    print("{\"duration\":0,\"fps\":1,\"frames\":[],\"timestamps\":[]}")
    exit(0)
}

let filePath = CommandLine.arguments[1]
let maxFrames = CommandLine.arguments.count > 2 ? (Int(CommandLine.arguments[2]) ?? 32) : 32
let targetFps = CommandLine.arguments.count > 3 ? (Double(CommandLine.arguments[3]) ?? 1.0) : 1.0
let fileURL = URL(fileURLWithPath: filePath)

let asset = AVURLAsset(url: fileURL)
let durationSeconds = CMTimeGetSeconds(asset.duration)

guard durationSeconds > 0 && !durationSeconds.isNaN else {
    print("{\"duration\":0,\"fps\":1,\"frames\":[],\"timestamps\":[]}")
    exit(0)
}

let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.maximumSize = CGSize(width: 768, height: 768)

let totalNeeded = max(1, Int(ceil(durationSeconds * targetFps)))
var samplePoints: [Double] = []

if totalNeeded <= maxFrames {
    for i in 0..<totalNeeded {
        let sec = min(Double(i) / targetFps, max(0, durationSeconds - 0.05))
        samplePoints.append(sec)
    }
} else {
    for i in 0..<maxFrames {
        let sec = durationSeconds * Double(i) / Double(maxFrames - 1)
        samplePoints.append(sec)
    }
}

var base64Frames: [String] = []
var extractedTimestamps: [Double] = []

for sec in samplePoints {
    let time = CMTime(seconds: sec, preferredTimescale: 600)
    if let cgImage = try? generator.copyCGImage(at: time, actualTime: nil) {
        let mutableData = CFDataCreateMutable(nil, 0)!
        if let destination = CGImageDestinationCreateWithData(mutableData, "public.jpeg" as CFString, 1, nil) {
            let options: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: 0.75]
            CGImageDestinationAddImage(destination, cgImage, options as CFDictionary)
            if CGImageDestinationFinalize(destination) {
                let data = mutableData as Data
                let b64 = "data:image/jpeg;base64," + data.base64EncodedString()
                base64Frames.append(b64)
                extractedTimestamps.append((sec * 10).rounded() / 10.0)
            }
        }
    }
}

let result = VideoResult(
    duration: durationSeconds,
    fps: targetFps,
    frames: base64Frames,
    timestamps: extractedTimestamps
)

if let jsonData = try? JSONEncoder().encode(result), let jsonStr = String(data: jsonData, encoding: .utf8) {
    print(jsonStr)
} else {
    print("{\"duration\":0,\"fps\":1,\"frames\":[],\"timestamps\":[]}")
}
