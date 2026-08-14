export const contextCapturePrefix = "<!-- context-os:capture:v1";

export type CaptureSegmentOrigin = "authored" | "imported";
export type CaptureSegmentKind = "text" | "link";

export interface CaptureSegmentMetadata {
  origin: CaptureSegmentOrigin;
  kind: CaptureSegmentKind;
  start: number;
  end: number;
  sourceUrls?: string[];
  sourceDomains?: string[];
  edited?: boolean;
}

export interface CaptureMetadataV1 {
  segments: CaptureSegmentMetadata[];
}

export interface ParsedContextCapture {
  metadata: CaptureMetadataV1;
  body: string;
}

const capturePattern = /^<!-- context-os:capture:v1\n([^\n]+)\n-->\n([\s\S]*)$/;
const urlPattern = /https?:\/\/[^\s<>"'`\])}]+/gi;

function isSegment(value: unknown): value is CaptureSegmentMetadata {
  if (!value || typeof value !== "object") return false;
  const segment = value as Partial<CaptureSegmentMetadata>;
  return (
    (segment.origin === "authored" || segment.origin === "imported") &&
    (segment.kind === "text" || segment.kind === "link") &&
    typeof segment.start === "number" &&
    Number.isInteger(segment.start) &&
    segment.start >= 0 &&
    typeof segment.end === "number" &&
    Number.isInteger(segment.end) &&
    segment.end >= segment.start &&
    (segment.sourceUrls === undefined ||
      (Array.isArray(segment.sourceUrls) && segment.sourceUrls.every((url) => typeof url === "string"))) &&
    (segment.sourceDomains === undefined ||
      (Array.isArray(segment.sourceDomains) && segment.sourceDomains.every((domain) => typeof domain === "string"))) &&
    (segment.edited === undefined || typeof segment.edited === "boolean")
  );
}

function isCaptureMetadata(value: unknown, body: string): value is CaptureMetadataV1 {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Partial<CaptureMetadataV1>;
  return (
    Array.isArray(metadata.segments) &&
    metadata.segments.every((segment) => isSegment(segment) && segment.end <= body.length)
  );
}

export function parseContextCapture(content: string): ParsedContextCapture | null {
  const match = content.match(capturePattern);
  if (!match) return null;

  try {
    const metadata: unknown = JSON.parse(match[1]);
    return isCaptureMetadata(metadata, match[2]) ? { metadata, body: match[2] } : null;
  } catch {
    return null;
  }
}

export function formatContextCapture(metadata: CaptureMetadataV1, body: string) {
  return `${contextCapturePrefix}\n${JSON.stringify(metadata)}\n-->\n${body}`;
}

export function urlsIn(value: string) {
  const urls = value.match(urlPattern) ?? [];
  return [...new Set(urls)];
}

export function domainsFor(urls: string[]) {
  return [
    ...new Set(
      urls.flatMap((url) => {
        try {
          return [new URL(url).hostname];
        } catch {
          return [];
        }
      }),
    ),
  ];
}
