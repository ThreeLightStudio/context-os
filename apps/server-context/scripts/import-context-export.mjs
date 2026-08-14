import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const MAX_CAPTURE_BYTES = 32 * 1024;
const headingPattern = /^## (\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*$/gm;
const encoder = new TextEncoder();

function stableUuid(value) {
  const bytes = createHash("sha256").update(value).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function normalizeTimezone(timezone) {
  if (!/^[+-](?:0\d|1\d|2[0-3]):[0-5]\d$/.test(timezone)) {
    throw new Error("--timezone must use the form +09:00 or -05:00");
  }
  return timezone;
}

function trimExportSeparators(value) {
  return value.replace(/^\r?\n+/, "").replace(/\r?\n+$/, "");
}

export function parseContextExport(markdown, { timezone = "+09:00" } = {}) {
  const offset = normalizeTimezone(timezone);
  const headings = [...markdown.matchAll(headingPattern)];
  if (headings.length === 0) {
    throw new Error("No capture headings found. Expected headings such as '## 2026-07-25 14:18'.");
  }

  return headings.map((heading, ordinal) => {
    const capturedAt = heading[1];
    const bodyStart = heading.index + heading[0].length;
    const bodyEnd = headings[ordinal + 1]?.index ?? markdown.length;
    const content = trimExportSeparators(markdown.slice(bodyStart, bodyEnd));
    if (content.length === 0) throw new Error(`Capture ${ordinal + 1} (${capturedAt}) has empty content.`);

    const instant = new Date(`${capturedAt.replace(" ", "T")}:00${offset}`);
    if (Number.isNaN(instant.valueOf())) throw new Error(`Capture ${ordinal + 1} has an invalid timestamp.`);
    return { ordinal, capturedAt: instant.toISOString(), content };
  });
}

export function buildRecords(captures) {
  const records = captures.map((capture) => ({
    id: stableUuid(`context-export:v1\0${capture.ordinal}\0${capture.capturedAt}\0${capture.content}`),
    recordedAt: capture.capturedAt,
    data: {
      kind: "capture",
      content: capture.content,
      source: { client: "raycast", inputMethod: "context-export" },
    },
  }));
  const oversizeRecords = records
    .map((record, index) => ({ number: index + 1, bytes: encoder.encode(record.data.content).byteLength }))
    .filter((entry) => entry.bytes > MAX_CAPTURE_BYTES);
  return { records, oversizeRecords };
}

function report(records, oversizeRecords) {
  const sizes = records.map((record) => encoder.encode(record.data.content).byteLength);
  return {
    recordCount: records.length,
    recordedAt: { first: records[0]?.recordedAt ?? null, last: records.at(-1)?.recordedAt ?? null },
    largestContentBytes: Math.max(0, ...sizes),
    oversizeRecords,
  };
}

export async function importRecords(records, baseUrl, token) {
  let created = 0;
  let idempotent = 0;
  for (const record of records) {
    const response = await fetch(new URL("/v1/records", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(record),
    });
    if (response.status === 201) created += 1;
    else if (response.status === 200) idempotent += 1;
    else throw new Error(`Import failed for ${record.id}: HTTP ${response.status} ${await response.text()}`);
  }
  return { created, idempotent };
}

function parseArgs(args) {
  const result = { file: undefined, url: undefined, timezone: "+09:00" };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--") continue;
    if (option === "--file") result.file = args[++index];
    else if (option === "--url") result.url = args[++index];
    else if (option === "--timezone") result.timezone = args[++index];
    else throw new Error(`Unknown option: ${option}`);
  }
  if (!result.file) throw new Error("Usage: pnpm import:context-export -- --file <export.md> [--url <server-url>] [--timezone +09:00]");
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const markdown = await readFile(options.file, "utf8");
  const { records, oversizeRecords } = buildRecords(parseContextExport(markdown, options));
  const summary = report(records, oversizeRecords);
  if (oversizeRecords.length > 0) {
    console.log(JSON.stringify({ ...summary, imported: false }, null, 2));
    throw new Error("Import stopped: one or more captures exceed the 32KB server limit.");
  }
  if (!options.url) {
    console.log(JSON.stringify({ ...summary, imported: false }, null, 2));
    return;
  }
  const token = process.env.CONTEXT_SERVER_TOKEN;
  if (!token) throw new Error("CONTEXT_SERVER_TOKEN is required when --url is provided.");
  const imported = await importRecords(records, options.url, token);
  console.log(JSON.stringify({ ...summary, imported: true, ...imported }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
