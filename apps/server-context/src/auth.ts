export const TOKEN_PREFIX = "ctx_";
export const TOKEN_BYTES = 32;

export type TokenRow = {
  id: string;
  name: string;
  token_hash: string;
  can_read: number;
  can_write: number;
  can_delete: number;
  created_at: string;
  revoked_at: string | null;
};

export type TokenScope = "read" | "write" | "delete";

export type AuthenticatedToken = {
  id: string;
  name: string;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
};

const tokenPattern = /^ctx_[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();

function toHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function hashToken(token: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
}

export async function generateToken(): Promise<{ token: string; tokenHash: string }> {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  const token = `${TOKEN_PREFIX}${toBase64Url(bytes)}`;
  return { token, tokenHash: await hashToken(token) };
}

function extractBearerToken(request: Request): string | undefined {
  const value = request.headers.get("authorization");
  const match = value?.match(/^Bearer\s+([^\s]+)$/i);
  if (!match || !tokenPattern.test(match[1])) return undefined;
  return match[1];
}

export async function authenticate(request: Request, db: D1Database): Promise<AuthenticatedToken | undefined> {
  const token = extractBearerToken(request);
  if (!token) return undefined;

  const tokenHash = await hashToken(token);
  const row = await db.prepare(
    "SELECT id, name, token_hash, can_read, can_write, can_delete, created_at, revoked_at FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL",
  ).bind(tokenHash).first<TokenRow>();
  if (!row) return undefined;

  return {
    id: row.id,
    name: row.name,
    canRead: row.can_read === 1,
    canWrite: row.can_write === 1,
    canDelete: row.can_delete === 1,
  };
}

export function hasScope(token: AuthenticatedToken, scope: TokenScope): boolean {
  if (scope === "read") return token.canRead;
  if (scope === "write") return token.canWrite;
  return token.canDelete;
}
