@preconcurrency import AVFoundation
import Foundation

public enum VoiceCaptureError: LocalizedError, Equatable {
    case permissionDenied
    case permissionRequired
    case noAudio
    case transcriptionFailed(String)
    case jobNotFound
    case jobNotReady

    public var errorDescription: String? {
        switch self {
        case .permissionDenied: return "Microphone permission was denied."
        case .permissionRequired: return "Microphone permission is required."
        case .noAudio: return "The voice buffer is empty."
        case .transcriptionFailed(let message): return message
        case .jobNotFound: return "Transcription job not found."
        case .jobNotReady: return "Transcription is not complete yet."
        }
    }
}

public struct AudioRingBuffer: Sendable {
    public let sampleRate: Int
    public let chunkDurationSeconds: Int
    public let maxDurationSeconds: Int

    private var chunks: [[Int16]] = []
    private var pending: [Int16] = []

    public init(sampleRate: Int = 16_000, chunkDurationSeconds: Int = 30, maxDurationSeconds: Int = 15 * 60) {
        self.sampleRate = sampleRate
        self.chunkDurationSeconds = chunkDurationSeconds
        self.maxDurationSeconds = maxDurationSeconds
    }

    public var bufferedSampleCount: Int {
        chunks.reduce(0) { $0 + $1.count } + pending.count
    }

    public var bufferedSeconds: Double {
        Double(bufferedSampleCount) / Double(sampleRate)
    }

    public mutating func append(_ samples: [Int16]) {
        guard !samples.isEmpty else { return }
        pending.append(contentsOf: samples)
        let chunkSize = sampleRate * chunkDurationSeconds
        while pending.count >= chunkSize {
            chunks.append(Array(pending.prefix(chunkSize)))
            pending.removeFirst(chunkSize)
        }
        let maxChunks = max(1, maxDurationSeconds / chunkDurationSeconds)
        while chunks.count > maxChunks {
            chunks.removeFirst()
        }
        let maxSamples = sampleRate * maxDurationSeconds
        if bufferedSampleCount > maxSamples {
            let overflow = bufferedSampleCount - maxSamples
            discardOldestSamples(overflow)
        }
    }

    public mutating func clear() {
        chunks.removeAll(keepingCapacity: true)
        pending.removeAll(keepingCapacity: true)
    }

    public func snapshot() -> [Int16] {
        chunks.flatMap { $0 } + pending
    }

    private mutating func discardOldestSamples(_ count: Int) {
        var remaining = count
        while remaining > 0, !chunks.isEmpty {
            if chunks[0].count <= remaining {
                remaining -= chunks[0].count
                chunks.removeFirst()
            } else {
                chunks[0].removeFirst(remaining)
                remaining = 0
            }
        }
        if remaining > 0 {
            pending.removeFirst(min(remaining, pending.count))
        }
    }
}

public struct TranscriptSegment: Codable, Equatable, Sendable {
    public let startMs: Int
    public let endMs: Int
    public let text: String

    public init(startMs: Int, endMs: Int, text: String) {
        self.startMs = startMs
        self.endMs = endMs
        self.text = text
    }
}

public struct VoiceTranscript: Codable, Equatable, Sendable {
    public let text: String
    public let segments: [TranscriptSegment]

    public init(text: String, segments: [TranscriptSegment]) {
        self.text = text
        self.segments = segments
    }
}

public struct WhisperCppTranscriber: Sendable {
    public let executablePath: String
    public let modelPath: String

    public init(executablePath: String, modelPath: String) {
        self.executablePath = executablePath
        self.modelPath = modelPath
    }

    public static func clearTemporaryFiles() {
        let directory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for file in files where file.lastPathComponent.hasPrefix("context-voice-") {
            try? FileManager.default.removeItem(at: file)
        }
    }

