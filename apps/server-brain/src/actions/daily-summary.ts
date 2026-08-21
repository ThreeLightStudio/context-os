import {
  dailySummaryInputSchema,
  dailySummaryModelOutputSchema,
  dailySummaryOutputSchema,
  parseDailySummaryModelOutput,
  parseDailySummaryInput,
  parseDailySummaryOutput,
  type DailySummaryClaim,
  type DailySummarySource,
  type DailySummaryVariants,
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
  variants?: DailySummaryVariants;
  claims?: DailySummaryClaim[];
  sources?: DailySummarySource[];
}

const NO_RECORDS_SUMMARY = "No context records found for the selected date.";
const encoder = new TextEncoder();

const systemPrompt = [
  "You are the Context OS daily-summary action.",
  "Summarize only the supplied Context OS records for the requested local date.",
  "Return only a JSON object with summary, keyPoints, variants, and claims fields.",
  "The variants object must contain quick, standard, and deep answers that use the same facts and sources but different explanation depth.",
  "Each claim must contain an id, text, sourceIds, and support. sourceIds may contain only record IDs supplied in the records. support must be one of direct, partial, unverified, or conflict.",
  '{"summary":"string","keyPoints":["string"],"variants":{"quick":"string","standard":"string","deep":"string"},"claims":[{"id":"string","text":"string","sourceIds":["record-id"],"support":"direct|partial|unverified|conflict"}]}',
  "If a claim cannot be directly supported by the supplied records, mark it unverified and use an empty sourceIds array.",
  "Do not add markdown fences or any other fields.",
].join(" ");

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function recordPayload(record: ContextRecord, content: string, includeContext: boolean): string {
  return JSON.stringify({
    id: record.id,
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

function createFallbackVariants(summary: string, keyPoints: string[]): DailySummaryVariants {
  const deep = keyPoints.length > 0 ? `${summary}\n\n${keyPoints.map((point) => `- ${point}`).join("\n")}` : summary;
  return { quick: summary, standard: summary, deep };
}

function normalizeClaims(claims: DailySummaryClaim[], validSourceIds: Set<string>): DailySummaryClaim[] {
  return claims.map((claim) => {
    const sourceIds = [...new Set(claim.sourceIds)].filter((sourceId) => validSourceIds.has(sourceId));
    return {
      ...claim,
      sourceIds,
      support: sourceIds.length === 0 ? "unverified" : claim.support,
    };
  });
}

function toSource(record: ContextRecord): DailySummarySource {
  const browser = record.data.context?.browser;
  const browserContext = browser && typeof browser === "object" && !Array.isArray(browser)
    ? browser as Record<string, unknown>
    : undefined;
  const title = typeof browserContext?.title === "string" ? browserContext.title.trim() : undefined;
  const url = typeof browserContext?.url === "string" ? browserContext.url.trim() : undefined;
  const preview = record.data.content.trim().slice(0, 240) || "(empty record)";
  return {
    recordId: record.id,
    preview,
    recordedAt: record.recordedAt,
    client: record.data.source.client,
    ...(title ? { title } : {}),
    ...(url ? { url } : {}),
  };
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
      return { ...metadata, summary: NO_RECORDS_SUMMARY, keyPoints: [], sources: [] };
    }

    const generated = await dependencies.provider.generateStructured({
      systemPrompt,
      userPrompt: prepared.prompt,
      outputFormat: JSON.stringify(dailySummaryModelOutputSchema),
    });
    const content = parseDailySummaryModelOutput(generated);
    const sources = resolvedContext.records.map(toSource);
    const validSourceIds = new Set(sources.map((source) => source.recordId));
    return {
      ...metadata,
      summary: content.summary,
      keyPoints: content.keyPoints,
      variants: content.variants ?? createFallbackVariants(content.summary, content.keyPoints),
      claims: normalizeClaims(content.claims ?? [], validSourceIds),
      sources,
    };
  },
};

export { NO_RECORDS_SUMMARY };
