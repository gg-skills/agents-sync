#!/usr/bin/env -S npx tsx

/**
 * @fileoverview Publishes a dated agents-sync working directory into durable repo artifacts (plans, commits, or copies).
 *
 * Wraps `publishScopedArtifacts` for `YYYY-MM-DD-*` session folders created by `init-sync-session.ts`.
 *
 * @testing CLI: rerun `npx tsx scripts/finalize-sync-session.ts` from the skill root after editing this file.
 * @see scripts/lib/finalize-scoped-artifact.ts - Vendored finalize/publish helpers for scoped workflow outputs.
 * @see scripts/init-sync-session.ts - Session scaffold paired with this finalize step.
 * @documentation reviewed=2026-05-07 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */


import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { getRepoRoot, publishScopedArtifacts } from "./lib/finalize-scoped-artifact";

const SESSION_DIRECTORY_PATTERN = /^\d{4}-\d{2}-\d{2}-/;

/**
 * Coerces optional CLI multi-value inputs into a string array for `publishScopedArtifacts` scope paths.
 *
 * @remarks
 * `node:util` `parseArgs` may surface repeated flags as `string[]`, a single value as `string`, or `undefined` when absent.
 */
function normalizePaths(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  return [value];
}

/**
 * Picks the newest `YYYY-MM-DD-*` session directory under `.agents-sync` using lexicographic name order.
 *
 * @remarks
 * I/O: reads directory entries synchronously under the sessions root passed as `rootDir`.
 *
 * @throws When no timestamped session directories match the expected naming pattern.
 */
function resolveLatestSessionDir(rootDir: string): string {
  const entries = fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SESSION_DIRECTORY_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));

  if (entries.length === 0) {
    throw new Error("No timestamped agents-sync session directories were found.");
  }

  return path.join(".agents-sync", entries[0]);
}

/**
 * Resolves which agents-sync session folder to publish, either explicitly or as the latest dated directory.
 *
 * @remarks
 * With `latest`, delegates to directory scanning under `repoRoot/.agents-sync`. Otherwise normalizes `sessionDir` to a repo-root-relative POSIX path for downstream tooling.
 *
 * @throws When `latest` is not set and `sessionDir` is missing or whitespace-only.
 */
function resolveSessionDir(repoRoot: string, sessionDir?: string, latest?: boolean): string {
  const sessionsRoot = path.join(repoRoot, ".agents-sync");
  if (latest === true) {
    return resolveLatestSessionDir(sessionsRoot);
  }

  if (typeof sessionDir !== "string" || sessionDir.trim().length === 0) {
    throw new Error("Provide --session-dir or use --latest.");
  }

  return path.relative(repoRoot, path.resolve(repoRoot, sessionDir)).replace(/\\/g, "/");
}

/**
 * CLI entrypoint that parses argv, resolves the session directory, and prints `publishScopedArtifacts` JSON to stdout.
 *
 * @remarks
 * Side effects: synchronous filesystem reads during session resolution; may create commits or copies depending on flags passed through to `publishScopedArtifacts`.
 */
function main(): void {
  const { values } = parseArgs({
    options: {
      "commit-message": { type: "string" },
      "dry-run": { type: "boolean" },
      "include-path": { type: "string", multiple: true },
      latest: { type: "boolean" },
      "session-dir": { type: "string" },
    },
    allowPositionals: false,
  });

  const repoRoot = getRepoRoot(process.cwd());
  const sessionDir = resolveSessionDir(
    repoRoot,
    typeof values["session-dir"] === "string" ? values["session-dir"] : undefined,
    values.latest === true,
  );

  const includePaths = normalizePaths(values["include-path"]);
  const scopePaths = [sessionDir, ...includePaths];
  const commitMessage =
    typeof values["commit-message"] === "string" && values["commit-message"].trim().length > 0
      ? values["commit-message"].trim()
      : `docs(agents-sync): publish ${path.basename(sessionDir)}`;

  const result = publishScopedArtifacts({
    repoRoot,
    scopePaths,
    commitMessage,
    dryRun: values["dry-run"] === true,
  });

  console.log(JSON.stringify(result, null, 2));
}

main();
