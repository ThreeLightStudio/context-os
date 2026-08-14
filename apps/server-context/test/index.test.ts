import { describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";
import { generateToken, hashToken, type TokenRow } from "../src/auth";

type FakeRecord = { id: string; recorded_at: string; received_at: string; schema_version: number; data: string };

class FakeStatement {
  private args: unknown[] = [];

  constructor(private readonly db: FakeDb, private readonly sql: string) {}

  bind(...args: unknown[]): this {
    this.args = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM api_tokens")) {
      const token = this.db.token;
      if (!token || token.token_hash !== this.args[0] || token.revoked_at !== null) return null;
      return token as T;
    }
    if (this.sql.includes("FROM records WHERE id")) {
      return (this.db.records.get(this.args[0] as string) ?? null) as T | null;
    }
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [...this.db.records.values()] as T[] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    if (this.sql.startsWith("INSERT OR IGNORE INTO records")) {
      const [id, recordedAt, receivedAt, schemaVersion, data] = this.args as [string, string, string, number, string];
      if (this.db.records.has(id)) return { meta: { changes: 0 } };
      this.db.records.set(id, { id, recorded_at: recordedAt, received_at: receivedAt, schema_version: schemaVersion, data });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("DELETE FROM records")) {
      return { meta: { changes: this.db.records.delete(this.args[0] as string) ? 1 : 0 } };
    }
    return { meta: { changes: 0 } };
  }
}

class FakeDb {
  token: TokenRow | undefined;
  records = new Map<string, FakeRecord>();

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }
}

const payload = {
  id: "01983f0d-7b32-7b4d-8d5b-8ff24c3b1001",
  recordedAt: "2026-07-25T09:00:00.000+09:00",
  data: { kind: "capture", content: "보안 테스트 기록", source: { client: "desktop" } },
};

async function setupToken(db: FakeDb, scopes: { read?: boolean; write?: boolean; delete?: boolean } = {}) {
  const generated = await generateToken();
  db.token = {
    id: "1f3c7b5d-8b2e-4d1a-9c31-7e5a4f6b8d90",
    name: "test-token",
    token_hash: generated.tokenHash,
    can_read: scopes.read ? 1 : 0,
    can_write: scopes.write ? 1 : 0,
    can_delete: scopes.delete ? 1 : 0,
    created_at: "2026-08-05T00:00:00.000Z",
    revoked_at: null,
  };
  return generated.token;
}

function env(db: FakeDb, extra: Partial<Env> = {}): Env {
  return { DB: db as unknown as D1Database, ALLOWED_ORIGINS: "chrome-extension://test", ...extra };
}

function request(url: string, init: RequestInit = {}) {
  return new Request(`https://context.example${url}`, init) as unknown as Parameters<typeof worker.fetch>[0];
}

describe("record API security", () => {
  it("requires authentication and advertises Bearer auth", async () => {
    const response = await worker.fetch(request("/v1/records"), env(new FakeDb()));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 401 for invalid and revoked tokens", async () => {
    const db = new FakeDb();
    const response = await worker.fetch(request("/v1/records", { headers: { authorization: "Bearer ctx_invalid" } }), env(db));
    expect(response.status).toBe(401);

    const token = await setupToken(db, { read: true });
    db.token!.revoked_at = "2026-08-05T01:00:00.000Z";
    const revoked = await worker.fetch(request("/v1/records", { headers: { authorization: `Bearer ${token}` } }), env(db));
    expect(revoked.status).toBe(401);
  });

  it("enforces read, write, and delete scopes independently", async () => {
    const db = new FakeDb();
    const writeToken = await setupToken(db, { write: true });
    const readResponse = await worker.fetch(request("/v1/records", { headers: { authorization: `Bearer ${writeToken}` } }), env(db));
    expect(readResponse.status).toBe(403);

    const deleteResponse = await worker.fetch(request(`/v1/records/${payload.id}`, { method: "DELETE", headers: { authorization: `Bearer ${writeToken}` } }), env(db));
    expect(deleteResponse.status).toBe(403);
  });

  it("allows configured origins and blocks unconfigured origins", async () => {
    const db = new FakeDb();
    const token = await setupToken(db, { read: true });
    const allowed = await worker.fetch(request("/v1/records", { headers: { authorization: `Bearer ${token}`, origin: "chrome-extension://test" } }), env(db));
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("chrome-extension://test");
    expect(allowed.headers.get("access-control-allow-headers")).toContain("authorization");
    expect(allowed.headers.get("vary")).toBe("Origin");

    const blocked = await worker.fetch(request("/v1/records", { headers: { authorization: `Bearer ${token}`, origin: "https://untrusted.example" } }), env(db));
    expect(blocked.status).toBe(403);
    expect(blocked.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("requires JSON content type before accepting a write", async () => {
    const db = new FakeDb();
    const token = await setupToken(db, { write: true });
    const response = await worker.fetch(request("/v1/records", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    }), env(db));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "content-type must be application/json" });
  });

  it("accepts a scoped write and marks the response uncacheable", async () => {
    const db = new FakeDb();
    const token = await setupToken(db, { write: true });
    const response = await worker.fetch(request("/v1/records", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    }), env(db));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(db.records.has(payload.id)).toBe(true);
  });

  it("only allows delete scope to remove records", async () => {
    const db = new FakeDb();
    db.records.set(payload.id, { id: payload.id, recorded_at: "2026-07-25T00:00:00.000Z", received_at: "2026-08-05T00:00:00.000Z", schema_version: 1, data: JSON.stringify(payload.data) });
    const token = await setupToken(db, { delete: true });
    const response = await worker.fetch(request(`/v1/records/${payload.id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } }), env(db));
    expect(response.status).toBe(204);
    expect(db.records.has(payload.id)).toBe(false);
  });

  it("returns 429 when the Cloudflare rate limit binding rejects a request", async () => {
    const db = new FakeDb();
    const response = await worker.fetch(request("/v1/records", { method: "POST" }), env(db, {
      RATE_LIMIT_POST: { limit: async () => ({ success: false }) },
    }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });
});

describe("token hashing", () => {
  it("generates a 32-byte opaque token and stores only its hash", async () => {
    const generated = await generateToken();
    expect(generated.token).toMatch(/^ctx_[A-Za-z0-9_-]{43}$/);
    expect(generated.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(generated.tokenHash).not.toContain(generated.token);
    expect(await hashToken(generated.token)).toBe(generated.tokenHash);
  });
});
