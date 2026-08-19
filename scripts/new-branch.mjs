#!/usr/bin/env node

import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const TYPES = new Set(["feat", "fix", "refactor", "docs", "chore"]);
const ISSUE_NUMBER_PATTERN = /^[0-9]+$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BRANCH_PATTERN = /^(feat|fix|refactor|docs|chore)\/[0-9]+-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BASE_REF = "origin/main";

function usage() {
  return "Usage: pnpm branch <feat|fix|refactor|docs|chore> <issue-number> <short-kebab-slug>";
}

function fail(message) {
  console.error(`Error: ${message}`);
  console.error(usage());
  console.error("Example: pnpm branch feat 123 add-sso");
  process.exit(1);
}

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function gitOutput(args, cwd) {
  const result = runGit(args, { cwd });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function getRepositoryRoot() {
  const commonGitDir = gitOutput([
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  return resolve(dirname(commonGitDir));
}

function isRefAvailable(repoRoot, ref) {
  return runGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
    cwd: repoRoot,
    stdio: "ignore",
  }).status === 0;
}

function isLocalBranchAvailable(repoRoot, branchName) {
  return runGit(["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], {
    cwd: repoRoot,
    stdio: "ignore",
  }).status === 0;
}

function getCanonicalStatus(repoRoot) {
  return gitOutput([
    "-C",
    repoRoot,
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]);
}

const args = process.argv.slice(2);

if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  console.log(usage());
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

let repositoryRoot;
try {
  repositoryRoot = getRepositoryRoot();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (!isRefAvailable(repositoryRoot, BASE_REF)) {
  fail(`${BASE_REF} is unavailable; run 'git fetch origin main' and retry`);
}

if (isLocalBranchAvailable(repositoryRoot, branchName)) {
  fail(`branch '${branchName}' already exists`);
}

const worktreePath = resolve(repositoryRoot, ".worktrees", `${issueNumber}-${slug}`);

if (existsSync(worktreePath)) {
  fail(`worktree path already exists: ${worktreePath}`);
}

const canonicalStatus = getCanonicalStatus(repositoryRoot);
if (canonicalStatus) {
  console.warn(
    `Warning: canonical checkout ${repositoryRoot} has uncommitted changes; leaving them untouched.`,
  );
}

mkdirSync(resolve(repositoryRoot, ".worktrees"), { recursive: true });

console.log(`Creating worktree ${worktreePath} from ${BASE_REF}...`);
const result = runGit(
  ["worktree", "add", "-b", branchName, worktreePath, BASE_REF],
  { cwd: repositoryRoot, stdio: "inherit" },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Worktree ready: ${worktreePath}`);
console.log(`Branch: ${branchName}`);
