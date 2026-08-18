export type VoiceContextType = "work" | "decision" | "insight" | "plan" | "question" | "reflection" | null;

export interface VoiceDraft {
  summary: string;
  decisions: string[];
  insights: string[];
  next: string[];
  questions: string[];
  suggestedWork: string | null;
  topic: string | null;
  contextType: VoiceContextType;
  capturedAt: string;
}

export function parseDraftLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^[-*•]\s*/, "")
        .replace(/^\d+[.)]\s*/, ""),
    )
    .filter(Boolean);
}

function section(title: string, value: string | string[]): string {
  const body = Array.isArray(value)
    ? value
        .filter(Boolean)
        .map((item) => `- ${item}`)
        .join("\n")
    : value.trim();
  return body ? `${title}\n${body}` : "";
}

export function renderVoiceDraft(draft: VoiceDraft): string {
  return [
    section("Work", draft.suggestedWork ?? ""),
    section("Topic", draft.topic ?? ""),
    section("Context Type", draft.contextType ?? ""),
    section("Summary", draft.summary),
    section("Decisions", draft.decisions),
    section("Insights", draft.insights),
    section("Next", draft.next),
    section("Questions", draft.questions),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function draftFromBrainResult(value: unknown, capturedAt: string): VoiceDraft {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Brain returned an invalid voice draft.");
  const result = value as Record<string, unknown>;
  const stringValue = (key: string, nullable = false): string | null => {
    const item = result[key];
    if (nullable && item === null) return null;
    if (typeof item !== "string" || !item.trim()) throw new Error(`Brain draft field ${key} is invalid.`);
    return item;
  };
  const listValue = (key: string) => {
    const item = result[key];
    if (!Array.isArray(item) || !item.every((entry) => typeof entry === "string" && entry.trim())) {
      throw new Error(`Brain draft field ${key} is invalid.`);
    }
    return item as string[];
  };
  const contextType = result.contextType;
  if (
    contextType !== null &&
    !["work", "decision", "insight", "plan", "question", "reflection"].includes(String(contextType))
  ) {
    throw new Error("Brain draft field contextType is invalid.");
  }
  return {
    summary: stringValue("summary") as string,
    decisions: listValue("decisions"),
    insights: listValue("insights"),
    next: listValue("next"),
    questions: listValue("questions"),
    suggestedWork: stringValue("suggestedWork", true),
    topic: stringValue("topic", true),
    contextType: contextType as VoiceContextType,
    capturedAt,
  };
}
