// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "context-voice-capture",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "ContextVoiceCapture", targets: ["ContextVoiceCapture"]),
        .executable(name: "context-voice-capture", targets: ["ContextVoiceCaptureCLI"]),
    ],
    targets: [
        .target(name: "ContextVoiceCapture"),
        .executableTarget(name: "ContextVoiceCaptureCLI", dependencies: ["ContextVoiceCapture"]),
        .testTarget(name: "ContextVoiceCaptureTests", dependencies: ["ContextVoiceCapture"]),
    ]
)
