import assert from "node:assert/strict";
import test from "node:test";
import { draftFromBrainResult, parseDraftLines, renderVoiceDraft } from "../src/voice-draft.ts";

const result = {
  summary: "Voice Capture를 구현한다.",
  decisions: ["Audio는 로컬에서 처리한다."],
  insights: ["Draft는 자동 저장하지 않는다."],
  next: ["Native helper를 만든다."],
  questions: [],
  suggestedWork: "Context OS Voice Capture",
  topic: "Voice Capture",
  contextType: "plan",
};

test("parses editable voice draft fields and renders a Context record", () => {
  const draft = draftFromBrainResult(result, "2026-08-18T10:00:00.000Z");
  assert.deepEqual(parseDraftLines("- one\n2. two\n\nthree"), ["one", "two", "three"]);
  assert.match(renderVoiceDraft(draft), /Summary\nVoice Capture를 구현한다\./);
  assert.match(renderVoiceDraft(draft), /- Audio는 로컬에서 처리한다\./);
});

test("rejects malformed or invented draft fields", () => {
  assert.throws(() => draftFromBrainResult({ ...result, decisions: [1] }, new Date().toISOString()));
  assert.throws(() => draftFromBrainResult({ ...result, contextType: "current-state" }, new Date().toISOString()));
});
