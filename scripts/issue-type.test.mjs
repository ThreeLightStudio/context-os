import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  BRANCH_ISSUE_PATTERN,
  BRANCH_NAME_PATTERN,
  ISSUE_TYPE_BY_WORK_TYPE,
  PR_TITLE_PATTERN,
  SUPPORTED_WORK_TYPES,
  closingReferencePattern,
  expectedIssueTypeFor,
  validateIssueType,
} from "./issue-type.mjs";

test("supports every repository work type", () => {
  assert.deepEqual(SUPPORTED_WORK_TYPES, [
    "feat",
    "fix",
    "refactor",
    "docs",
    "chore",
  ]);
  assert.deepEqual(ISSUE_TYPE_BY_WORK_TYPE, {
    feat: "Feature",
    fix: "Bug",
    refactor: "Task",
    docs: "Task",
    chore: "Task",
  });
});

for (const [workType, issueType] of Object.entries(ISSUE_TYPE_BY_WORK_TYPE)) {
  test(`${workType} resolves to ${issueType}`, () => {
    const branch = `${workType}/123-example-work`;
    const title = `[${workType}] Example work (#123)`;

    assert.deepEqual(BRANCH_NAME_PATTERN.exec(branch)?.slice(1), [
      workType,
      "123",
    ]);
    assert.deepEqual(BRANCH_ISSUE_PATTERN.exec(branch)?.slice(1), [
      workType,
      "123",
    ]);
    assert.deepEqual(PR_TITLE_PATTERN.exec(title)?.slice(1), [
      workType,
      "Example work",
      "123",
    ]);
    assert.match(`Fixes #123`, closingReferencePattern("123"));

    assert.equal(expectedIssueTypeFor(workType), issueType);
    assert.deepEqual(validateIssueType(workType, issueType), {
      ok: true,
      code: "valid",
      expectedIssueType: issueType,
      actualIssueType: issueType,
      message: `Issue uses native GitHub Issue Type '${issueType}'.`,
    });
  });
}

test("rejects invalid branch and PR metadata", () => {
  assert.equal(BRANCH_NAME_PATTERN.test("feature/123-example-work"), false);
  assert.equal(PR_TITLE_PATTERN.test("[feat] Example work"), false);
  assert.equal(closingReferencePattern("123").test("Related to #123"), false);
});

for (const workType of SUPPORTED_WORK_TYPES) {
  test(`${workType} Issue template documents Project Fields`, () => {
    const template = fs.readFileSync(
      new URL(`../.github/ISSUE_TEMPLATE/${workType}.yml`, import.meta.url),
      "utf8",
    );

    assert.match(template, /^type: (feature|bug|task)$/m);
    assert.match(template, /configured Project/);
    assert.match(template, /Priority` Field/);
  });
}

test("rejects an issue with no native Issue Type", () => {
  assert.deepEqual(validateIssueType("refactor", null), {
    ok: false,
    code: "missing-issue-type",
    expectedIssueType: "Task",
    actualIssueType: null,
    message: "Issue must have native GitHub Issue Type 'Task'.",
  });
});

test("rejects an issue whose native Issue Type does not match", () => {
  assert.deepEqual(validateIssueType("fix", "Feature"), {
    ok: false,
    code: "mismatched-issue-type",
    expectedIssueType: "Bug",
    actualIssueType: "Feature",
    message: "Issue Type 'Feature' does not match expected 'Bug'.",
  });
});

test("rejects unsupported work types", () => {
  assert.deepEqual(validateIssueType("docs-site", "Task"), {
    ok: false,
    code: "unsupported-work-type",
    expectedIssueType: null,
    actualIssueType: "Task",
    message: "Unsupported work type 'docs-site'.",
  });
});
