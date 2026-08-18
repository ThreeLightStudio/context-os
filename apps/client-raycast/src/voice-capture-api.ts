import { environment } from "@raycast/api";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { join } from "node:path";
import { getVoicePreferences } from "./voice-brain-api";

export interface VoiceTranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface VoiceTranscript {
  text: string;
  segments: VoiceTranscriptSegment[];
}

interface VoiceResponse {
  ok: boolean;
  state: string;
  bufferedSeconds: number;
  jobId?: string;
  transcript?: VoiceTranscript;
  error?: string;
}

function socketPath() {
  return join(environment.supportPath, "voice-capture.sock");
}

function helperPath() {
  return join(environment.assetsPath, "context-voice-capture");
}

function request(command: string, jobId?: string): Promise<VoiceResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath() });
    let response = "";
    socket.setTimeout(10_000);
    socket.on("connect", () => socket.write(`${JSON.stringify({ command, ...(jobId ? { jobId } : {}) })}\n`));
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      const newline = response.indexOf("\n");
      if (newline < 0) return;
      socket.end();
      try {
        resolve(JSON.parse(response.slice(0, newline)) as VoiceResponse);
      } catch {
        reject(new Error("Voice helper returned invalid JSON."));
      }
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("Voice helper request timed out."));
    });
    socket.on("error", (error) => reject(new Error(`Voice helper is unavailable: ${error.message}`)));
  });
}

async function waitForHelper(): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const result = await request("status");
      if (result.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Voice helper did not start. Check microphone permission and Raycast build assets.");
}

export async function ensureVoiceHelper(): Promise<void> {
  if (process.platform !== "darwin") throw new Error("Voice Capture is currently supported on macOS only.");
  try {
    await request("status");
    return;
  } catch {
    const configured = getVoicePreferences();
    const cliPath = configured.whisperCliPath?.trim();
    const modelPath = configured.whisperModelPath?.trim();
    if (!cliPath || !modelPath)
      throw new Error("Set Whisper CLI Path and Whisper Model Path in Raycast Extension Preferences.");
    const child = spawn(helperPath(), ["--socket", socketPath(), "--whisper-cli", cliPath, "--model", modelPath], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    await waitForHelper();
  }
}

export async function voiceCommand(command: string): Promise<VoiceResponse> {
  await ensureVoiceHelper();
  const response = await request(command);
  if (!response.ok) throw new Error(response.error || `Voice helper command failed: ${command}`);
  return response;
}

export async function captureRecentVoice(): Promise<{ transcript: VoiceTranscript; capturedAt: string }> {
  const startedAt = new Date().toISOString();
  await ensureVoiceHelper();
  const capture = await request("capture");
  if (!capture.ok || !capture.jobId) throw new Error(capture.error || "Voice buffer is empty.");
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const status = await request("poll", capture.jobId);
    if (status.state === "completed") {
      const result = await request("consume", capture.jobId);
      if (!result.ok || !result.transcript) throw new Error(result.error || "Voice transcription was empty.");
      return { transcript: result.transcript, capturedAt: startedAt };
    }
    if (status.state === "error" || !status.ok) throw new Error(status.error || "Voice transcription failed.");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Voice transcription timed out.");
}
