-- Long-lived device credentials. Only a SHA-256 hash of each token is stored.
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  can_read INTEGER NOT NULL DEFAULT 0 CHECK (can_read IN (0, 1)),
  can_write INTEGER NOT NULL DEFAULT 0 CHECK (can_write IN (0, 1)),
  can_delete INTEGER NOT NULL DEFAULT 0 CHECK (can_delete IN (0, 1)),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS api_tokens_active_hash_idx
  ON api_tokens (token_hash, revoked_at);
