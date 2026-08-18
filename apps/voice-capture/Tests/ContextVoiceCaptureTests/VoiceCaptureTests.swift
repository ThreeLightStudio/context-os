import Foundation
import Testing
@testable import ContextVoiceCapture

@Test("ring buffer keeps the newest bounded audio")
func ringBufferEvictsOldChunks() {
    var buffer = AudioRingBuffer(sampleRate: 4, chunkDurationSeconds: 2, maxDurationSeconds: 4)
    buffer.append(Array(0..<24).map(Int16.init))

    #expect(buffer.bufferedSeconds == 4)
    #expect(buffer.snapshot() == Array(8..<24).map(Int16.init))
}

@Test("ring buffer preserves partial chunks and clears immediately")
func ringBufferPartialAndClear() {
    var buffer = AudioRingBuffer(sampleRate: 4, chunkDurationSeconds: 2, maxDurationSeconds: 4)
    buffer.append([1, 2, 3])
    buffer.append([4, 5])

    #expect(buffer.snapshot() == [1, 2, 3, 4, 5])
    buffer.clear()
    #expect(buffer.snapshot().isEmpty)
    #expect(buffer.bufferedSeconds == 0)
}

@Test("whisper JSON preserves timestamped segments")
func parsesWhisperOutput() throws {
    let data = Data(#"{"transcription":[{"timestamps":{"from":"00:00:01,250","to":"00:00:03,500"},"text":" Hello world "}]}"#.utf8)
    let transcript = try WhisperCppTranscriber.parseWhisperJSON(data)

    #expect(transcript.text == "Hello world")
    #expect(transcript.segments == [TranscriptSegment(startMs: 1250, endMs: 3500, text: "Hello world")])
}

@Test("invalid whisper JSON fails without producing a transcript")
func rejectsInvalidWhisperOutput() {
    #expect(throws: VoiceCaptureError.self) {
        try WhisperCppTranscriber.parseWhisperJSON(Data(#"{"transcription":[]}"#.utf8))
    }
}
