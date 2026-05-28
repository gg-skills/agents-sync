#!/usr/bin/env -S npx tsx

/**
 * @fileoverview Creates a timestamped agents-sync scratch directory under the repo for guided AGENTS.md reconciliation work.
 *
 * Resolves repo root, slugifies the session label, and materializes starter files before edits accumulate.
 *
 * @testing CLI: rerun `npx tsx scripts/init-sync-session.ts` from the skill root after editing this file.
 * @see scripts/lib/finalize-scoped-artifact.ts - Vendored `getRepoRoot` and path helpers aligned with finalize scripts.
 * @see scripts/finalize-sync-session.ts - Pairs with this initializer to publish results.
 * @documentation reviewed=2026-04-13 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */


import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { getRepoRoot } from "./lib/finalize-scoped-artifact";

/**
 * Normalizes a session label into a hyphenated slug safe for `.agents-sync` directory names.
 *
 * @remarks
 * Empty or all-separator input resolves to `guidance-sync` so path segments stay non-empty.
 */
function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");

  return normalized.length > 0 ? normalized : "guidance-sync";
}

/**
 * Builds the `YYYY-MM-DD` calendar prefix for agents-sync session folder names.
 *
 * @remarks
 * Uses the local timezone fields of the provided `Date` instance.
 */
function formatDatePrefix(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Compacts clock fields into a suffix appended when the dated slug directory already exists.
 *
 * @remarks
 * `HHmmss` without separators keeps sibling folder names short while disambiguating same-day reruns.
 */
function formatTimeSuffix(date: Date): string {
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  const seconds = `${date.getSeconds()}`.padStart(2, "0");
  return `${hours}${minutes}${seconds}`;
}

/**
 * Materializes a timestamped `.agents-sync/<date>-<slug>` workspace with starter audit artifacts.
 *
 * @remarks
 * I/O: creates nested directories and writes `SUMMARY.md` plus `session-metadata.json`; prints JSON paths to stdout.
 */
function main(): void {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
    },
    allowPositionals: false,
  });

  const sessionName = typeof values.name === "string" && values.name.trim().length > 0
    ? values.name.trim()
    : "guidance-sync";

  const repoRoot = getRepoRoot(process.cwd());
  const datePrefix = formatDatePrefix(new Date());
  const slug = slugify(sessionName);
  let sessionDir = path.join(repoRoot, ".agents-sync", `${datePrefix}-${slug}`);

  if (fs.existsSync(sessionDir)) {
    sessionDir = `${sessionDir}-${formatTimeSuffix(new Date())}`;
  }

  fs.mkdirSync(path.join(sessionDir, "audits"), { recursive: true });
  fs.mkdirSync(path.join(sessionDir, "validation"), { recursive: true });

  const summaryPath = path.join(sessionDir, "SUMMARY.md");
  fs.writeFileSync(
    summaryPath,
    [
      "# Agents Sync Session",
      "",
      "- Scope:",
      "- Repositories touched:",
      "- Guidance files touched:",
      "- Topic docs touched:",
      "- Validation:",
      "- Follow-up:",
      "",
    ].join("\n"),
    "utf8",
  );

  const metadataPath = path.join(sessionDir, "session-metadata.json");
  fs.writeFileSync(
    metadataPath,
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        sessionDir,
        sessionName,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(JSON.stringify({ sessionDir, summaryPath, metadataPath }, null, 2));
}

main();
