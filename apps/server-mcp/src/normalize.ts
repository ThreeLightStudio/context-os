import { eventForRecord, timelineWorkAt, type ParsedContextEvent, type WorkState } from "./events.js";
import type { ContextRecord, NormalizedContextRecord, Work } from "./types.js";

function workView(work: Work, association: "explicit" | "timeline-derived") {
  return { ...work, association };
}

function explicitWork(event: ParsedContextEvent | null, state: WorkState): Work | undefined {
  const workId = event?.metadata.workId;
  return workId ? state.works.get(workId) : undefined;
}

export function normalizeRecord(record: ContextRecord, state: WorkState): NormalizedContextRecord {
  const event = eventForRecord(record, state);
  const type = event?.metadata.type === "mcp-context"
    ? event.metadata.contextType ?? "capture"
    : event?.metadata.type ?? "capture";
  const content = event?.body ?? record.data.content;
  const directWork = explicitWork(event, state);
  const derivedWork = event ? undefined : timelineWorkAt(state, record.recordedAt);
  const work = directWork
    ? workView(directWork, "explicit")
    : derivedWork
      ? workView(derivedWork, "timeline-derived")
      : undefined;

  return {
    id: record.id,
    recordedAt: record.recordedAt,
    receivedAt: record.receivedAt,
    type,
    content,
    ...(work ? { work } : {}),
    source: record.data.source,
    ...(record.data.context ? { context: record.data.context } : {}),
  };
}
