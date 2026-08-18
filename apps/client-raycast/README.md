# Context OS

Capture and restore personal context.

## Development workflow

This project runs from the production bundle in `dist`.

Build the standalone extension, then use Raycast's **Import Extension** action and select the generated `dist` directory (not the project root).

```bash
pnpm build
```

The imported extension runs from `dist` and does not require `npm run dev` to remain running.

Use the **Context Settings** command to confirm whether Raycast points to a
local Context Server or a Cloudflare Worker. Recent Captures, Remote Records,
and Capture all use the configured URL and token. Choose **Edit Extension
Preferences** from that screen to update them, then use **Check Connection**
to verify read access. The token must have both `read` and `write` scopes, and
its value is never displayed.

Raycast requires a local Worker/D1 or deployed Cloudflare Worker; it cannot
read Chrome extension-local storage directly. See
[`docs/setup-modes.md`](../../docs/setup-modes.md) for both setup paths.

## Voice Capture

On macOS, configure **Brain Server URL**, **Whisper CLI Path**, and **Whisper Model Path** in Extension Preferences. The default Brain Server is local at `http://127.0.0.1:8788`. Voice Capture sends transcript text to server-brain; it never uploads audio. The four Voice Capture commands use a 15-minute in-memory rolling buffer and always show an editable Draft before saving to Context Server.

## Raycast Store preflight

The manifest identifies the extension as `ThreeLightStudio`. Local builds,
`pnpm verify`, and Raycast **Import Extension** do not need a Raycast publisher
account. This keeps the open-source repository usable by everyone without an
external account lookup.

`author` identifies the Store publisher, not the person using the extension.
Do not edit it for Custom Import, local use, or Cloudflare setup; those paths
leave the working tree unchanged.

Raycast Store submission is separate: Raycast validates the `author` value
against a real Raycast publisher account. Only when submitting this extension
to the Store, create or claim the `ThreeLightStudio` publisher account and run:

```sh
pnpm --filter context-os lint:store
```

Forks can use Custom Import unchanged. A fork that intends to publish to the
Raycast Store must deliberately replace `author` with its own registered
Raycast username and commit that publisher-attribution change to its fork
before running the Store preflight. It is not a per-user local setting.

For every subsequent UI or functionality change:

1. Run `pnpm build`.
2. Use Raycast's **Import Extension** action to load the newly generated `dist` directory. A reload or restart alone does not reliably load updated files from `dist`.
3. Open the modified command and verify it in the actual Raycast UI.

Do not re-import the extension after the initial installation. A successful build alone does not complete a task.
