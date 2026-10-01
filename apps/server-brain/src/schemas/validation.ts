import { isValidCalendarDate, isValidTimeZone } from "../context/date-range.js";
import type { DailySummaryInput } from "../context/daily-summary-context.js";

export const MAX_REQUEST_BYTES = 128 * 1024;
export const MAX_SUMMARIZE_CONTENT_BYTES = 64 * 1024;
export const MAX_VOICE_TRANSCRIPT_BYTES = 96 * 1024;
export const MAX_VOICE_DRAFT_FIELD_BYTES = 16 * 1024;
export const MAX_DAILY_SUMMARY_TIMEZONE_BYTES = 128;
export const MAX_DAILY_SUMMARY_CLAIMS = 20;
export const MAX_DAILY_SUMMARY_SOURCES = 100;
export const MAX_DAILY_SUMMARY_SOURCE_IDS = 20;
export const MAX_DAILY_SUMMARY_SOURCE_PREVIEW_BYTES = 1024;

export const DAILY_SUMMARY_LEVELS = ["quick", "standard", "deep"] as const;
export type DailySummaryLevel = (typeof DAILY_SUMMARY_LEVELS)[number];
export const DAILY_SUMMARY_SUPPORT_STATUSES = ["direct", "partial", "unverified", "conflict"] as const;
export type DailySummarySupportStatus = (typeof DAILY_SUMMARY_SUPPORT_STATUSES)[number];

export interface DailySummaryVariants {
  quick: string;
  standard: string;
  deep: string;
}

export interface DailySummaryClaim {
  id: string;
  text: string;
  sourceIds: string[];
  support: DailySummarySupportStatus;
}

export interface DailySummarySource {
  recordId: string;
  preview: string;
  recordedAt: string;
  client: string;
  title?: string;
  url?: string;
}

export interface DailySummaryModelOutput {
  summary: string;
  keyPoints: string[];
  variants?: DailySummaryVariants;
  claims?: DailySummaryClaim[];
}

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

export function parseVoiceContextDraftInput(value: unknown): { transcript: string } {
  const input = object(value, "input");
  onlyKeys(input, ["transcript"], "input");
  return { transcript: requiredString(input.transcript, "input.transcript", MAX_VOICE_TRANSCRIPT_BYTES) };
}