    public func transcribe(samples: [Int16], sampleRate: Int = 16_000) throws -> VoiceTranscript {
        guard !samples.isEmpty else { throw VoiceCaptureError.noAudio }
        let temporaryDirectory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        let id = UUID().uuidString
        let wavURL = temporaryDirectory.appendingPathComponent("context-voice-\(id).wav")
        let outputURL = temporaryDirectory.appendingPathComponent("context-voice-\(id)")
        let jsonURL = outputURL.appendingPathExtension("json")
        defer {
            try? FileManager.default.removeItem(at: wavURL)
            try? FileManager.default.removeItem(at: jsonURL)
            try? FileManager.default.removeItem(at: outputURL.appendingPathExtension("txt"))
        }

        try Self.writeWav(samples: samples, sampleRate: sampleRate, to: wavURL)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executablePath)
        process.arguments = [
            "-m", modelPath,
            "-f", wavURL.path,
            "-oj",
            "-of", outputURL.path,
            "-l", "auto",
            "-nt",
        ]
        let errorPipe = Pipe()
        process.standardError = errorPipe
        do {
            try process.run()
        } catch {
            throw VoiceCaptureError.transcriptionFailed("Could not start whisper.cpp: \(error.localizedDescription)")
        }
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
            let message = String(data: errorData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            throw VoiceCaptureError.transcriptionFailed(message?.isEmpty == false ? message! : "whisper.cpp failed")
        }
        guard FileManager.default.fileExists(atPath: jsonURL.path) else {
            throw VoiceCaptureError.transcriptionFailed("whisper.cpp did not produce JSON output")
        }
        do {
            return try Self.parseWhisperJSON(Data(contentsOf: jsonURL))
        } catch let error as VoiceCaptureError {
            throw error
        } catch {
            throw VoiceCaptureError.transcriptionFailed("Could not parse whisper.cpp output: \(error.localizedDescription)")
        }
    }

    public static func parseWhisperJSON(_ data: Data) throws -> VoiceTranscript {
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rawSegments = root["transcription"] as? [[String: Any]] else {
            throw VoiceCaptureError.transcriptionFailed("whisper.cpp returned an invalid JSON transcript")
        }
        let segments = rawSegments.compactMap { raw -> TranscriptSegment? in
            let text = (raw["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !text.isEmpty, let timestamps = raw["timestamps"] as? [String: Any],
                  let from = timestamps["from"] as? String, let to = timestamps["to"] as? String,
                  let startMs = parseTimestamp(from), let endMs = parseTimestamp(to) else { return nil }
            return TranscriptSegment(startMs: startMs, endMs: endMs, text: text)
        }
        guard !segments.isEmpty else { throw VoiceCaptureError.transcriptionFailed("whisper.cpp returned an empty transcript") }
        return VoiceTranscript(text: segments.map(\.text).joined(separator: " "), segments: segments)
    }

    private static func parseTimestamp(_ value: String) -> Int? {
        let parts = value.replacingOccurrences(of: ",", with: ".").split(separator: ":")
        guard parts.count == 3, let hours = Double(parts[0]), let minutes = Double(parts[1]), let seconds = Double(parts[2]) else { return nil }
        return Int(((hours * 3600) + (minutes * 60) + seconds) * 1000)
    }

    private static func writeWav(samples: [Int16], sampleRate: Int, to url: URL) throws {
        var data = Data()
        let byteCount = samples.count * MemoryLayout<Int16>.size
        appendLittleEndian(UInt32(36 + byteCount), to: &data)
        data.append(contentsOf: Array("WAVE".utf8))
        data.append(contentsOf: Array("fmt ".utf8))
        appendLittleEndian(UInt32(16), to: &data)
        appendLittleEndian(UInt16(1), to: &data)
        appendLittleEndian(UInt16(1), to: &data)
        appendLittleEndian(UInt32(sampleRate), to: &data)
        appendLittleEndian(UInt32(sampleRate * 2), to: &data)
        appendLittleEndian(UInt16(2), to: &data)
        appendLittleEndian(UInt16(16), to: &data)
        data.append(contentsOf: Array("data".utf8))
        appendLittleEndian(UInt32(byteCount), to: &data)
        samples.withUnsafeBytes { data.append(contentsOf: $0) }
        try data.write(to: url, options: .atomic)
    }

    private static func appendLittleEndian<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
        var littleEndian = value.littleEndian
        withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
    }
}

public struct VoiceRequest: Codable, Sendable {
    public let command: String
    public let jobId: String?

    public init(command: String, jobId: String? = nil) {
        self.command = command
        self.jobId = jobId
    }
}

public struct VoiceResponse: Codable, Sendable {
    public let ok: Bool
    public let state: String
    public let bufferedSeconds: Double
    public let jobId: String?
    public let transcript: VoiceTranscript?
    public let error: String?

