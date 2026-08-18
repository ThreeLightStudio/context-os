import { Action, ActionPanel, Form, Icon, List, showHUD, showToast, Toast } from "@raycast/api";
import { randomUUID } from "node:crypto";
import { useCallback, useEffect, useRef, useState } from "react";
import { captureRecentVoice, voiceCommand } from "./voice-capture-api";
import { createVoiceDraft } from "./voice-brain-api";
import { parseDraftLines, renderVoiceDraft } from "./voice-draft";
import type { VoiceDraft } from "./voice-draft";
import { saveCapture } from "./database";

type Phase = "starting" | "drafting" | "ready" | "error";

function ErrorView({ error, onRetry, onClear }: { error: string; onRetry: () => void; onClear: () => void }) {
  return (
    <List>
      <List.EmptyView
        icon={Icon.ExclamationMark}
        title="Voice Capture를 완료하지 못했습니다"
        description={error}
        actions={
          <ActionPanel>
            <Action title="Retry" icon={Icon.ArrowClockwise} onAction={onRetry} />
            <Action title="Clear Voice Buffer" icon={Icon.Trash} onAction={onClear} />
          </ActionPanel>
        }
      />
    </List>
  );
}

export default function VoiceCaptureCommand() {
  const [phase, setPhase] = useState<Phase>("starting");
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const generateDraft = useCallback(async (text: string, capturedAt: string) => {
    setPhase("drafting");
    setError(null);
    try {
      const nextDraft = await createVoiceDraft({ transcript: text, capturedAt });
      setDraft(nextDraft);
      setTranscript(null);
      setPhase("ready");
    } catch (reason) {
      setTranscript(text);
      setPhase("error");
      setError(reason instanceof Error ? reason.message : "server-brain could not create a Draft.");
    }
  }, []);

  const capture = useCallback(async () => {
    setPhase("starting");
    setError(null);
    try {
      const result = await captureRecentVoice();
      await generateDraft(result.transcript.text, result.capturedAt);
    } catch (reason) {
      setPhase("error");
      setError(reason instanceof Error ? reason.message : "Voice Capture failed.");
    }
  }, [generateDraft]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void capture();
  }, [capture]);

  async function retry() {
    if (transcript) {
      await generateDraft(transcript, new Date().toISOString());
    } else {
      await capture();
    }
  }

  async function save(values: Record<string, string>) {
    if (!draft) return;
    setPhase("starting");
    const finalDraft: VoiceDraft = {
      ...draft,
      suggestedWork: values.suggestedWork.trim() || null,
      topic: values.topic.trim() || null,
      summary: values.summary.trim(),
      decisions: parseDraftLines(values.decisions),
      insights: parseDraftLines(values.insights),
      next: parseDraftLines(values.next),
      questions: parseDraftLines(values.questions),
    };
    if (!finalDraft.summary) {
      await showToast({ style: Toast.Style.Failure, title: "Summary를 입력하세요" });
      setPhase("ready");
      return;
    }
    try {
      await saveCapture(randomUUID(), renderVoiceDraft(finalDraft), finalDraft.capturedAt, "voice");
      await showHUD("Voice Context Draft를 저장했습니다");
      setDraft(null);
      setPhase("ready");
    } catch (reason) {
      setPhase("ready");
      await showToast({
        style: Toast.Style.Failure,
        title: "Voice Draft를 저장하지 못했습니다",
        message: reason instanceof Error ? reason.message : "Context Server request failed",
      });
    }
  }

  if (phase === "error" && error) {
    return <ErrorView error={error} onRetry={() => void retry()} onClear={() => void voiceCommand("clear")} />;
  }

  if (!draft) {
    return <List isLoading navigationTitle={phase === "drafting" ? "Draft 생성 중" : "Voice Capture 준비 중"} />;
  }

  return (
    <Form
      isLoading={phase !== "ready"}
      navigationTitle="Review Voice Context Draft"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Context Draft" icon={Icon.Check} onSubmit={(values) => void save(values)} />
          <Action title="Clear Voice Buffer" icon={Icon.Trash} onAction={() => void voiceCommand("clear")} />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Privacy"
        text="Audio is processed locally and deleted after transcription. AI output is a Draft and will not be saved until you choose Save."
      />
      <Form.TextField
        id="suggestedWork"
        title="Suggested Work"
        value={draft.suggestedWork ?? ""}
        onChange={(value) => setDraft((current) => current && { ...current, suggestedWork: value || null })}
      />
      <Form.TextField
        id="topic"
        title="Topic"
        value={draft.topic ?? ""}
        onChange={(value) => setDraft((current) => current && { ...current, topic: value || null })}
      />
      <Form.Dropdown
        id="contextType"
        title="Context Type"
        value={draft.contextType ?? "none"}
        onChange={(value) =>
          setDraft(
            (current) =>
              current && { ...current, contextType: value === "none" ? null : (value as VoiceDraft["contextType"]) },
          )
        }
      >
        <Form.Dropdown.Item value="none" title="Not specified" />
        <Form.Dropdown.Item value="work" title="Work" />
        <Form.Dropdown.Item value="decision" title="Decision" />
        <Form.Dropdown.Item value="insight" title="Insight" />
        <Form.Dropdown.Item value="plan" title="Plan" />
        <Form.Dropdown.Item value="question" title="Question" />
        <Form.Dropdown.Item value="reflection" title="Reflection" />
      </Form.Dropdown>
      <Form.TextArea
        id="summary"
        title="Summary"
        value={draft.summary}
        onChange={(value) => setDraft((current) => current && { ...current, summary: value })}
      />
      <Form.TextArea
        id="decisions"
        title="Decisions"
        value={draft.decisions.join("\n")}
        onChange={(value) => setDraft((current) => current && { ...current, decisions: parseDraftLines(value) })}
      />
      <Form.TextArea
        id="insights"
        title="Insights"
        value={draft.insights.join("\n")}
        onChange={(value) => setDraft((current) => current && { ...current, insights: parseDraftLines(value) })}
      />
      <Form.TextArea
        id="next"
        title="Next"
        value={draft.next.join("\n")}
        onChange={(value) => setDraft((current) => current && { ...current, next: parseDraftLines(value) })}
      />
      <Form.TextArea
        id="questions"
        title="Questions"
        value={draft.questions.join("\n")}
        onChange={(value) => setDraft((current) => current && { ...current, questions: parseDraftLines(value) })}
      />
    </Form>
  );
}
