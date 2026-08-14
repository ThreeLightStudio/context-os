# Development Guidelines

## Development Workflow

This project uses the production bundle in `dist` as the actual runtime environment.

Whenever UI or functionality is modified:

1. Run `npm run build`.
2. The user imports the generated `dist` directory again in Raycast using **Import Extension**. A Raycast reload or restart alone does not reliably load changes from `dist`.
3. The user opens the modified command and verifies it inside the actual Raycast UI.
4. Do not attempt to control Raycast, import `dist`, or perform Raycast UI/clipboard verification automatically. Report the build result and leave those steps to the user.
5. Only then consider the task complete.

## Development Rules

- Never modify the SQLite schema without approval.
- Never overwrite existing captures.
- Preserve raw captures.
- AI inference is opt-in only.
- Never automatically connect concepts.
- Do not add new dependencies without approval.

## Product Philosophy

Capture first.

Never optimize before validation.

Build the smallest vertical slice.

Every feature must work end-to-end before adding the next one.

## Completion Rule

Build succeeded is **not** completion. A task is complete only after all of the following:

1. `npm run build` succeeds.
2. The user imports the generated `dist` directory in Raycast after the build. Do not treat a Raycast reload or restart alone as sufficient.
3. The user verifies the relevant command in the actual Raycast UI. Do not attempt this verification automatically.
