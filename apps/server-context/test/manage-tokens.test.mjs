import { describe, expect, it } from "vitest";
import {
  buildCreateSql,
  buildListSql,
  buildRevokeSql,
  generateRawToken,
  hashRawToken,
  parseCreateArgs,
  parseRevokeArgs,
} from "../scripts/manage-tokens.mjs";

describe("token management CLI", () => {
  it("parses scoped remote token creation", () => {
    expect(parseCreateArgs(["--remote", "--name", "desktop", "--read", "--write"])).toEqual({
      target: "remote",
      name: "desktop",
      canRead: true,
      canWrite: true,
      canDelete: false,
    });
  });

  it("rejects conflicting targets and missing scopes", () => {
    expect(() => parseCreateArgs(["--remote", "--local", "--name", "desktop", "--write"])).toThrow("only one");
    expect(() => parseCreateArgs(["--name", "desktop"])).toThrow("At least one");
  });

  it("creates SQL that contains only the hash, never the raw token", () => {
    const token = generateRawToken();
    const sql = buildCreateSql({
      id: "1f3c7b5d-8b2e-4d1a-9c31-7e5a4f6b8d90",
      name: "desktop",
      tokenHash: hashRawToken(token),
      canRead: true,
      canWrite: true,
      canDelete: false,
      createdAt: "2026-08-05T00:00:00.000Z",
    });
    expect(sql).toContain(hashRawToken(token));
    expect(sql).not.toContain(token);
    expect(sql).toContain("can_read");
  });

  it("revokes only the selected token and lists metadata without hashes", () => {
    const id = "1f3c7b5d-8b2e-4d1a-9c31-7e5a4f6b8d90";
    expect(parseRevokeArgs(["--remote", "--id", id])).toEqual({ target: "remote", id });
    expect(buildRevokeSql({ id, revokedAt: "2026-08-05T00:00:00.000Z" })).toContain(`WHERE id = '${id}'`);
    expect(buildListSql()).not.toContain("token_hash");
  });
});
