import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "cleanup-merged.mjs");

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function runCleanup(repo, args) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: repo,
    encoding: "utf8",
  });
}

function branchExists(repo, branch) {
  return spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
    cwd: repo,
  }).status === 0;
}

function commitFile(cwd, name, content) {
  writeFileSync(join(cwd, name), content);
  git(cwd, ["add", name]);
  git(cwd, ["commit", "-m", `Add ${name}`]);
}

function createRepository() {
  const repo = mkdtempSync(join(tmpdir(), "cleanup-merged-"));
  git(repo, ["init", "--quiet"]);
  git(repo, ["config", "user.name", "Cleanup Test"]);
  git(repo, ["config", "user.email", "cleanup-test@example.com"]);
  git(repo, ["checkout", "-b", "main"]);
  commitFile(repo, "README.md", "initial\n");
  return repo;
}

function mergeBranch(repo, branch) {
  git(repo, ["checkout", "--quiet", "main"]);
  git(repo, ["merge", "--no-ff", "--no-edit", branch]);
}

function removeRepository(repo, linkedPath) {
  if (existsSync(linkedPath)) {
    rmSync(linkedPath, { recursive: true, force: true });
  }
  if (existsSync(repo)) {
    rmSync(repo, { recursive: true, force: true });
  }
}

test("removes merged branches and clean linked worktrees", () => {
  const repo = createRepository();
  const linkedPath = `${repo}-linked`;

  try {
    git(repo, ["checkout", "-b", "chore/merged"]).trim();
    commitFile(repo, "merged.txt", "merged\n");
    mergeBranch(repo, "chore/merged");

    git(repo, ["worktree", "add", "--quiet", "-b", "chore/linked", linkedPath, "main"]);
    commitFile(linkedPath, "linked.txt", "linked\n");
    mergeBranch(repo, "chore/linked");

    const result = runCleanup(repo, ["--base", "main", "--yes"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /chore\/merged/);
    assert.match(result.stdout, /chore\/linked/);
    assert.equal(branchExists(repo, "chore/merged"), false);
    assert.equal(branchExists(repo, "chore/linked"), false);
    assert.equal(existsSync(linkedPath), false);
    assert.equal(git(repo, ["branch", "--show-current"]), "main");
  } finally {
    removeRepository(repo, linkedPath);
  }
});

test("skips dirty linked worktrees unless --force is supplied", () => {
  const repo = createRepository();
  const linkedPath = `${repo}-dirty`;

  try {
    git(repo, ["worktree", "add", "--quiet", "-b", "chore/dirty", linkedPath, "main"]);
    commitFile(linkedPath, "dirty.txt", "committed\n");
    mergeBranch(repo, "chore/dirty");
    writeFileSync(join(linkedPath, "uncommitted.txt"), "keep me\n");

    const skipped = runCleanup(repo, ["--base", "main", "--yes"]);

    assert.equal(skipped.status, 0, skipped.stderr);
    assert.match(skipped.stdout, /chore\/dirty/);
    assert.match(skipped.stdout, /dirty/);
    assert.equal(branchExists(repo, "chore/dirty"), true);
    assert.equal(existsSync(join(linkedPath, "uncommitted.txt")), true);

    const forced = runCleanup(repo, ["--base", "main", "--force", "--yes"]);

    assert.equal(forced.status, 0, forced.stderr);
    assert.equal(branchExists(repo, "chore/dirty"), false);
    assert.equal(existsSync(linkedPath), false);
  } finally {
    removeRepository(repo, linkedPath);
  }
});

test("dry-run leaves merged branches and worktrees unchanged", () => {
  const repo = createRepository();
  const linkedPath = `${repo}-dry-run`;

  try {
    git(repo, ["worktree", "add", "--quiet", "-b", "chore/dry-run", linkedPath, "main"]);
    commitFile(linkedPath, "dry-run.txt", "dry run\n");
    mergeBranch(repo, "chore/dry-run");

    const result = runCleanup(repo, ["--base", "main", "--dry-run"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Dry run: no changes made\./);
    assert.equal(branchExists(repo, "chore/dry-run"), true);
    assert.equal(existsSync(linkedPath), true);
    assert.equal(readFileSync(join(linkedPath, "dry-run.txt"), "utf8"), "dry run\n");
  } finally {
    removeRepository(repo, linkedPath);
  }
});

test("prunes missing worktree registrations without deleting unmerged branches", () => {
  const repo = createRepository();
  const linkedPath = `${repo}-stale`;

  try {
    git(repo, ["worktree", "add", "--quiet", "-b", "chore/stale", linkedPath, "main"]);
    commitFile(linkedPath, "stale.txt", "stale\n");
    rmSync(linkedPath, { recursive: true, force: true });

    const withoutPrune = runCleanup(repo, ["--base", "main", "--no-prune", "--dry-run"]);

    assert.equal(withoutPrune.status, 0, withoutPrune.stderr);
    assert.match(withoutPrune.stdout, /Stale worktree pruning: disabled/);
    assert.equal(branchExists(repo, "chore/stale"), true);

    const pruned = runCleanup(repo, ["--base", "main", "--yes"]);

    assert.equal(pruned.status, 0, pruned.stderr);
    assert.match(pruned.stdout, /Pruning stale worktree registrations/);
    assert.equal(branchExists(repo, "chore/stale"), true);
    assert.doesNotMatch(git(repo, ["worktree", "list", "--porcelain"]), /chore\/stale/);
  } finally {
    removeRepository(repo, linkedPath);
  }
});

test("deletes branches merged into the selected base even when HEAD differs", () => {
  const repo = createRepository();

  try {
    git(repo, ["checkout", "-b", "chore/current"]);
    git(repo, ["checkout", "--quiet", "main"]);
    git(repo, ["checkout", "-b", "chore/merged-elsewhere"]);
    commitFile(repo, "merged-elsewhere.txt", "merged into main\n");
    mergeBranch(repo, "chore/merged-elsewhere");
    git(repo, ["checkout", "--quiet", "chore/current"]);

    const result = runCleanup(repo, ["--base", "main", "--yes"]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(branchExists(repo, "chore/merged-elsewhere"), false);
    assert.equal(git(repo, ["branch", "--show-current"]), "chore/current");
  } finally {
    removeRepository(repo, "");
  }
});
