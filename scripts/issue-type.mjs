export const BRANCH_NAME_PATTERN =
  /^(feat|fix|refactor|docs|chore)\/(\d+)-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const BRANCH_ISSUE_PATTERN = /^(feat|fix|refactor|docs|chore)\/(\d+)-/;

export const PR_TITLE_PATTERN =
  /^\[(feat|fix|refactor|docs|chore)\]\s+(.+?)\s+\(#(\d+)\)$/;

export function closingReferencePattern(issueNumber) {
  return new RegExp(
    `\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${issueNumber}\\b`,
    "i",
  );
}

/**
 * Maps the repository's branch/issue prefixes to the native GitHub Issue
 * Types enabled for the organization.
 *
 * GitHub currently provides Feature, Bug, and Task for this repository. The
 * repository keeps five work prefixes for branch and PR readability, so the
 * internal work categories that do not have a dedicated native type map to
 * Task.
 */
export const ISSUE_TYPE_BY_WORK_TYPE = Object.freeze({
  feat: "Feature",
  fix: "Bug",
  refactor: "Task",
  docs: "Task",
  chore: "Task",
});

export const SUPPORTED_WORK_TYPES = Object.freeze(
  Object.keys(ISSUE_TYPE_BY_WORK_TYPE),
);

export function expectedIssueTypeFor(workType) {
  return ISSUE_TYPE_BY_WORK_TYPE[workType] ?? null;
}

export function validateIssueType(workType, actualIssueType) {
  const expectedIssueType = expectedIssueTypeFor(workType);

  if (!expectedIssueType) {
    return {
      ok: false,
      code: "unsupported-work-type",
      expectedIssueType: null,
      actualIssueType: actualIssueType ?? null,
      message: `Unsupported work type '${workType}'.`,
    };
  }

  if (!actualIssueType) {
    return {
      ok: false,
      code: "missing-issue-type",
      expectedIssueType,
      actualIssueType: null,
      message: `Issue must have native GitHub Issue Type '${expectedIssueType}'.`,
    };
  }

  if (actualIssueType !== expectedIssueType) {
    return {
      ok: false,
      code: "mismatched-issue-type",
      expectedIssueType,
      actualIssueType,
      message: `Issue Type '${actualIssueType}' does not match expected '${expectedIssueType}'.`,
    };
  }

  return {
    ok: true,
    code: "valid",
    expectedIssueType,
    actualIssueType,
    message: `Issue uses native GitHub Issue Type '${expectedIssueType}'.`,
  };
}
