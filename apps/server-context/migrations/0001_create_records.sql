-- Immutable, append-only records. The JSON document is the domain payload;
-- columns are intentionally limited to identity, ordering, and schema handling.
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY NOT NULL,
  recorded_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS records_recorded_at_id_idx
  ON records (recorded_at DESC, id DESC);
