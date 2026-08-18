import { getPreferenceValues } from "@raycast/api";
import { draftFromBrainResult } from "./voice-draft";
import type { VoiceDraft } from "./voice-draft";

export interface VoicePreferences {
  brainUrl?: string;
  brainApiToken?: string;
  whisperCliPath?: string;
  whisperModelPath?: string;
}

export interface VoiceBrainRequestOptions {
  transcript: string;
  capturedAt: string;
  fetchImpl?: typeof fetch;
}

function preferences(): VoicePreferences {
  return getPreferenceValues<VoicePreferences>();
}

function endpoint(value: string): string {
  const url = new URL(value.trim() || "http://127.0.0.1:17002");
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Brain URL must use http or https.");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/actions`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function getVoicePreferences(): VoicePreferences {
  return preferences();
}

export async function createVoiceDraft(options: VoiceBrainRequestOptions): Promise<VoiceDraft> {
  const configured = preferences();
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = new Headers({ "content-type": "application/json", accept: "application/json" });
  if (configured.brainApiToken?.trim()) headers.set("authorization", `Bearer ${configured.brainApiToken.trim()}`);
  let response: Response;
  try {
    response = await fetchImpl(endpoint(configured.brainUrl ?? ""), {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "voice-context-draft", input: { transcript: options.transcript } }),
    });
  } catch (error) {
    throw new Error(`Could not reach server-brain: ${error instanceof Error ? error.message : "request failed"}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("server-brain returned invalid JSON.");
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `server-brain request failed (${response.status})`;
    throw new Error(message);
  }
  if (!body || typeof body !== "object" || !("result" in body))
    throw new Error("server-brain returned no voice draft.");
  return draftFromBrainResult((body as { result: unknown }).result, options.capturedAt);
}
