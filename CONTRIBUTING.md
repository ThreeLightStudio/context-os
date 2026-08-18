# Contributing

## Setup

Use Node.js 22 or newer and pnpm 11.

```sh
pnpm install
pnpm verify
```

Keep changes scoped to the relevant app. Run the app-specific build and tests
before opening a pull request. Do not commit API tokens, `.dev.vars`, `.env`
files, captured context, `.wrangler` state, or generated `dist` output.

## Issues and change tracking

Small documentation, formatting, typo, and isolated bug fixes may be committed
directly when their scope is clear. For features, i18n, architecture, API or
schema changes, and work spanning multiple packages, search for an existing
Issue or open one before implementation.

Include the motivation, scope, acceptance criteria, and verification plan in a
new Issue. Keep larger changes on a focused branch and connect the pull request
to its Issue.

Use the type-specific Issue template. It adds the matching title prefix
(`[feat]`, for example) and label (`type:<type>`). Set priority through the
repository's configured Project field. The Issue label must match the type at
the start of the branch name.

## Branches

Create new branches with the repository CLI:

```sh
pnpm branch feat 123 add-sso
```

The supported types are `feat`, `fix`, `refactor`, `docs`, and `chore`. This
creates a branch using the format `<type>/<issue-number>-<short-kebab-slug>`.
Use the CLI before starting work so the branch name is valid from the outset.

## Pull requests

Describe the affected client/server, the user-visible behavior, and the
verification commands you ran. In the related Issue section, replace the
placeholder with `Fixes #<issue-number>` (or an equivalent closing keyword).
The branch-name workflow verifies that this Issue number and its `type:<type>`
label match the source branch. Use the PR title format
`[type] Short summary (#issue-number)` and keep its type and summary aligned
with the Issue title. GitHub closes the Issue when the pull request is merged
into the default branch. Include screenshots or recordings for UI changes when
useful. Do not include private captures or production configuration in
screenshots, logs, or examples.
