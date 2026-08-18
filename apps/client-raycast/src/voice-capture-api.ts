import { environment } from "@raycast/api";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { join } from "node:path";
import { getVoicePreferences } from "./voice-brain-api";

const VOICE_HELPER_PROTOCOL_VERSION = 2;

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
  protocolVersion?: number;
  ok: boolean;
  state: string;
  bufferedSeconds: number;
  jobId?: string;
  transcript?: VoiceTranscript;
  error?: string;
}

function socketPath() {
  return join(environment.supportPath, "v.sock");
}

function helperBundlePath() {
  return join(environment.assetsPath, "context-voice-capture.app");
}

function helperPath() {
  return join(helperBundlePath(), "Contents", "MacOS", "context-voice-capture");
}

function request(command: string, jobId?: string, timeoutMs = 10_000): Promise<VoiceResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath() });
    let response = "";
    socket.setTimeout(timeoutMs);
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
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const result = await request("status", undefined, 500);
      if (result.ok && result.protocolVersion === VOICE_HELPER_PROTOCOL_VERSION) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Voice helper did not start. Check microphone permission and Raycast build assets.");
}

export async function ensureVoiceHelper(): Promise<void> {
  if (process.platform !== "darwin") throw new Error("Voice Capture is currently supported on macOS only.");
  try {
    const result = await request("status", undefined, 500);
    if (result.ok && result.protocolVersion === VOICE_HELPER_PROTOCOL_VERSION) return;
  } catch {
    const configured = getVoicePreferences();
    const cliPath = configured.whisperCliPath?.trim();
    const modelPath = configured.whisperModelPath?.trim();
    if (!cliPath || !modelPath)
      throw new Error("Set Whisper CLI Path and Whisper Model Path in Raycast Extension Preferences.");
    const executablePath = helperPath();
    if (!existsSync(executablePath)) {
      throw new Error(`Voice helper asset is missing: ${executablePath}`);
    }
    let spawnErrorMessage: string | null = null;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    const child = spawn(
      "/usr/bin/open",
      ["-n", helperBundlePath(), "--args", "--socket", socketPath(), "--whisper-cli", cliPath, "--model", modelPath],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    child.once("error", (error) => {
      spawnErrorMessage = error instanceof Error ? error.message : String(error);
    });
    child.once("exit", (code, signal) => {
      exitCode = code;
      exitSignal = signal;
    });
    child.unref();
    try {
      await waitForHelper();
    } catch (error) {
      const details = [
        spawnErrorMessage ? `spawn=${spawnErrorMessage}` : null,
        exitCode !== null ? `exit=${exitCode}` : null,
        exitSignal ? `signal=${exitSignal}` : null,
        `helper=${executablePath}`,
        `socket=${socketPath()}`,
      ]
        .filter(Boolean)
        .join("; ");
      throw new Error(`${error instanceof Error ? error.message : "Voice helper did not start."} ${details}`);
    }
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