    public init(ok: Bool, state: String, bufferedSeconds: Double, jobId: String? = nil, transcript: VoiceTranscript? = nil, error: String? = nil) {
        self.ok = ok
        self.state = state
        self.bufferedSeconds = bufferedSeconds
        self.jobId = jobId
        self.transcript = transcript
        self.error = error
    }
}

private final class LockedBuffer: @unchecked Sendable {
    private var value: AudioRingBuffer
    private let lock = NSLock()

    init(_ value: AudioRingBuffer) { self.value = value }

    func append(_ samples: [Int16]) { lock.lock(); defer { lock.unlock() }; value.append(samples) }
    func snapshot() -> [Int16] { lock.lock(); defer { lock.unlock() }; return value.snapshot() }
    func clear() { lock.lock(); defer { lock.unlock() }; value.clear() }
    var seconds: Double { lock.lock(); defer { lock.unlock() }; return value.bufferedSeconds }
}

private final class AudioInput: @unchecked Sendable {
    private final class ConversionInputState: @unchecked Sendable {
        var supplied = false
    }

    private let engine = AVAudioEngine()
    private let outputFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true)!
    private let buffer: LockedBuffer
    private var converter: AVAudioConverter?

    init(buffer: LockedBuffer) { self.buffer = buffer }

    func start() throws {
        let permission = AVAudioApplication.shared.recordPermission
        guard permission == .granted else {
            if permission == .undetermined {
                AVAudioApplication.requestRecordPermission { _ in }
                throw VoiceCaptureError.permissionRequired
            }
            throw VoiceCaptureError.permissionDenied
        }
        let input = engine.inputNode
        let inputFormat = input.inputFormat(forBus: 0)
        converter = AVAudioConverter(from: inputFormat, to: outputFormat)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] audioBuffer, _ in
            self?.receive(audioBuffer)
        }
        engine.prepare()
        try engine.start()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }

    private func receive(_ inputBuffer: AVAudioPCMBuffer) {
        guard let converter else { return }
        let ratio = outputFormat.sampleRate / inputBuffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(inputBuffer.frameLength) * ratio + 1)
        guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else { return }
        var error: NSError?
        let conversionState = ConversionInputState()
        let status = converter.convert(to: outputBuffer, error: &error) { _, inputStatus in
            if conversionState.supplied {
                inputStatus.pointee = .noDataNow
                return nil
            }
            conversionState.supplied = true
            inputStatus.pointee = .haveData
            return inputBuffer
        }
        guard status != .error, error == nil, let channel = outputBuffer.int16ChannelData else { return }
        buffer.append(Array(UnsafeBufferPointer(start: channel[0], count: Int(outputBuffer.frameLength))))
    }
}

public final class VoiceService: @unchecked Sendable {
    private let buffer = LockedBuffer(AudioRingBuffer())
    private let transcriber: WhisperCppTranscriber
    private let stateLock = NSLock()
    private var state = "idle"
    private var jobs: [String: Result<VoiceTranscript, Error>] = [:]
    private var activeJob: String?
    private var cancelledJobs = Set<String>()
    private var audioInput: AudioInput?

    public init(transcriber: WhisperCppTranscriber) {
        self.transcriber = transcriber
        WhisperCppTranscriber.clearTemporaryFiles()
    }

    public func handle(_ request: VoiceRequest) -> VoiceResponse {
        switch request.command {
        case "start": return start()
        case "stop": return stop()
        case "clear": return clear()
        case "capture": return capture()
        case "status": return status()
        case "poll": return poll(jobId: request.jobId)
        case "consume": return consume(jobId: request.jobId)
        default: return response(ok: false, error: "Unknown command.")
        }
    }

    private func start() -> VoiceResponse {
        stateLock.lock()
        if state == "listening" { stateLock.unlock(); return status() }
        if state == "transcribing" {
            let jobId = activeJob
            stateLock.unlock()
            return response(ok: false, jobId: jobId, error: "A transcription is already in progress.")
        }
        if let activeJob, jobs[activeJob] != nil {
            jobs.removeValue(forKey: activeJob)
            self.activeJob = nil
        }
        stateLock.unlock()
        let input = AudioInput(buffer: buffer)
        do {
            try input.start()
            stateLock.lock(); audioInput = input; state = "listening"; stateLock.unlock()
            return status()
        } catch {
            return response(ok: false, error: error.localizedDescription)
        }
    }

