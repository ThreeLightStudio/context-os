import { BrainValidationError, isObject, object, onlyKeys } from "../schemas/validation.js";
import { isContextRecord, ServerContextClientError, type ContextRecord, type ContextSource } from "./server-context-client.js";
import { getLocalDateRange } from "./date-range.js";

export const MAX_DAILY_SUMMARY_RECORDS = 100;
export const MAX_DAILY_SUMMARY_CONTEXT_BYTES = 64 * 1024;

export interface DailySummaryInput {
  date: string;
  timezone: string;
}

export interface DailySummaryContext {
  date: string;
  timezone: string;
  records: ContextRecord[];
}

export function parseDailySummaryContext(value: unknown, input: DailySummaryInput): DailySummaryContext {
  const context = object(value, "context");
  onlyKeys(context, ["date", "timezone", "records"], "context");
  if (context.date !== input.date) throw new BrainValidationError("context.date must match input.date");
  if (context.timezone !== input.timezone) throw new BrainValidationError("context.timezone must match input.timezone");
  if (!Array.isArray(context.records)) throw new BrainValidationError("context.records must be an array");
  if (context.records.length > MAX_DAILY_SUMMARY_RECORDS) {
    throw new BrainValidationError(`context.records must contain at most ${MAX_DAILY_SUMMARY_RECORDS} items`);
  }
  if (!context.records.every(isContextRecord)) throw new BrainValidationError("context.records contains an invalid record");
  return { date: input.date, timezone: input.timezone, records: context.records };
}

function timestamp(record: ContextRecord): number {
  const value = Date.parse(record.recordedAt);
  if (!Number.isFinite(value)) {
    throw new ServerContextClientError("server-context returned a record with an invalid recordedAt", "context_malformed");
  }
  return value;
}

export async function resolveDailySummaryContext(input: DailySummaryInput, contextSource?: ContextSource): Promise<DailySummaryContext> {
  if (!contextSource) throw new ServerContextClientError("server-context is not configured", "context_configuration");
  const range = getLocalDateRange(input.date, input.timezone);
  const start = range.start.getTime();
  const end = range.end.getTime();
  const records: ContextRecord[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  while (records.length < MAX_DAILY_SUMMARY_RECORDS) {
    const page = await contextSource.listRecords({ limit: MAX_DAILY_SUMMARY_RECORDS, ...(cursor ? { cursor } : {}) });
    if (page.records.length === 0) break;

    let reachedOlderRecords = false;
    for (const record of page.records) {
      const recordedAt = timestamp(record);
      if (recordedAt < start) {
        reachedOlderRecords = true;
        break;
      }
      if (recordedAt >= start && recordedAt < end) {
        records.push(record);
        if (records.length === MAX_DAILY_SUMMARY_RECORDS) break;
      }
    }

    if (records.length === MAX_DAILY_SUMMARY_RECORDS || reachedOlderRecords || !page.nextCursor) break;
    if (seenCursors.has(page.nextCursor)) {
      throw new ServerContextClientError("server-context returned a repeating cursor", "context_malformed");
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  return { date: input.date, timezone: input.timezone, records };
}
