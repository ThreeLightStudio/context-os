import ContextVoiceCapture
import Darwin
import Foundation

func argument(_ name: String, default defaultValue: String? = nil) -> String? {
    let args = CommandLine.arguments
    guard let index = args.firstIndex(of: name), args.indices.contains(index + 1) else { return defaultValue }
    return args[index + 1]
}

guard let socketPath = argument("--socket"),
      let whisperCLI = argument("--whisper-cli"),
      let modelPath = argument("--model") else {
    fputs("Usage: context-voice-capture --socket PATH --whisper-cli PATH --model PATH\n", stderr)
    exit(EXIT_FAILURE)
}

let socketDirectory = URL(fileURLWithPath: socketPath).deletingLastPathComponent()
try? FileManager.default.createDirectory(at: socketDirectory, withIntermediateDirectories: true)
unlink(socketPath)

let serverFD = socket(AF_UNIX, SOCK_STREAM, 0)
guard serverFD >= 0 else { fatalError("Could not create voice capture socket") }
defer {
    close(serverFD)
    unlink(socketPath)
}

var address = sockaddr_un()
address.sun_family = sa_family_t(AF_UNIX)
withUnsafeMutablePointer(to: &address.sun_path) { pathPointer in
    pathPointer.withMemoryRebound(to: CChar.self, capacity: MemoryLayout.size(ofValue: address.sun_path)) { destination in
        let bytes = Array(socketPath.utf8)
        for index in 0..<min(bytes.count, MemoryLayout.size(ofValue: address.sun_path) - 1) {
            destination[index] = CChar(bytes[index])
        }
    }
}

let addressLength = socklen_t(MemoryLayout<sockaddr_un>.size)
let bindResult = withUnsafePointer(to: &address) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(serverFD, $0, addressLength) }
}
guard bindResult == 0, listen(serverFD, 8) == 0 else { fatalError("Could not bind voice capture socket") }
chmod(socketPath, 0o600)

let service = VoiceService(transcriber: WhisperCppTranscriber(executablePath: whisperCLI, modelPath: modelPath))
let encoder = JSONEncoder()
let decoder = JSONDecoder()

@Sendable func writeResponse(_ response: VoiceResponse, to fd: Int32) {
    guard var data = try? encoder.encode(response) else { return }
    data.append(0x0A)
    data.withUnsafeBytes { bytes in
        _ = write(fd, bytes.baseAddress, bytes.count)
    }
}

while true {
    let clientFD = accept(serverFD, nil, nil)
    guard clientFD >= 0 else { continue }
    DispatchQueue.global(qos: .userInitiated).async {
        defer { close(clientFD) }
        var requestData = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while requestData.count <= 256 * 1024 {
            let readCount = read(clientFD, &buffer, buffer.count)
            if readCount <= 0 { break }
            requestData.append(contentsOf: buffer[0..<readCount])
            if requestData.contains(0x0A) { break }
        }
        guard let line = requestData.firstIndex(of: 0x0A).map({ requestData.prefix(upTo: $0) }),
              let request = try? decoder.decode(VoiceRequest.self, from: line) else {
            writeResponse(VoiceResponse(ok: false, state: "error", bufferedSeconds: 0, error: "Invalid request."), to: clientFD)
            return
        }
        writeResponse(service.handle(request), to: clientFD)
    }
}
