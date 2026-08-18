# Agent Contribution Workflow

This file defines the repository workflow for coding agents. Human contributors
should also follow `CONTRIBUTING.md`.

## Classify the work

Create or use a GitHub Issue before implementation when the work includes any
of the following:

- a new feature or user-visible behavior;
- i18n or another cross-cutting concern;
- an architecture, API, data model, or schema change;
- changes spanning multiple packages or clients; or
- a release, migration, security, or compatibility change.

An Issue is optional for a typo, documentation-only change, formatting-only
change, or a small, isolated and unambiguous bug fix. When the scope or impact
is unclear, treat the work as tracked work and create an Issue.

## Issue lifecycle

1. Search existing open and recently closed Issues before creating a new one.
   Reuse a relevant Issue instead of creating a duplicate.
2. If no relevant Issue exists, create one with the motivation, scope,
   acceptance criteria, and verification plan.
3. Update the Issue when work starts, when it is blocked, and when the
   implementation and verification are complete.
4. If GitHub authentication or an Issue-management integration is unavailable,
   do not claim that an Issue was created or updated. Report the limitation.

## Issue templates and labels

Use the type-specific Issue template when opening tracked work. Each template
sets the title prefix (`[feat]`, `[fix]`, `[refactor]`, `[docs]`, or `[chore]`)
and the matching label (`type:feat`, `type:fix`, `type:refactor`, `type:docs`,
or `type:chore`). Keep the Issue label and the branch type aligned. Set
priority through the repository's configured Project field.

## Branches and pull requests

### Pull request labels

Apply exactly one PR label matching the source branch type: `type:<type>`.
For example, a `feat/...` branch requires the `type:feat` PR label. The
`branch-name` workflow verifies this label.

For tracked work, create a focused branch named
`<type>/<issue-number>-<short-kebab-slug>` and keep the change scoped to its Issue.

Allowed types are `feat`, `fix`, `refactor`, `docs`, and `chore`. Use the
repository CLI so the branch is valid before work begins:

```sh
pnpm branch feat 123 add-sso
```

This creates `feat/123-add-sso` from the current branch. Do not use a
product-specific prefix such as `codex/` or `copilot/`. Branches created by
other paths are allowed, but the pull request branch-name check will prevent
them from merging until the name is corrected.

The issue number in the branch is the Issue that the work belongs to. In the
pull request template, replace the placeholder with `Fixes #<issue-number>` (or
an equivalent GitHub closing keyword). The `branch-name` workflow checks the
branch format, the closing reference, and the matching `type:<type>` label.
GitHub closes the Issue automatically when the pull request is merged into the
default branch.

Use the PR title format `[type] Short summary (#issue-number)`, keeping the
type and short summary aligned with the Issue title. The workflow checks the
title type and issue number against the source branch.

Open or update a pull request with:

- `Fixes #<issue-number>` or another explicit Issue reference;
- a concise summary of the change;
- verification commands and their results;
- affected clients, servers, packages, and user-visible behavior; and
- screenshots or recordings when UI behavior changed, without private data.

Run the relevant package checks and the repository verification command before
opening or updating the pull request. Do not merge the pull request
automatically. Leave final review and merge to the user. Do not close the
Issue before the pull request is merged; use the `Fixes #<issue-number>` link
so GitHub can close it after merge.

Small changes may be committed without an Issue or pull request when they meet
the optional-Issue criteria above and the current task authorizes the commit.
