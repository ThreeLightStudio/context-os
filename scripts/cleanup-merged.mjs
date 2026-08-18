#!/usr/bin/env node

import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const HELP = `Usage: pnpm cleanup:merged -- [options]

Remove local branches already merged into the main branch and their linked worktrees.

Options:
  --base <ref>    Merge target (default: origin/main, fallback: main)
  --dry-run       List actions without changing the repository
  --yes, -y       Skip the confirmation prompt
  --force         Remove dirty linked worktrees
  --no-prune      Keep stale worktree registrations
  --help, -h      Show this help
`;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const options = {
    base: null,
    dryRun: false,
    force: false,
    noPrune: false,
    yes: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    }

    if (arg === "--dry-run" || arg === "-n") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--yes" || arg === "-y" || arg === "--non-interactive") {
      options.yes = true;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (arg === "--no-prune") {
      options.noPrune = true;
      continue;
    }

    if (arg === "--base") {
      const base = args[index + 1];
      if (!base || base.startsWith("-")) {
        throw new Error("--base requires a Git ref");
      }
      options.base = base;
      index += 1;
      continue;
    }

    if (arg.startsWith("--base=")) {
      const base = arg.slice("--base=".length);
      if (!base) {
        throw new Error("--base requires a Git ref");
      }
      options.base = base;
      continue;
    }

    throw new Error(`unknown option '${arg}'`);
  }

  return options;
}

function runGit(args, { cwd, allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    if (allowFailure) {
      return { ok: false, stdout: "", stderr: result.error.message };
    }
    throw result.error;
  }

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  if (result.status !== 0 && !allowFailure) {
    throw new Error(stderr.trim() || `git ${args.join(" ")} failed`);
  }

  return {
    ok: result.status === 0,
    stdout,
    stderr,
  };
}

function gitOutput(args, options) {
  return runGit(args, options).stdout.trim();
}

function getRepositoryRoot() {
  return gitOutput(["rev-parse", "--show-toplevel"]);
}

function getCurrentBranch(repoRoot) {
  const result = runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], {
    cwd: repoRoot,
    allowFailure: true,
  });

  if (!result.ok || !result.stdout.trim()) {
    throw new Error("run this command from a branch, not a detached HEAD");
  }

  return result.stdout.trim();
}

function refExists(repoRoot, ref) {
  return runGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
    cwd: repoRoot,
    allowFailure: true,
  }).ok;
}

function localBranchExists(repoRoot, branch) {
  return runGit(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
    cwd: repoRoot,
    allowFailure: true,
  }).ok;
}

function localBranchFromRef(repoRoot, ref) {
  if (localBranchExists(repoRoot, ref)) {
    return ref;
  }

  if (ref.startsWith("refs/heads/")) {
    return ref.slice("refs/heads/".length);
  }

  if (ref.startsWith("refs/remotes/")) {
    return ref.slice("refs/remotes/".length).split("/").slice(1).join("/");
  }

  const remoteSeparator = ref.indexOf("/");
  return remoteSeparator === -1 ? ref : ref.slice(remoteSeparator + 1);
}

function resolveBase(repoRoot, requestedBase) {
  const candidates = requestedBase
    ? [requestedBase]
    : ["origin/main", "main"];

  for (const candidate of candidates) {
    if (!refExists(repoRoot, candidate)) {
      continue;
    }

    return {
      ref: candidate,
      branch: localBranchFromRef(repoRoot, candidate),
    };
  }

  const message = requestedBase
    ? `could not resolve base ref '${requestedBase}'`
    : "could not resolve origin/main or main; use --base <ref>";
  throw new Error(message);
}

