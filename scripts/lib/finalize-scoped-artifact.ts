/**
 * @fileoverview Owns synchronous Git helpers that stage, commit, and push scoped working-tree paths for agents-sync session publish workflows.
 *
 * Vendored from the host project's shared finalize-scoped-artifact module and kept self-contained under `skills/agents-sync/scripts` so the skill does not import sibling packages.
 * Flow: resolve repo root -> refuse pre-staged index changes and unexpected nested `.git` trees under scope -> optionally `git add`, `git commit`, and `git push` for normalized scope paths (supports `dryRun` summaries without mutating the index).
 *
 * @example
 * ```typescript
 * import { getRepoRoot, publishScopedArtifacts } from "./lib/finalize-scoped-artifact";
 *
 * const repoRoot = getRepoRoot(process.cwd());
 * const result = publishScopedArtifacts({
 *   repoRoot,
 *   scopePaths: [".agents-sync/2026-05-22-example-session"],
 *   commitMessage: "docs(agents-sync): publish session outputs",
 *   dryRun: true,
 * });
 * ```
 *
 * @testing CLI: npm run file-overview-standards:target-brief -- --file skills/agents-sync/scripts/lib/finalize-scoped-artifact.ts
 * @testing CLI: npx eslint skills/agents-sync/scripts/lib/finalize-scoped-artifact.ts
 *
 * @see skills/agents-sync/scripts/init-sync-session.ts - Session bootstrap CLI that imports `getRepoRoot` from this module to anchor agents-sync paths inside the platform repository.
 * @see skills/agents-sync/scripts/finalize-sync-session.ts - Finalize CLI that wraps `publishScopedArtifacts` to publish `YYYY-MM-DD-*` folders under `.agents-sync` with argv-driven dry runs or live commits.
 * @see docs/TYPESCRIPT_STANDARDS_DOCUMENTATION_FILE_OVERVIEWS.md - Repository contract defining the audited file-overview tag order and `@documentation` metadata enforced for this header.
 * @documentation reviewed=2026-05-22 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for staging, committing, and pushing scoped artifact paths within a repository.
 *
 * @remarks
 * Relative `scopePaths` entries resolve against `repoRoot` (or the detected root when omitted).
 */
export type ScopedArtifactPublishOptions = {
  commitMessage: string;
  dryRun?: boolean;
  repoRoot?: string;
  scopePaths: string[];
};

/**
 * Structured outcome from `publishScopedArtifacts`, including dry-run summaries.
 */
export type ScopedArtifactPublishResult = {
  branchName: string;
  commitMessage: string;
  dryRun: boolean;
  pushed: boolean;
  repoRoot: string;
  scopePaths: string[];
  stagedFiles: string[];
};

// ---------------------------------------------------------------------------
// Git subprocess
// ---------------------------------------------------------------------------

/**
 * Runs `git` synchronously and returns trimmed stdout text.
 *
 * @remarks
 * I/O: child_process `execFileSync`; propagates non-zero exits as thrown errors.
 */
function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Resolves the git repository root for `startDir` using `git rev-parse --show-toplevel`.
 */
export function getRepoRoot(startDir: string = process.cwd()): string {
  return git(["rev-parse", "--show-toplevel"], startDir);
}

/**
 * Normalizes user-supplied relative paths for comparisons against git output.
 */
export function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
  if (normalized === "." || normalized.length === 0) {
    return "";
  }
  return normalized.replace(/\/+$/, "");
}

/**
 * Collects normalized submodule directory paths declared in `.gitmodules`.
 *
 * @remarks
 * I/O: reads `.gitmodules` when present; returns an empty set when the file is missing.
 */
function listConfiguredSubmodulePaths(repoRoot: string): Set<string> {
  const gitmodulesPath = path.join(repoRoot, ".gitmodules");
  if (!fs.existsSync(gitmodulesPath)) {
    return new Set<string>();
  }

  const gitmodulesContent = fs.readFileSync(gitmodulesPath, "utf8");
  const configuredSubmodulePaths = new Set<string>();

  gitmodulesContent.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*path\s*=\s*(.+)\s*$/);
    if (match === null) {
      return;
    }
    const normalizedPath = normalizeRelativePath(match[1] ?? "");
    if (normalizedPath.length > 0) {
      configuredSubmodulePaths.add(normalizedPath);
    }
  });

  return configuredSubmodulePaths;
}

/**
 * Walks a scope tree to find nested Git repositories not covered by configured submodules.
 *
 * @remarks
 * I/O: synchronous `readdir` walks under `absoluteScopePath`. Paths listed in `.gitmodules` are
 * treated as allowed nested repos.
 */
function collectEmbeddedRepositoryPaths(
  repoRoot: string,
  absoluteScopePath: string,
  allowedRepoPaths: Set<string>,
): string[] {
  const embeddedRepoPaths = new Set<string>();
  const pendingDirectories = [absoluteScopePath];

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (typeof currentDirectory !== "string") {
      continue;
    }

    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    entries.forEach((entry) => {
      const absoluteEntryPath = path.join(currentDirectory, entry.name);

      if (entry.name === ".git") {
        const repoPath = normalizeRelativePath(path.relative(repoRoot, currentDirectory));
        if (repoPath.length > 0 && !allowedRepoPaths.has(repoPath)) {
          embeddedRepoPaths.add(repoPath);
        }
        return;
      }

      if (entry.isDirectory()) {
        pendingDirectories.push(absoluteEntryPath);
      }
    });
  }

  return Array.from(embeddedRepoPaths).sort((left, right) => left.localeCompare(right));
}

