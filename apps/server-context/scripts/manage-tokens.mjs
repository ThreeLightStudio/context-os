import { execFile as execFileCallback } from "node:child_process";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tokenPrefix = "ctx_";
const tokenBytes = 32;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function targetArgs(target) {
  return target === "remote" ? ["--remote"] : ["--local"];
}

function parseCommonArgs(args) {
  let target;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--") continue;
    if (option === "--remote" || option === "--local") {
      const nextTarget = option.slice(2);
      if (target && target !== nextTarget) throw new Error("Choose only one of --remote or --local.");
      target = nextTarget;
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }
  return { target: target ?? "local" };
}

export function parseCreateArgs(args) {
  const result = { ...parseCommonArgs(args.filter((option) => option === "--remote" || option === "--local" || option === "--")), name: undefined, canRead: false, canWrite: false, canDelete: false };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--" || option === "--remote" || option === "--local") continue;
    if (option === "--name") result.name = args[++index];
    else if (option === "--read") result.canRead = true;
    else if (option === "--write") result.canWrite = true;
    else if (option === "--delete") result.canDelete = true;
    else throw new Error(`Unknown option: ${option}`);
  }
  if (typeof result.name !== "string" || result.name.trim().length === 0) throw new Error("--name is required");
  if (Buffer.byteLength(result.name, "utf8") > 128) throw new Error("--name must be at most 128 bytes");
  if (!result.canRead && !result.canWrite && !result.canDelete) throw new Error("At least one of --read, --write, or --delete is required");
  return result;
}

export function parseRevokeArgs(args) {
  const result = { ...parseCommonArgs(args.filter((option) => option === "--remote" || option === "--local" || option === "--")), id: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--" || option === "--remote" || option === "--local") continue;
    if (option === "--id") result.id = args[++index];
    else throw new Error(`Unknown option: ${option}`);
  }
  if (typeof result.id !== "string" || !uuidPattern.test(result.id)) throw new Error("--id must be a UUID");
  return result;
}

export function buildCreateSql({ id, name, tokenHash, canRead, canWrite, canDelete, createdAt }) {
  return [
    "INSERT INTO api_tokens (id, name, token_hash, can_read, can_write, can_delete, created_at, revoked_at)",
    `VALUES (${sqlString(id)}, ${sqlString(name)}, ${sqlString(tokenHash)}, ${canRead ? 1 : 0}, ${canWrite ? 1 : 0}, ${canDelete ? 1 : 0}, ${sqlString(createdAt)}, NULL);`,
  ].join(" ");
}

export function buildRevokeSql({ id, revokedAt }) {
  return `UPDATE api_tokens SET revoked_at = ${sqlString(revokedAt)} WHERE id = ${sqlString(id)} AND revoked_at IS NULL;`;
}

export function buildListSql() {
  return "SELECT id, name, can_read, can_write, can_delete, created_at, revoked_at FROM api_tokens ORDER BY created_at ASC;";
}

export function generateRawToken() {
  return `${tokenPrefix}${randomBytes(tokenBytes).toString("base64url")}`;
}

export function hashRawToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function executeD1(sql, target) {
  const { stdout } = await execFile("pnpm", ["exec", "wrangler", "d1", "execute", "db-context", ...targetArgs(target), "--command", sql], {
    cwd: projectRoot,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

async function createToken(args) {
  const options = parseCreateArgs(args);
  const token = generateRawToken();
  const tokenHash = hashRawToken(token);
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  await executeD1(buildCreateSql({ id, name: options.name.trim(), tokenHash, canRead: options.canRead, canWrite: options.canWrite, canDelete: options.canDelete, createdAt }), options.target);
  console.log(`Token created: ${id}`);
  console.log("Save this token now. It will not be shown again:");
  console.log(token);
}

async function revokeToken(args) {
  const options = parseRevokeArgs(args);
  await executeD1(buildRevokeSql({ id: options.id.toLowerCase(), revokedAt: new Date().toISOString() }), options.target);
  console.log(`Token revoked: ${options.id.toLowerCase()}`);
}

async function listTokens(args) {
  const options = parseCommonArgs(args);
  const output = await executeD1(buildListSql(), options.target);
  process.stdout.write(output);
}

export async function main(args) {
  const [action, ...rest] = args.filter((arg, index) => !(index === 0 && arg === "--"));
  if (action === "create") return createToken(rest);
  if (action === "revoke") return revokeToken(rest);
  if (action === "list") return listTokens(rest);
  throw new Error("Usage: node scripts/manage-tokens.mjs <create|revoke|list> [options]");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
