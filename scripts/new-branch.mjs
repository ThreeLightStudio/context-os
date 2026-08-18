#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const TYPES = new Set(["feat", "fix", "refactor", "docs", "chore"]);
const ISSUE_NUMBER_PATTERN = /^[0-9]+$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BRANCH_PATTERN = /^(feat|fix|refactor|docs|chore)\/[0-9]+-[a-z0-9]+(?:-[a-z0-9]+)*$/;

function fail(message) {
  console.error(`Error: ${message}`);
  console.error("Usage: pnpm branch <feat|fix|refactor|docs|chore> <issue-number> <short-kebab-slug>");
  console.error("Example: pnpm branch feat 123 add-sso");
  process.exit(1);
}

const args = process.argv.slice(2);

if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  console.log("Usage: pnpm branch <feat|fix|refactor|docs|chore> <issue-number> <short-kebab-slug>");
  console.log("Example: pnpm branch feat 123 add-sso");
  process.exit(0);
}

if (args.length !== 3) {
  fail("expected exactly three arguments");
}

const [type, issueNumber, slug] = args;

if (!TYPES.has(type)) {
  fail(`unsupported type '${type}'`);
}

if (!ISSUE_NUMBER_PATTERN.test(issueNumber)) {
  fail("issue number must contain digits only");
}

if (!SLUG_PATTERN.test(slug)) {
  fail("slug must use lowercase letters, numbers, and single hyphens");
}

const branchName = `${type}/${issueNumber}-${slug}`;

if (!BRANCH_PATTERN.test(branchName)) {
  fail(`generated branch name is invalid: '${branchName}'`);
}

const currentBranch = spawnSync("git", ["branch", "--show-current"], {
  encoding: "utf8",
});

if (currentBranch.error || currentBranch.status !== 0) {
  fail("could not determine the current Git branch");
}

if (!currentBranch.stdout.trim()) {
  fail("run this command from an existing branch, not a detached HEAD");
}

console.log(`Creating branch ${branchName} from ${currentBranch.stdout.trim()}...`);

const result = spawnSync("git", ["switch", "-c", branchName], {
  stdio: "inherit",
});

if (result.error) {
  fail(result.error.message);
}

process.exit(result.status ?? 1);
