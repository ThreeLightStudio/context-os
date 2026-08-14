import {
  dailySummaryInputSchema,
  dailySummaryOutputSchema,
  parseDailySummaryInput,
  parseDailySummaryOutput,
  parseSummarizeOutput,
  summarizeOutputSchema,
} from "../schemas/validation.js";
import {
  MAX_DAILY_SUMMARY_CONTEXT_BYTES,
  parseDailySummaryContext,
  resolveDailySummaryContext,
  type DailySummaryContext,
  type DailySummaryInput,
} from "../context/daily-summary-context.js";
import type { ContextRecord } from "../context/server-context-client.js";
import type { ActionDefinition } from "./action-registry.js";

export interface DailySummaryOutput {
  date: string;
  timezone: string;
  recordCount: number;
  summary: string;
  keyPoints: string[];
}

const NO_RECORDS_SUMMARY = "No context records found for the selected date.";
const encoder = new TextEncoder();

const systemPrompt = [
  "You are the Context OS daily-summary action.",
  "Summarize only the supplied Context OS records for the requested local date.",
  "Return only a JSON object with exactly these fields:",
  '{"summary":"string","keyPoints":["string"]}',
  "Do not add markdown fences or any other fields.",
].join(" ");

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function recordPayload(record: ContextRecord, content: string, includeContext: boolean): string {
  return JSON.stringify({
    recordedAt: record.recordedAt,
    client: record.data.source.client,
    content,
    ...(includeContext && record.data.context ? { context: record.data.context } : {}),
  });
}

function fitRecordToBytes(record: ContextRecord, byteBudget: number): string | undefined {
  for (const includeContext of [true, false]) {
    const emptyContent = recordPayload(record, "", includeContext);
    if (byteLength(emptyContent) > byteBudget) continue;

    let low = 1;
    let high = record.data.content.length;
    let best: string | undefined;
    while (low <= high) {
      const middle = Math.ceil((low + high) / 2);
      const candidate = recordPayload(record, record.data.content.slice(0, middle), includeContext);
      if (byteLength(candidate) <= byteBudget) {
        best = candidate;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (best) return best;
  }
  return undefined;
}

function buildUserPrompt(input: DailySummaryInput, records: ContextRecord[]): { prompt: string; recordCount: number } {
  const lines: string[] = [];
  let usedBytes = 0;
  for (const record of records) {
    const line = fitRecordToBytes(record, MAX_DAILY_SUMMARY_CONTEXT_BYTES - usedBytes - 1);
    if (!line) continue;
    lines.push(line);
    usedBytes += byteLength(line) + 1;
  }

  return {
    prompt: [
      `Local date: ${input.date}`,
      `Timezone: ${input.timezone}`,
      "Context records (one JSON object per line):",
      ...lines,
    ].join("\n"),
    recordCount: lines.length,
  };
}

export const dailySummaryAction: ActionDefinition<DailySummaryInput, DailySummaryContext, DailySummaryOutput> = {
  metadata: {
    name: "daily-summary",
    description: "Summarize Context OS records captured during a local calendar date.",
    inputSchema: dailySummaryInputSchema,
    outputSchema: dailySummaryOutputSchema,
  },
  parseInput: parseDailySummaryInput,
  parseOutput: parseDailySummaryOutput,
  resolveContext: (input, dependencies) => resolveDailySummaryContext(input, dependencies.contextSource),
  async execute({ input, context, dependencies }) {
    const resolvedContext = parseDailySummaryContext(context, input);
    const prepared = buildUserPrompt(input, resolvedContext.records);
    const metadata = {
      date: input.date,
      timezone: input.timezone,
      recordCount: prepared.recordCount,
    };

    if (prepared.recordCount === 0) {
      return { ...metadata, summary: NO_RECORDS_SUMMARY, keyPoints: [] };
    }

    const generated = await dependencies.provider.generateStructured({
      systemPrompt,
      userPrompt: prepared.prompt,
      outputFormat: JSON.stringify(summarizeOutputSchema),
    });
    return { ...metadata, ...parseSummarizeOutput(generated) };
  },
};

export { NO_RECORDS_SUMMARY };
