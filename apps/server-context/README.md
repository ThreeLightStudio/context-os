# Context Server

The first Context OS server: a Cloudflare Worker and D1 database for immutable, small text captures from Chrome, Desktop, Mobile, and Raycast clients.

This package lives at `apps/server-context` in the Context OS monorepo. Run
commands from this directory or use the equivalent root-level
`pnpm --filter server-context ...` command.

For the complete Chrome/Raycast local stack and Cloudflare D1 deployment
walkthrough, see [`docs/setup-modes.md`](../../docs/setup-modes.md).

## Read this first

This repository is the server only. The Worker owns the API and D1 is the source of truth for records; GitHub stores code and migrations, not captured data or raw tokens.

For a returning agent, inspect these files first:

- `src/index.ts`: routes, authentication, CORS, security headers, and rate-limit bindings
- `src/auth.ts`: token format, hashing, and scope checks
- `src/record.ts`: capture validation and size limits
- `migrations/`: D1 schema changes, applied in filename order
- `scripts/manage-tokens.mjs`: local-only token creation, listing, and revocation

Local commands use `--local` or no target flag. Commands that use `--remote`, `db:migrate:remote`, or `run deploy` affect Cloudflare and require an explicit deployment decision. Never commit `.dev.vars`, `.env`, raw tokens, or captured data.

## Data model

`records` is append-only during normal capture. An authorized token with the `delete` scope can permanently remove a record. The table deliberately has only five fixed columns: `id`, `recorded_at`, `received_at`, `schema_version`, and `data` (JSON text). The JSON document stores client-specific metadata, while the columns support identity, ordering, and schema interpretation.

The initial API accepts only `capture` records. Empty optional values are removed before storage. Attachments, HTML, DOM/page content, screenshots, and arbitrary metadata are rejected. A JSON request is limited to 128KB; capture text is limited to 32KB.

## Setup

```sh
cp wrangler.jsonc.example wrangler.jsonc
pnpm install
pnpm db:migrate:local
pnpm token:create -- --local --name local --read --write
pnpm dev
```

This runs the Worker at the address Wrangler prints and creates a local D1 database under `.wrangler`.

The token command prints the raw token once. Keep it outside the repository and use it in the API example below. Run it once per local database; repeated runs create additional tokens.

For local Chrome extension testing, create a `.dev.vars` file with an exact origin such as `ALLOWED_ORIGINS=chrome-extension://<extension-id>`. `.dev.vars` is ignored by Git. Native clients and command-line requests do not send an `Origin` header and do not need this setting.

## API

### Create a capture

```sh
curl -X POST http://localhost:8787/v1/records \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer ctx_<token>' \
  --data '{
    "id":"01983f0d-7b32-7b4d-8d5b-8ff24c3b1001",
    "recordedAt":"2026-07-25T09:00:00.000+09:00",
    "data":{"kind":"capture","content":"서버 구조를 시작한다.","source":{"client":"desktop"}}
  }'
```

The client creates the UUID. Repeating the exact same request returns `200` with `idempotent: true`; reusing the ID with different content returns `409`.

`GET /v1/records?limit=50&cursor=<cursor>` lists newest records first by the actual instant represented by `recordedAt`. `limit` is 1–100; the opaque cursor is returned as `nextCursor`.

`DELETE /v1/records/:id` permanently removes one record and returns `204`; it returns `404` if the record does not exist. It requires a token with the `delete` scope.

The API allows cross-origin `GET`, `POST`, and preflight `OPTIONS` for configured browser origins so a Chrome extension can use the same endpoint.

Every API request except an allowed CORS preflight requires a device token:

```http
Authorization: Bearer ctx_<token>
```

Tokens are stored only as SHA-256 hashes in D1. `POST` requires the `write` scope, `GET` requires `read`, and `DELETE` requires `delete`. A `401` means the token is missing, invalid, or revoked; `403` means the token does not have the required scope. Record responses are marked `Cache-Control: no-store`.

The browser allow-list is configured with the comma-separated `ALLOWED_ORIGINS` variable. Register exact Chrome extension origins such as `chrome-extension://<extension-id>`; native clients do not need a CORS origin.

## Manage device tokens

Token management is intentionally local-CLI-only; the public Worker does not expose an admin token API. The default target is the local D1 database. Use `--remote` only after authenticating Wrangler and applying migrations.

```sh
pnpm token:create -- --remote --name desktop --read --write
pnpm token:create -- --remote --name admin --read --write --delete
pnpm token:list -- --remote
pnpm token:revoke -- --remote --id <token-id>
```

The create command prints the raw token once. Store it in the client or a password manager; it cannot be recovered from D1 after the command exits. Token lifetime is manual: revoke and replace a token when a device is lost or replaced.

Allowed browser metadata is `context.browser.url`, `title`, and `selectedText`; desktop metadata is `activeApplication` and `windowTitle`; mobile metadata is `sharedUrl`, `sharedTitle`, and `captureSurface`.

The repository does not implement file or screenshot upload. Attachments, HTML, DOM/page content, and arbitrary metadata are rejected by the record validator.

## Deploy

The production resources are named `server-context` (Worker) and `db-context`
(D1). The package name is also `server-context` for workspace commands.

1. Authenticate once: `pnpm exec wrangler login`.
2. Create the D1 database: `pnpm exec wrangler d1 create db-context`.
3. Copy the returned `database_id` into `wrangler.jsonc` (replace the all-zero placeholder) and set its Worker name to `server-context`.
4. Set `ALLOWED_ORIGINS` to the exact production browser origins.
5. Confirm the three Rate Limit namespace IDs in `wrangler.jsonc` are available in the account.
6. Apply production migrations: `pnpm db:migrate:remote`.
7. Create at least one remote token with `pnpm token:create -- --remote ...`.
8. Deploy: `pnpm run deploy`.

Do not run steps 6–8 against an unknown account or database. Before the first remote deployment, verify the account with `pnpm exec wrangler whoami`, review the `database_id`, and confirm that the migration target is `db-context`. A placeholder `database_id`, an empty production `ALLOWED_ORIGINS`, or an unconfirmed Rate Limit namespace is a stop condition.

Cloudflare account MFA should be enabled, and CI or automation should use a narrowly scoped API token rather than a Global API Key. The configured Rate Limit bindings are 120 POSTs/minute/IP, 60 GETs/minute/IP, and 10 DELETEs/minute/IP. The Worker returns `429` with `Retry-After: 60` when a binding rejects a request.

## Verification

```sh
pnpm verify
```

## Import a Context Export

The importer accepts the Markdown created by the legacy **Context Export** action. It uses each `## YYYY-MM-DD HH:mm` heading as a capture boundary, preserves the body verbatim (including Context-OS event headers), and assumes Korea Standard Time by default. IDs are deterministically derived from the export, so repeating an interrupted import is safe.

First inspect the export without writing records:

```sh
pnpm import:context-export -- --file /path/to/context-export.md
```

Then import into a running Worker. Set `CONTEXT_SERVER_TOKEN` in the process environment from a password manager or secret store; do not pass it as a command-line option or commit it:

```sh
export CONTEXT_SERVER_TOKEN='store-the-token-outside-shell-history-when-possible'
pnpm import:context-export -- --file /path/to/context-export.md --url http://127.0.0.1:8787
```

The import stops before writing anything if any capture exceeds the current 32KB content limit. Use `--timezone +09:00` to override the default timestamp offset when needed.

This typechecks the Worker and runs the Worker security, token CLI, importer, and record-contract tests.
