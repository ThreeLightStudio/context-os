import { randomUUID } from "node:crypto";
import { Capture, contextEventPrefix, listContextEventCaptures, saveCapture } from "./database";

type ContextEventType =
  "work-created" | "work-activated" | "resume-note-set" | "legacy-work-item" | "legacy-migration-completed";

interface ContextEventMetadata {
  type: ContextEventType;
  workId?: string;
  name?: string;
  note?: string;
  sourceId?: string;
  status?: "open" | "done";
}

interface ParsedContextEvent {
  capture: Capture;
  metadata: ContextEventMetadata;
  body: string;
}

export interface ResumeWork {
  id: string;
  name: string;
  createdAt: string;
}

export interface ResumeState {
  activeWork: ResumeWork | null;
  resumeNote: string | null;
  works: ResumeWork[];
}

const knownEventTypes = new Set<ContextEventType>([
  "work-created",
  "work-activated",
  "resume-note-set",
  "legacy-work-item",
  "legacy-migration-completed",
]);

function formatEvent(metadata: ContextEventMetadata, body: string) {
  return `${contextEventPrefix}\n${JSON.stringify(metadata)}\n-->\n${body}`;
}

function parseEvent(capture: Capture): ParsedContextEvent | null {
  const match = capture.content.match(/^<!-- context-os:event:v1\n([^\n]+)\n-->\n([\s\S]*)$/);
  if (!match) return null;

  try {
    const metadata = JSON.parse(match[1]) as ContextEventMetadata;
    if (!metadata || !knownEventTypes.has(metadata.type)) return null;
    return { capture, metadata, body: match[2] };
  } catch {
    return null;
  }
}

async function appendEvent(metadata: ContextEventMetadata, body: string, capturedAt: string) {
  await saveCapture(randomUUID(), formatEvent(metadata, body), capturedAt);
}

function workCreatedBody(name: string) {
  return `Work 추가\n---\n${name}\n---`;
}

function workActivatedBody(name: string) {
  return `현재 Work 변경\n---\n${name}\n---`;
}

function resumeNoteBody(name: string, note: string) {
  return `재개 메모\n---\n${name}\n\n${note}\n---`;
}

export async function loadResumeState(): Promise<ResumeState> {
  const captures = await listContextEventCaptures();
  const events = captures.map(parseEvent).filter((event): event is ParsedContextEvent => event !== null);
  const works = new Map<string, ResumeWork>();
  const notes = new Map<string, string>();
  let activeWorkId: string | null = null;

  for (const event of events) {
    const { metadata } = event;
    if (metadata.type === "work-created" && metadata.workId && metadata.name) {
      works.set(metadata.workId, { id: metadata.workId, name: metadata.name, createdAt: event.capture.capturedAt });
      activeWorkId = metadata.workId;
    }
    if (metadata.type === "work-activated" && metadata.workId && works.has(metadata.workId)) {
      activeWorkId = metadata.workId;
    }
    if (metadata.type === "resume-note-set" && metadata.workId && metadata.note) {
      notes.set(metadata.workId, metadata.note);
    }
  }

  const activeWork = activeWorkId ? (works.get(activeWorkId) ?? null) : null;
  return {
    activeWork,
    resumeNote: activeWork ? (notes.get(activeWork.id) ?? null) : null,
    works: [...works.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  };
}

export function createResumeWork(name: string) {
  const workId = randomUUID();
  const timestamp = new Date().toISOString();
  return appendEvent({ type: "work-created", workId, name }, workCreatedBody(name), timestamp);
}

export function activateResumeWork(work: ResumeWork) {
  return appendEvent(
    { type: "work-activated", workId: work.id },
    workActivatedBody(work.name),
    new Date().toISOString(),
  );
}

export function setResumeNote(work: ResumeWork, note: string) {
  return appendEvent(
    { type: "resume-note-set", workId: work.id, note },
    resumeNoteBody(work.name, note),
    new Date().toISOString(),
  );
}
