import type { ContextRecord, McpContextType, Work } from "./types.js";

export const contextEventPrefix = "<!-- context-os:event:v1";

export type WorkEventType = "work-created" | "work-activated" | "resume-note-set";

export type ContextEventMetadata = {
  type: WorkEventType | "mcp-context";
  contextType?: McpContextType;
  workId?: string;
  name?: string;
  note?: string;
  source?: "mcp";
};

export type ParsedContextEvent = {
  record: ContextRecord;
  metadata: ContextEventMetadata;
  body: string;
};

export type WorkInterval = {
  workId: string;
  startAt: string;
  endAt?: string;
};

export type WorkState = {
  works: Map<string, Work>;
  events: ParsedContextEvent[];
  activeWorkId: string | null;
  resumeNotes: Map<string, string>;
  intervals: WorkInterval[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContextType(value: unknown): value is McpContextType {
  return value === "capture" || value === "decision" || value === "insight" || value === "next";
}

function isMetadata(value: unknown): value is ContextEventMetadata {
  if (!isObject(value)) return false;
  if (value.type === "mcp-context") return isContextType(value.contextType);
  return value.type === "work-created" || value.type === "work-activated" || value.type === "resume-note-set";
}

export function parseContextEvent(record: ContextRecord): ParsedContextEvent | null {
  const match = record.data.content.match(/^<!-- context-os:event:v1\n([^\n]+)\n-->\n([\s\S]*)$/);
  if (!match) return null;
  try {
    const metadata: unknown = JSON.parse(match[1]);
    return isMetadata(metadata) ? { record, metadata, body: match[2] } : null;
  } catch {
    return null;
  }
}

function eventOrder(left: ParsedContextEvent, right: ParsedContextEvent): number {
  return left.record.recordedAt.localeCompare(right.record.recordedAt) || left.record.id.localeCompare(right.record.id);
}

function workName(event: ParsedContextEvent): string | undefined {
  if (event.metadata.name) return event.metadata.name;
  const separator = "\n---\n";
  const parts = event.body.split(separator);
  return parts[1]?.split(/\r?\n/, 1)[0]?.trim() || undefined;
}

export function buildWorkState(records: ContextRecord[]): WorkState {
  const events = records.map(parseContextEvent).filter((event): event is ParsedContextEvent => event !== null).sort(eventOrder);
  const works = new Map<string, Work>();
  const resumeNotes = new Map<string, string>();
  let activeWorkId: string | null = null;

  for (const event of events) {
    const { metadata } = event;
    if (metadata.type === "work-created" && metadata.workId && workName(event)) {
      works.set(metadata.workId, { id: metadata.workId, name: workName(event)!, createdAt: event.record.recordedAt });
      activeWorkId = metadata.workId;
    } else if (metadata.type === "work-activated" && metadata.workId && works.has(metadata.workId)) {
      activeWorkId = metadata.workId;
    } else if (metadata.type === "resume-note-set" && metadata.workId && metadata.note) {
      resumeNotes.set(metadata.workId, metadata.note);
    }
  }

  const intervals: WorkInterval[] = [];
  let current: WorkInterval | undefined;
  for (const event of events) {
    const isActivation = event.metadata.type === "work-created" || event.metadata.type === "work-activated";
    const workId = isActivation ? event.metadata.workId : undefined;
    if (!workId || !works.has(workId)) continue;
    if (current) current.endAt = event.record.recordedAt;
    current = { workId, startAt: event.record.recordedAt };
    intervals.push(current);
  }

  return { works, events, activeWorkId, resumeNotes, intervals };
}

export function resolveWork(state: WorkState, value: string): Work | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const byId = state.works.get(trimmed);
  if (byId) return byId;
  const matches = [...state.works.values()].filter((work) => work.name === trimmed);
  return matches.length === 1 ? matches[0] : undefined;
}

export function workNameMatches(state: WorkState, value: string): Work[] {
  const trimmed = value.trim();
  const byId = state.works.get(trimmed);
  if (byId) return [byId];
  return [...state.works.values()].filter((work) => work.name === trimmed);
}

export function timelineWorkAt(state: WorkState, recordedAt: string): Work | undefined {
  const interval = state.intervals.find((candidate) =>
    recordedAt >= candidate.startAt && (candidate.endAt === undefined || recordedAt < candidate.endAt));
  return interval ? state.works.get(interval.workId) : undefined;
}

export function eventForRecord(record: ContextRecord, state: WorkState): ParsedContextEvent | null {
  return state.events.find((event) => event.record.id === record.id) ?? null;
}
