import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SCRIPT_PATH = fileURLToPath(new URL("./new-branch.mjs", import.meta.url));

function git(cwd, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `git ${args.join(" ")} failed`);
  }

  return result.stdout.trim();
}

function createRepository() {
  const repository = mkdtempSync(join(tmpdir(), "new-branch-"));
  git(repository, ["init", "--quiet", "-b", "main"]);
  git(repository, ["config", "user.name", "New Branch Test"]);
  git(repository, ["config", "user.email", "new-branch-test@example.com"]);
  writeFileSync(join(repository, "README.md"), "initial\n");
  git(repository, ["add", "README.md"]);
  git(repository, ["commit", "--quiet", "-m", "initial"]);
  git(repository, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  return repository;
}

function runBranch(repository, args) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: repository,
    encoding: "utf8",
  });
}

function removeRepository(repository, worktreePath = "") {
  if (worktreePath && existsSync(worktreePath)) {
    git(repository, ["worktree", "remove", "--force", worktreePath]);
  }
  rmSync(repository, { recursive: true, force: true });
}

test("creates a worktree from origin/main without switching the canonical checkout", () => {
  const repository = createRepository();
  const worktreePath = join(repository, ".worktrees", "123-add-sso");

  try {
    const result = runBranch(repository, ["feat", "123", "add-sso"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /from origin\/main/);
    assert.equal(git(repository, ["branch", "--show-current"]), "main");
    assert.equal(existsSync(worktreePath), true);
    assert.equal(
      git(worktreePath, ["branch", "--show-current"]),
      "feat/123-add-sso",
    );
    assert.equal(
      git(worktreePath, ["rev-parse", "HEAD"]),
      git(repository, ["rev-parse", "origin/main"]),
    );
  } finally {
    removeRepository(repository, worktreePath);
  }
});

test("warns about a dirty canonical checkout and preserves its changes", () => {
  const repository = createRepository();
  const worktreePath = join(repository, ".worktrees", "24-dirty-safe");
  const readmePath = join(repository, "README.md");

  try {
    writeFileSync(readmePath, "uncommitted change\n");
    const result = runBranch(repository, ["chore", "24", "dirty-safe"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /canonical checkout .* uncommitted changes/);
    assert.equal(readFileSync(readmePath, "utf8"), "uncommitted change\n");
    assert.equal(existsSync(worktreePath), true);
    assert.equal(git(repository, ["branch", "--show-current"]), "main");
  } finally {
    removeRepository(repository, worktreePath);
  }
});

test("requires origin/main as the worktree base", () => {
  const repository = createRepository();
  const worktreePath = join(repository, ".worktrees", "123-missing-base");

  try {
    git(repository, ["update-ref", "-d", "refs/remotes/origin/main"]);
    const result = runBranch(repository, ["feat", "123", "missing-base"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /origin\/main is unavailable/);
    assert.equal(existsSync(worktreePath), false);
  } finally {
    removeRepository(repository);
  }
});