export function parseDailySummaryInput(value: unknown): DailySummaryInput {
  const input = object(value, "input");
  onlyKeys(input, ["date", "timezone"], "input");
  const date = requiredString(input.date, "input.date", 10);
  if (!isValidCalendarDate(date)) throw new BrainValidationError("input.date must be valid YYYY-MM-DD calendar date");
  const timezone = requiredString(input.timezone, "input.timezone", MAX_DAILY_SUMMARY_TIMEZONE_BYTES).trim();
  if (!isValidTimeZone(timezone)) throw new BrainValidationError("input.timezone must be valid IANA timezone");
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

function parseDailySummaryVariants(value: unknown, name: string): DailySummaryVariants {
  const variants = object(value, name);
  onlyKeys(variants, [...DAILY_SUMMARY_LEVELS], name);
  return {
    quick: requiredString(variants.quick, `${name}.quick`, MAX_SUMMARIZE_CONTENT_BYTES),
    standard: requiredString(variants.standard, `${name}.standard`, MAX_SUMMARIZE_CONTENT_BYTES),
    deep: requiredString(variants.deep, `${name}.deep`, MAX_SUMMARIZE_CONTENT_BYTES),
  };
}

function parseDailySummaryClaims(value: unknown, name: string): DailySummaryClaim[] {
  if (!Array.isArray(value)) throw new BrainValidationError(`${name} must be an array`);
  if (value.length > MAX_DAILY_SUMMARY_CLAIMS) throw new BrainValidationError(`${name} must contain at most ${MAX_DAILY_SUMMARY_CLAIMS} items`);
  return value.map((item, index) => {
    const claim = object(item, `${name}[${index}]`);
    onlyKeys(claim, ["id", "text", "sourceIds", "support"], `${name}[${index}]`);
    if (!Array.isArray(claim.sourceIds)) throw new BrainValidationError(`${name}[${index}].sourceIds must be an array`);
    if (claim.sourceIds.length > MAX_DAILY_SUMMARY_SOURCE_IDS) {
      throw new BrainValidationError(`${name}[${index}].sourceIds must contain at most ${MAX_DAILY_SUMMARY_SOURCE_IDS} items`);
    }
    const support = claim.support;
    if (!DAILY_SUMMARY_SUPPORT_STATUSES.includes(support as DailySummarySupportStatus)) {
      throw new BrainValidationError(`${name}[${index}].support is invalid`);
    }
    return {
      id: requiredString(claim.id, `${name}[${index}].id`, 128).trim(),
      text: requiredString(claim.text, `${name}[${index}].text`, 4096).trim(),
      sourceIds: claim.sourceIds.map((sourceId, sourceIndex) => requiredString(sourceId, `${name}[${index}].sourceIds[${sourceIndex}]`, 256).trim()),
      support: support as DailySummarySupportStatus,
    };
  });
}

function parseDailySummarySources(value: unknown, name: string): DailySummarySource[] {
  if (!Array.isArray(value)) throw new BrainValidationError(`${name} must be an array`);
  if (value.length > MAX_DAILY_SUMMARY_SOURCES) throw new BrainValidationError(`${name} must contain at most ${MAX_DAILY_SUMMARY_SOURCES} items`);
  return value.map((item, index) => {
    const source = object(item, `${name}[${index}]`);
    onlyKeys(source, ["recordId", "preview", "recordedAt", "client", "title", "url"], `${name}[${index}]`);
    return {
      recordId: requiredString(source.recordId, `${name}[${index}].recordId`, 256).trim(),
      preview: requiredString(source.preview, `${name}[${index}].preview`, MAX_DAILY_SUMMARY_SOURCE_PREVIEW_BYTES).trim(),
      recordedAt: requiredString(source.recordedAt, `${name}[${index}].recordedAt`, 64).trim(),
      client: requiredString(source.client, `${name}[${index}].client`, 128).trim(),
      ...(source.title === undefined ? {} : { title: requiredString(source.title, `${name}[${index}].title`, 512).trim() }),
      ...(source.url === undefined ? {} : { url: requiredString(source.url, `${name}[${index}].url`, 2048).trim() }),
    };
  });
}

function parseDailySummaryContent(value: unknown, name: string): DailySummaryModelOutput {
  const output = object(value, name);
  onlyKeys(output, ["summary", "keyPoints", "variants", "claims"], name);
  const summary = requiredString(output.summary, `${name}.summary`, MAX_SUMMARIZE_CONTENT_BYTES);
  if (!Array.isArray(output.keyPoints)) throw new BrainValidationError(`${name}.keyPoints must be an array`);
  if (output.keyPoints.length > 20) throw new BrainValidationError(`${name}.keyPoints must contain at most 20 items`);
  const keyPoints = output.keyPoints.map((point, index) => requiredString(point, `${name}.keyPoints[${index}]`, 4096));
  return {
    summary,
    keyPoints,
    ...(output.variants === undefined ? {} : { variants: parseDailySummaryVariants(output.variants, `${name}.variants`) }),
    ...(output.claims === undefined ? {} : { claims: parseDailySummaryClaims(output.claims, `${name}.claims`) }),
  };
}

export function parseDailySummaryModelOutput(value: unknown): DailySummaryModelOutput {
  return parseDailySummaryContent(value, "output");
}

export function parseDailySummaryOutput(value: unknown): {
  date: string;
  timezone: string;
  recordCount: number;
  summary: string;
  keyPoints: string[];
  variants?: DailySummaryVariants;
  claims?: DailySummaryClaim[];
  sources?: DailySummarySource[];
} {
  const output = object(value, "output");
  onlyKeys(output, ["date", "timezone", "recordCount", "summary", "keyPoints", "variants", "claims", "sources"], "output");
  const date = requiredString(output.date, "output.date", 10);
  if (!isValidCalendarDate(date)) throw new BrainValidationError("output.date must be valid YYYY-MM-DD calendar date");
  const timezone = requiredString(output.timezone, "output.timezone", MAX_DAILY_SUMMARY_TIMEZONE_BYTES).trim();
  if (!isValidTimeZone(timezone)) throw new BrainValidationError("output.timezone must be valid IANA timezone");
  if (!Number.isInteger(output.recordCount) || (output.recordCount as number) < 0 || (output.recordCount as number) > 100) {
    throw new BrainValidationError("output.recordCount must be an integer from 0 to 100");
  }
  const content = parseDailySummaryContent({
    summary: output.summary,
    keyPoints: output.keyPoints,
    ...(output.variants === undefined ? {} : { variants: output.variants }),
    ...(output.claims === undefined ? {} : { claims: output.claims }),
  }, "output");
  return {
    date,
    timezone,
    recordCount: output.recordCount as number,
    ...content,
    ...(output.sources === undefined ? {} : { sources: parseDailySummarySources(output.sources, "output.sources") }),
  };
}

type VoiceContextType = "work" | "decision" | "insight" | "plan" | "question" | "reflection";

function nullableString(value: unknown, name: string, maxBytes: number): string | null {
  if (value === null) return null;
  return requiredString(value, name, maxBytes).trim();
}

function stringList(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new BrainValidationError(`${name} must be an array`);
  if (value.length > 20) throw new BrainValidationError(`${name} must contain at most 20 items`);
  return value.map((item, index) => requiredString(item, `${name}[${index}]`, 4096).trim());
}

export function parseVoiceContextDraftOutput(value: unknown) {
  const output = object(value, "output");
  onlyKeys(output, ["summary", "decisions", "insights", "next", "questions", "suggestedWork", "topic", "contextType"], "output");
  const contextType = output.contextType === null ? null : output.contextType;
  if (contextType !== null && !["work", "decision", "insight", "plan", "question", "reflection"].includes(String(contextType))) {
    throw new BrainValidationError("output.contextType is invalid");
  }
  return {
    summary: requiredString(output.summary, "output.summary", MAX_VOICE_DRAFT_FIELD_BYTES).trim(),
    decisions: stringList(output.decisions, "output.decisions"),
    insights: stringList(output.insights, "output.insights"),
    next: stringList(output.next, "output.next"),
    questions: stringList(output.questions, "output.questions"),
    suggestedWork: nullableString(output.suggestedWork, "output.suggestedWork", 4096),
    topic: nullableString(output.topic, "output.topic", 4096),
    contextType: contextType as VoiceContextType | null,
  };
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
    variants: {
      type: "object",
      properties: {
        quick: { type: "string", minLength: 1, maxBytes: MAX_SUMMARIZE_CONTENT_BYTES },
        standard: { type: "string", minLength: 1, maxBytes: MAX_SUMMARIZE_CONTENT_BYTES },
        deep: { type: "string", minLength: 1, maxBytes: MAX_SUMMARIZE_CONTENT_BYTES },
      },
      required: ["quick", "standard", "deep"],
      additionalProperties: false,
    },
    claims: {
      type: "array",
      maxItems: MAX_DAILY_SUMMARY_CLAIMS,
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1, maxBytes: 128 },
          text: { type: "string", minLength: 1, maxBytes: 4096 },
          sourceIds: { type: "array", items: { type: "string", minLength: 1, maxBytes: 256 }, maxItems: MAX_DAILY_SUMMARY_SOURCE_IDS },
          support: { type: "string", enum: [...DAILY_SUMMARY_SUPPORT_STATUSES] },
        },
        required: ["id", "text", "sourceIds", "support"],
        additionalProperties: false,
      },
    },
    sources: {
      type: "array",
      maxItems: MAX_DAILY_SUMMARY_SOURCES,
      items: {
        type: "object",
        properties: {
          recordId: { type: "string", minLength: 1, maxBytes: 256 },
          preview: { type: "string", minLength: 1, maxBytes: MAX_DAILY_SUMMARY_SOURCE_PREVIEW_BYTES },
          recordedAt: { type: "string", minLength: 1, maxBytes: 64 },
          client: { type: "string", minLength: 1, maxBytes: 128 },
          title: { type: "string", minLength: 1, maxBytes: 512 },
          url: { type: "string", minLength: 1, maxBytes: 2048 },
        },
        required: ["recordId", "preview", "recordedAt", "client"],
        additionalProperties: false,
      },
    },
  },
  required: ["date", "timezone", "recordCount", "summary", "keyPoints"],
  additionalProperties: false,
};