function parseWorktrees(repoRoot) {
  const output = gitOutput(["worktree", "list", "--porcelain"], {
    cwd: repoRoot,
  });

  if (!output) {
    return [];
  }

  return output.split(/\n\n+/).map((block) => {
    const lines = block.split("\n");
    const worktreeLine = lines.find((line) => line.startsWith("worktree "));
    const branchLine = lines.find((line) => line.startsWith("branch "));

    return {
      branch: branchLine?.slice("branch ".length).replace(/^refs\/heads\//, "") ?? null,
      path: worktreeLine
        ? resolve(repoRoot, worktreeLine.slice("worktree ".length))
        : null,
    };
  }).filter((worktree) => worktree.path);
}

function getWorktreeState(worktree) {
  if (!existsSync(worktree.path)) {
    return "missing";
  }

  const result = runGit(["-C", worktree.path, "status", "--porcelain", "--untracked-files=all"], {
    allowFailure: true,
  });

  if (!result.ok) {
    return "unknown";
  }

  return result.stdout.trim() ? "dirty" : "clean";
}

function getMergedBranches(repoRoot, baseRef) {
  const output = gitOutput([
    "for-each-ref",
    "--format=%(refname:short)",
    "--merged",
    baseRef,
    "refs/heads",
  ], { cwd: repoRoot });

  return output ? output.split("\n").map((branch) => branch.trim()).filter(Boolean) : [];
}

function getPrunableWorktreeOutput(repoRoot) {
  return gitOutput(["worktree", "prune", "--dry-run", "-v"], { cwd: repoRoot });
}

function describeWorktree(worktree) {
  if (!worktree) {
    return "no linked worktree";
  }

  const status = worktree.state === "missing"
    ? "stale registration"
    : worktree.state === "unknown"
      ? "status unavailable"
      : worktree.state;
  return `${worktree.path} (${status})`;
}

function printPlan({ base, currentBranch, mergedBranches, candidates, skipped, staleOutput, options }) {
  const candidateBranches = new Set(candidates.map((item) => item.branch));

  console.log(`Merge target: ${base.ref}`);
  console.log(`Protected branches: ${base.branch}, ${currentBranch}`);
  console.log("");

  console.log("Merged local branches:");
  if (mergedBranches.length === 0) {
    console.log("  (none)");
  } else {
    for (const item of mergedBranches) {
      const marker = item.protected
        ? "protected"
        : candidateBranches.has(item.branch)
          ? "eligible"
          : "skipped";
      console.log(`  - ${item.branch} [${marker}]${item.worktree ? ` — ${describeWorktree(item.worktree)}` : ""}`);
    }
  }

  if (skipped.length > 0) {
    console.log("");
    console.log("Skipped branches:");
    for (const item of skipped) {
      console.log(`  - ${item.branch} — ${describeWorktree(item.worktree)}`);
    }
  }

  if (options.noPrune) {
    console.log("");
    console.log("Stale worktree pruning: disabled (--no-prune)");
  } else if (staleOutput) {
    console.log("");
    console.log("Stale worktree registrations to prune:");
    for (const line of staleOutput.split("\n").filter(Boolean)) {
      console.log(`  - ${line}`);
    }
  }
}

async function confirm() {
  if (!input.isTTY) {
    throw new Error("stdin is not interactive; use --yes or --dry-run");
  }

  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question("\nProceed with cleanup? [y/N] ");
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = getRepositoryRoot();
  const currentWorktree = repoRoot;
  const currentBranch = getCurrentBranch(repoRoot);
  const base = resolveBase(repoRoot, options.base);
  const worktrees = parseWorktrees(repoRoot).map((worktree) => ({
    ...worktree,
    state: getWorktreeState(worktree),
  }));
  const worktreesByBranch = new Map(
    worktrees.filter((worktree) => worktree.branch).map((worktree) => {
      return [worktree.branch, worktree];
    }),
  );
  const staleOutput = options.noPrune ? "" : getPrunableWorktreeOutput(repoRoot);
  const mergedBranchNames = getMergedBranches(repoRoot, base.ref);
  const protectedBranches = new Set([base.branch, currentBranch]);
  const mergedBranches = mergedBranchNames.map((branch) => ({
    branch,
    protected: protectedBranches.has(branch),
    worktree: worktreesByBranch.get(branch) ?? null,
  }));
  const candidates = mergedBranches.filter((item) => {
    if (item.protected) {
      return false;
    }
    if (!item.worktree) {
      return true;
    }
    if (item.worktree.state === "missing") {
      return !options.noPrune;
    }
    return item.worktree.state === "clean" || options.force;
  });
  const candidateBranches = new Set(candidates.map((item) => item.branch));
  const skipped = mergedBranches.filter((item) => {
    if (item.protected || !item.worktree || candidateBranches.has(item.branch)) {
      return false;
    }
    return ["dirty", "unknown", "missing"].includes(item.worktree.state);
  });
  const hasMissingWorktree = worktrees.some((worktree) => worktree.state === "missing");
  const hasPruneAction = !options.noPrune && (Boolean(staleOutput) || hasMissingWorktree);

  printPlan({
    base,
    currentBranch,
    mergedBranches,
    candidates,
    skipped,
    staleOutput,
    options,
  });

  if (candidates.length === 0 && !hasPruneAction) {
    console.log("\nNothing to clean up.");
    return;
  }

  if (options.dryRun) {
    console.log("\nDry run: no changes made.");
    return;
  }

  if (!options.yes && !(await confirm())) {
    console.log("Cleanup cancelled.");
    return;
  }

  if (hasPruneAction) {
    console.log("Pruning stale worktree registrations...");
    runGit(["worktree", "prune", "-v"], { cwd: repoRoot });
  }

  for (const item of candidates) {
    if (item.worktree && item.worktree.state !== "missing" && item.worktree.path !== currentWorktree) {
      const removeArgs = ["worktree", "remove"];
      if (item.worktree.state !== "clean") {
        removeArgs.push("--force");
      }
      removeArgs.push("--", item.worktree.path);
      console.log(`Removing worktree ${item.worktree.path}...`);
      runGit(removeArgs, { cwd: repoRoot });
    }

    console.log(`Deleting local branch ${item.branch}...`);
    runGit(["branch", "-D", "--", item.branch], { cwd: repoRoot });
  }

  console.log("Cleanup complete.");
}

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
