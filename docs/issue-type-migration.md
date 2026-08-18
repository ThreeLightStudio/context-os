# GitHub Issue Type migration

GitHub's native Issue Type is now the canonical work classification for this
repository. The five branch and PR prefixes remain useful for specific work
intent, and map to the native Types enabled by the organization:

| Work prefix | Native Issue Type |
| --- | --- |
| `feat` | `Feature` |
| `fix` | `Bug` |
| `refactor` | `Task` |
| `docs` | `Task` |
| `chore` | `Task` |

The `type:*` labels are legacy classification metadata. They are not added by
new Issue templates and are not required on Issues or pull requests. Do not
recreate a removed `type:*` label; native GitHub Issue Type is authoritative.
Existing
Issues have been migrated to native Types and their classification labels
removed; branch prefixes and PR titles retain the more specific work
classification.

## Transition steps

1. For new Issues, use the type-specific template so the native Type is
   assigned at creation.
2. For each pull request, confirm its linked Issue uses the native Type
   expected from the branch prefix; keep the branch prefix and PR title
   unchanged.
3. Audit any remaining historical `type:*` labels and retire them from
   active work. They are not a source of truth for classification.
The branch-name workflow rejects a pull request when the linked Issue Type is
missing or does not match the source branch mapping.

For the corresponding Project Field rules, see
[issue-field-guidance.md](issue-field-guidance.md).
