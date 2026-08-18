export type ContextSource = {
  client: string;
  [key: string]: unknown;
};

export type ContextRecord = {
  id: string;
  recordedAt: string;
  receivedAt: string;
  schemaVersion: 1;
  data: {
    kind: "capture";
    content: string;
    contextId?: string;
    revision?: number;
    previousRecordId?: string;
    source: ContextSource;
    context?: Record<string, unknown>;
    [key: string]: unknown;
  };
};

export type ContextRecordsPage = {
  records: ContextRecord[];
  nextCursor: string | null;
};

export type CreateRecordResponse = {
  record: ContextRecord;
  idempotent: boolean;
};

export type GetRecordResponse = {
  record: ContextRecord;
};

export type McpContextType = "capture" | "decision" | "insight" | "next";

export type Work = {
  id: string;
  name: string;
  createdAt: string;
};

export type WorkAssociation = "explicit" | "timeline-derived";

export type NormalizedContextRecord = {
  id: string;
  contextId: string;
  revision: number;
  previousRecordId?: string;
  recordedAt: string;
  receivedAt: string;
  type: string;
  content: string;
  work?: Work & { association: WorkAssociation };
  source: ContextSource;
  context?: Record<string, unknown>;
};