export const dailySummaryModelOutputSchema = {
  type: "object",
  properties: {
    summary: { type: "string", minLength: 1, maxBytes: MAX_SUMMARIZE_CONTENT_BYTES },
    keyPoints: { type: "array", items: { type: "string" }, maxItems: 20 },
    variants: dailySummaryOutputSchema.properties.variants,
    claims: dailySummaryOutputSchema.properties.claims,
  },
  required: ["summary", "keyPoints"],
  additionalProperties: false,
};

export const voiceContextDraftInputSchema = {
  type: "object",
  properties: {
    transcript: { type: "string", minLength: 1, maxBytes: MAX_VOICE_TRANSCRIPT_BYTES },
  },
  required: ["transcript"],
  additionalProperties: false,
};

export const voiceContextDraftOutputSchema = {
  type: "object",
  properties: {
    summary: { type: "string", minLength: 1, maxBytes: MAX_VOICE_DRAFT_FIELD_BYTES },
    decisions: { type: "array", items: { type: "string" }, maxItems: 20 },
    insights: { type: "array", items: { type: "string" }, maxItems: 20 },
    next: { type: "array", items: { type: "string" }, maxItems: 20 },
    questions: { type: "array", items: { type: "string" }, maxItems: 20 },
    suggestedWork: { type: ["string", "null"], maxBytes: 4096 },
    topic: { type: ["string", "null"], maxBytes: 4096 },
    contextType: {
      type: ["string", "null"],
      enum: ["work", "decision", "insight", "plan", "question", "reflection", null],
    },
  },
  required: ["summary", "decisions", "insights", "next", "questions", "suggestedWork", "topic", "contextType"],
  additionalProperties: false,
};