    private func stop() -> VoiceResponse {
        stateLock.lock(); let input = audioInput; audioInput = nil; if state == "listening" { state = "stopped" }; stateLock.unlock()
        input?.stop()
        return status()
    }

    private func clear() -> VoiceResponse {
        stateLock.lock()
        if let activeJob { cancelledJobs.insert(activeJob) }
        jobs.removeAll()
        activeJob = nil
        state = "idle"
        let input = audioInput
        audioInput = nil
        stateLock.unlock()
        input?.stop()
        buffer.clear()
        WhisperCppTranscriber.clearTemporaryFiles()
        return status()
    }

    private func capture() -> VoiceResponse {
        stateLock.lock()
        if let activeJob {
            guard let job = jobs[activeJob] else {
                stateLock.unlock()
                return response(ok: true, jobId: activeJob)
            }

            if case .success = job {
                stateLock.unlock()
                return response(ok: true, jobId: activeJob)
            }

            jobs.removeValue(forKey: activeJob)
            self.activeJob = nil
            state = "stopped"
        }
        stateLock.unlock()

        let samples = buffer.snapshot()
        guard !samples.isEmpty else { return response(ok: false, error: VoiceCaptureError.noAudio.localizedDescription) }
        let stopped = stop()
        guard stopped.ok else { return stopped }
        let jobId = UUID().uuidString
        stateLock.lock(); activeJob = jobId; state = "transcribing"; stateLock.unlock()
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                let transcript = try self.transcriber.transcribe(samples: samples)
                self.stateLock.lock()
                if !self.cancelledJobs.contains(jobId) { self.jobs[jobId] = .success(transcript) }
                self.cancelledJobs.remove(jobId)
                self.state = self.jobs[jobId] == nil ? "idle" : "completed"
                self.stateLock.unlock()
            } catch {
                self.stateLock.lock()
                if !self.cancelledJobs.contains(jobId) { self.jobs[jobId] = .failure(error) }
                self.cancelledJobs.remove(jobId)
                self.state = self.jobs[jobId] == nil ? "idle" : "error"
                self.stateLock.unlock()
            }
        }
        return response(ok: true, jobId: jobId)
    }

    private func poll(jobId: String?) -> VoiceResponse {
        guard let jobId else { return response(ok: false, error: "jobId is required.") }
        stateLock.lock()
        let result = jobs[jobId]
        let isActive = activeJob == jobId
        stateLock.unlock()
        if let result {
            switch result {
            case .success: return response(ok: true, jobId: jobId)
            case .failure(let error): return response(ok: false, jobId: jobId, error: error.localizedDescription)
            }
        }
        if isActive { return response(ok: true, jobId: jobId) }
        return response(ok: false, jobId: jobId, error: VoiceCaptureError.jobNotFound.localizedDescription)
    }

    private func consume(jobId: String?) -> VoiceResponse {
        guard let jobId else { return response(ok: false, error: "jobId is required.") }
        stateLock.lock()
        guard let result = jobs[jobId] else {
            stateLock.unlock()
            return response(ok: false, jobId: jobId, error: VoiceCaptureError.jobNotReady.localizedDescription)
        }
        switch result {
        case .success(let transcript):
            activeJob = jobId
            state = "stopped"
        case .failure(let error):
            jobs.removeValue(forKey: jobId)
            activeJob = nil
            state = "error"
        }
        stateLock.unlock()
        switch result {
        case .success(let transcript):
            buffer.clear()
            return response(ok: true, jobId: jobId, transcript: transcript)
        case .failure(let error):
            return response(ok: false, jobId: jobId, error: error.localizedDescription)
        }
    }

    private func status() -> VoiceResponse { response(ok: true) }

    private func response(ok: Bool, jobId: String? = nil, transcript: VoiceTranscript? = nil, error: String? = nil) -> VoiceResponse {
        stateLock.lock(); let currentState = state; stateLock.unlock()
        return VoiceResponse(ok: ok, state: currentState, bufferedSeconds: buffer.seconds, jobId: jobId, transcript: transcript, error: error)
    }
}
