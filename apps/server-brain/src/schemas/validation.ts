import { isValidCalendarDate, isValidTimeZone } from "../context/date-range.js";
import type { DailySummaryInput } from "../context/daily-summary-context.js";

export const MAX_REQUEST_BYTES = 128 * 1024;
export const MAX_SUMMARIZE_CONTENT_BYTES = 64 * 1024;
export const MAX_DAILY_SUMMARY_TIMEZONE_BYTES = 128;
const encoder = new TextEncoder();

export class BrainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrainValidationError";
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function object(value: unknown, name: string): Record<string, unknown> {
  if (!isObject(value)) throw new BrainValidationError(`${name} must be an object`);
  return value;
}

export function onlyKeys(value: Record<string, unknown>, allowed: string[], name: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new BrainValidationError(`${name}.${key} is not allowed`);
  }
}

export function requiredString(value: unknown, name: string, maxBytes?: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BrainValidationError(`${name} must be a non-empty string`);
  }
  if (maxBytes !== undefined && encoder.encode(value).byteLength > maxBytes) {
    throw new BrainValidationError(`${name} is too large`);
  }
  return value;
}

export function parseActionExecutionRequest(value: unknown) {
  const payload = object(value, "payload");
  onlyKeys(payload, ["action", "input", "context"], "payload");
  const action = requiredString(payload.action, "action", 128);
  return {
    action,
    ...(payload.input !== undefined ? { input: payload.input } : {}),
    ...(payload.context !== undefined ? { context: payload.context } : {}),
  };
}

export function parseSummarizeInput(value: unknown): { content: string } {
  const input = object(value, "input");
  onlyKeys(input, ["content"], "input");
  return { content: requiredString(input.content, "input.content", MAX_SUMMARIZE_CONTENT_BYTES) };
}

export function parseDailySummaryInput(value: unknown): DailySummaryInput {
  const input = object(value, "input");
  onlyKeys(input, ["date", "timezone"], "input");
  const date = requiredString(input.date, "input.date", 10);
  if (!isValidCalendarDate(date)) throw new BrainValidationError("input.date must be a valid YYYY-MM-DD calendar date");
  const timezone = requiredString(input.timezone, "input.timezone", MAX_DAILY_SUMMARY_TIMEZONE_BYTES).trim();
  if (!isValidTimeZone(timezone)) throw new BrainValidationError("input.timezone must be a valid IANA timezone");
  return { date, timezone };
}

export function parseSummarizeOutput(value: unknown): { summary: string; keyPoints: string[] } {
  const output = object(value, "output");
  onlyKeys(output, ["summary", "keyPoints"], "output");
  const summary = requiredString(output.summary, "output.summary", MAX_SUMMARIZE_CONTENT_BYTES);
  if (!Array.isArray(output.keyPoints)) throw new BrainValidationError("output.keyPoints must be an array");
  if (output.keyPoints.length > 20) throw new BrainValidationError("output.keyPoints must contain at most 20 items");
  const keyPoints = output.keyPoints.map((point, index) => requiredString(point, `output.keyPoints[${index}]`, 4096));
  return { summary, keyPoints };
}

export function parseDailySummaryOutput(value: unknown): {
  date: string;
  timezone: string;
  recordCount: number;
  summary: string;
  keyPoints: string[];
} {
  const output = object(value, "output");
  onlyKeys(output, ["date", "timezone", "recordCount", "summary", "keyPoints"], "output");
  const date = requiredString(output.date, "output.date", 10);
  if (!isValidCalendarDate(date)) throw new BrainValidationError("output.date must be a valid YYYY-MM-DD calendar date");
  const timezone = requiredString(output.timezone, "output.timezone", MAX_DAILY_SUMMARY_TIMEZONE_BYTES).trim();
  if (!isValidTimeZone(timezone)) throw new BrainValidationError("output.timezone must be a valid IANA timezone");
  if (!Number.isInteger(output.recordCount) || (output.recordCount as number) < 0 || (output.recordCount as number) > 100) {
    throw new BrainValidationError("output.recordCount must be an integer from 0 to 100");
  }
  const summary = requiredString(output.summary, "output.summary", MAX_SUMMARIZE_CONTENT_BYTES);
  if (!Array.isArray(output.keyPoints)) throw new BrainValidationError("output.keyPoints must be an array");
  if (output.keyPoints.length > 20) throw new BrainValidationError("output.keyPoints must contain at most 20 items");
  const keyPoints = output.keyPoints.map((point, index) => requiredString(point, `output.keyPoints[${index}]`, 4096));
  return { date, timezone, recordCount: output.recordCount as number, summary, keyPoints };
}

export const summarizeInputSchema = {
  type: "object",
  properties: { content: { type: "string", minLength: 1, maxBytes: MAX_SUMMARIZE_CONTENT_BYTES } },
  required: ["content"],
  additionalProperties: false,
};

export const summarizeOutputSchema = {
  type: "object",
  properties: {
    summary: { type: "string", minLength: 1, maxBytes: MAX_SUMMARIZE_CONTENT_BYTES },
    keyPoints: { type: "array", items: { type: "string" }, maxItems: 20 },
  },
  required: ["summary", "keyPoints"],
  additionalProperties: false,
};

export const dailySummaryInputSchema = {
  type: "object",
  properties: {
    date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    timezone: { type: "string", minLength: 1, maxBytes: MAX_DAILY_SUMMARY_TIMEZONE_BYTES },
  },
  required: ["date", "timezone"],
  additionalProperties: false,
};

export const dailySummaryOutputSchema = {
  type: "object",
  properties: {
    date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    timezone: { type: "string", minLength: 1, maxBytes: MAX_DAILY_SUMMARY_TIMEZONE_BYTES },
    recordCount: { type: "integer", minimum: 0, maximum: 100 },
    summary: { type: "string", minLength: 1, maxBytes: MAX_SUMMARIZE_CONTENT_BYTES },
    keyPoints: { type: "array", items: { type: "string" }, maxItems: 20 },
  },
  required: ["date", "timezone", "recordCount", "summary", "keyPoints"],
  additionalProperties: false,
};
