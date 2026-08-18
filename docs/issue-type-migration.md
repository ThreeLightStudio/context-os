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
new Issue templates and are not required on Issues or pull requests. Existing
labels should be migrated in place rather than used as a second source of
truth.

## Transition steps

1. For each open Issue, set the native Issue Type from the mapping above. Keep
   its existing `type:*` label temporarily so the migration is reversible.
2. For each open pull request, confirm its linked Issue has the expected native
   Type and keep the branch prefix and PR title unchanged.
3. Remove the matching `type:*` label from migrated Issues and pull requests.
4. Audit for remaining `type:*` labels. After no active work depends on them,
   retire the labels from repository settings; historical closed Issues may
   retain labels for search compatibility.

Until migration is complete, old Issues may still show a legacy label. New
work must use the Issue templates so the native Type is assigned at creation.
The branch-name workflow rejects a pull request when the linked Issue Type is
missing or does not match the source branch mapping.

For the corresponding Project Field rules, see
[issue-field-guidance.md](issue-field-guidance.md).
