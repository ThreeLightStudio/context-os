# Contributing

## Setup

Use Node.js 22 or newer and pnpm 11.

```sh
pnpm install
pnpm verify
```

Keep changes scoped to the relevant app. Run app-specific build tests before
opening a pull request. Do not commit API tokens, `.dev.vars`, `.env` files,
captured context, `.wrangler` state, generated `dist` output, or local
configuration.

## Issues and change tracking

Small documentation, formatting, typo, or isolated bug fixes may be committed
directly when the scope is clear. For features, i18n, architecture, API or
schema changes, or work spanning multiple packages, search for an existing
Issue or open one before implementation. Include motivation, scope, acceptance
criteria, and a verification plan in a new Issue.

Use the type-specific Issue template for tracked work. The template sets both
the title prefix and the canonical native GitHub Issue Type:

| Work prefix | Native Issue Type |
| --- | --- |
| `feat` | `Feature` |
| `fix` | `Bug` |
| `refactor`, `docs`, `chore` | `Task` |

The organization currently enables only these three native Issue Types, so the
last three work prefixes intentionally map to `Task`. The work prefix remains
the specific branch and PR classification. `type:*` labels are legacy and are
not required for new Issues or pull requests. Never recreate a removed
`type:*` label; use native GitHub Issue Type for classification. Use `area:*`
and `priority:*` labels for orthogonal dimensions. Set priority through the
repository's configured Project field.

## Issue Fields

When creating tracked work, add the Issue to the configured Project and set
the Project's `Priority` Field before implementation starts. Keep its
`Status` Field aligned with the work lifecycle, using the configured
in-progress value when work starts and the configured completed value after
the work is merged. Do not use classification or priority labels as a
substitute for native Issue Type or Project Fields. See
[`docs/issue-field-guidance.md`](docs/issue-field-guidance.md).

## Canonical checkout and worktrees

Keep the primary checkout on a clean, synchronized `main` branch. Before starting an Issue, update it with `git fetch origin main`, `git switch main`, and `git pull --ff-only origin main`. Create implementation work with `pnpm branch <type> <issue-number> <short-kebab-slug>`; the command creates `.worktrees/<issue-number>-<short-kebab-slug>` from `origin/main` and leaves the canonical checkout unchanged. Work and verify from that dedicated worktree.

## Branches

Create new branches with the repository CLI:

```sh
pnpm branch feat 123 add-sso
```

Supported types are `feat`, `fix`, `refactor`, `docs`, and `chore`. The CLI creates a branch in the format `<type>/<issue-number>-<short-kebab-slug>` and its dedicated worktree before work starts, using `origin/main` as the base so the branch name is valid from the outset.

## Pull requests

Use the title format `[type] Short summary (#issue-number)` and include an
explicit closing reference such as `Fixes #123`. The linked Issue's native
Type must match the source branch mapping above. The branch-name workflow
checks the branch format, PR title, Issue reference, and native Issue Type; it
does not require duplicate `type:*` labels on the Issue or PR.

Describe affected clients, servers, packages, user-visible behavior, breaking
changes, and verification commands. Include screenshots or recordings when UI
behavior changes, without private captures, production configuration, or
credentials.