/**
 * Resolves a user scope path to a normalized path relative to `repoRoot`.
 *
 * @throws Error when the target is missing or resolves outside the repository root.
 */
function resolveScopePath(repoRoot: string, scopePath: string): string {
  const absolutePath = path.isAbsolute(scopePath)
    ? path.resolve(scopePath)
    : path.resolve(repoRoot, scopePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Scoped artifact path does not exist: ${absolutePath}`);
  }

  const relativePath = normalizeRelativePath(path.relative(repoRoot, absolutePath));
  if (relativePath.length === 0 || relativePath.startsWith("..")) {
    throw new Error(`Scoped artifact path must stay inside repo root: ${absolutePath}`);
  }

  return relativePath;
}

/**
 * Lists normalized paths currently staged in the Git index.
 *
 * @remarks
 * I/O: runs `git diff --cached --name-only` from `repoRoot`.
 */
function listStagedFiles(repoRoot: string): string[] {
  const result = git(["diff", "--cached", "--name-only"], repoRoot);
  if (result.length === 0) {
    return [];
  }
  return result
    .split("\n")
    .map((line) => normalizeRelativePath(line))
    .filter((line) => line.length > 0);
}

/**
 * Returns whether a staged file path sits under one of the normalized scope roots.
 */
function isInsideScope(filePath: string, scopePaths: string[]): boolean {
  return scopePaths.some((scopePath) => {
    if (filePath === scopePath) {
      return true;
    }
    return filePath.startsWith(`${scopePath}/`);
  });
}

/**
 * Fails fast when the index already has staged changes before a scoped publish.
 *
 * @throws Error when any paths are already staged under `repoRoot`.
 */
export function assertNoPreStagedChanges(repoRoot: string): void {
  const stagedFiles = listStagedFiles(repoRoot);
  if (stagedFiles.length > 0) {
    throw new Error(
      "Refusing to publish artifacts because staged changes already exist. Commit or unstage them first.",
    );
  }
}

/**
 * Ensures scopes do not contain unexpected nested `.git` directories beyond declared submodules.
 *
 * @throws Error enumerating embedded repository paths when any are found.
 */
function assertNoEmbeddedRepositories(repoRoot: string, scopePaths: string[]): void {
  const allowedRepoPaths = listConfiguredSubmodulePaths(repoRoot);
  const embeddedRepoPaths = new Set<string>();

  scopePaths.forEach((scopePath) => {
    const absoluteScopePath = path.resolve(repoRoot, scopePath);
    collectEmbeddedRepositoryPaths(repoRoot, absoluteScopePath, allowedRepoPaths).forEach(
      (embeddedRepoPath) => {
        embeddedRepoPaths.add(embeddedRepoPath);
      },
    );
  });

  if (embeddedRepoPaths.size > 0) {
    throw new Error(
      `Refusing to publish artifacts because embedded Git repositories were found inside the scope: ${Array.from(
        embeddedRepoPaths,
      ).join(", ")}. Remove nested .git metadata or export plain files before publishing.`,
    );
  }
}

/**
 * Stages scoped paths, optionally commits and pushes, and returns a structured summary.
 */
export function publishScopedArtifacts(
  options: ScopedArtifactPublishOptions,
): ScopedArtifactPublishResult {
  const repoRoot = options.repoRoot ?? getRepoRoot(process.cwd());
  const scopePaths = Array.from(
    new Set(
      options.scopePaths
        .map((scopePath) => resolveScopePath(repoRoot, scopePath))
        .filter((scopePath) => scopePath.length > 0),
    ),
  );

  if (scopePaths.length === 0) {
    throw new Error("At least one scoped artifact path is required.");
  }

  assertNoPreStagedChanges(repoRoot);
  assertNoEmbeddedRepositories(repoRoot, scopePaths);

  const branchName = git(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot);
  const dryRun = options.dryRun === true;

  if (!dryRun) {
    git(["add", "-A", "-f", "--", ...scopePaths], repoRoot);
  }

  const stagedFiles = dryRun
    ? []
    : listStagedFiles(repoRoot).sort((left, right) => left.localeCompare(right));

  if (!dryRun && stagedFiles.length === 0) {
    throw new Error("No scoped artifact changes were staged. Nothing to commit.");
  }

  if (!dryRun) {
    const stagedOutsideScope = stagedFiles.filter(
      (filePath) => !isInsideScope(filePath, scopePaths),
    );
    if (stagedOutsideScope.length > 0) {
      throw new Error(
        `Staged files exceed artifact scope: ${stagedOutsideScope.join(", ")}`,
      );
    }

    git(["commit", "-m", options.commitMessage], repoRoot);
    git(["push"], repoRoot);
  }

  return {
    repoRoot,
    branchName,
    scopePaths,
    stagedFiles,
    commitMessage: options.commitMessage,
    dryRun,
    pushed: !dryRun,
  };
}
