#!/usr/bin/env -S npx tsx

/**
 * @fileoverview CLI audit that flags oversized or mis-linked root guidance sections before agents-sync edits land.
 *
 * Compares canonical `AGENTS.md` bodies against proxy stubs and optional JSON output for CI-style gates.
 *
 * @testing CLI: rerun `npx tsx scripts/audit-guidance-split.ts` from the skill root after editing this file.
 * @see scripts/lib/skill-index.ts - Vendored normalization and proxy rendering helpers consumed here.
 * @documentation reviewed=2026-05-07 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

import fs from "node:fs";
import path from "node:path";
import {
  ROOT_GUIDANCE_CANONICAL_FILE,
  ROOT_GUIDANCE_FILES,
  ROOT_GUIDANCE_PROXY_FILES,
  normalizeSectionBody,
  renderGuidanceProxyFile,
} from "./lib/skill-index";

/**
 * Parsed CLI flags for output serialization and strict gating.
 *
 * @remarks
 * When `strict` is true and any issue exists, the process exits with code 1 after reporting.
 */
type Options = {
  json: boolean;
  strict: boolean;
};

/**
 * One actionable finding for a guidance file inside a audited repository path.
 *
 * @remarks
 * The `type` discriminant selects remediation messaging for agents-sync and CI readers.
 */
type FileIssue = {
  file: string;
  type:
    | "missing_file"
    | "proxy_stub_drift"
    | "verbose_html_classes"
    | "verbose_i18n"
    | "missing_html_classes_reference"
    | "missing_i18n_reference"
    | "broken_docs_reference";
  message: string;
};

/**
 * Audit rollup for a single repository root (`.` or a `.gitmodules` submodule path).
 *
 * @remarks
 * `guidanceFilesPresent` lists files that exist on disk; missing entries surface only as issues.
 */
type RepoAudit = {
  repoPath: string;
  issues: FileIssue[];
  guidanceFilesPresent: string[];
};

const SECTION_MAX_NON_EMPTY_LINES = 6;

/**
 * Parses supported CLI flags from raw argv tokens after the script name.
 *
 * @remarks
 * Unknown tokens are ignored so future flags can be added without breaking this audit.
 */
function parseOptions(argv: string[]): Options {
  const options: Options = {
    json: false,
    strict: false,
  };

  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--strict") {
      options.strict = true;
    }
  }

  return options;
}

/**
 * Lists submodule directory paths declared in `.gitmodules`, when that file exists.
 *
 * @remarks
 * I/O: reads `.gitmodules` synchronously; returns an empty array when the file is absent.
 */
function getSubmodulePaths(repoRoot: string): string[] {
  const gitmodulesPath = path.join(repoRoot, ".gitmodules");

  if (!fs.existsSync(gitmodulesPath)) {
    return [];
  }

  const content = fs.readFileSync(gitmodulesPath, "utf8");
  const matches = [...content.matchAll(/^\s*path\s*=\s*(.+)\s*$/gm)];

  return matches.map((match) => match[1].trim()).filter(Boolean);
}

/**
 * Extracts markdown body following a level-2 or level-3 heading until the next heading or EOF.
 *
 * @remarks
 * Heading text is regex-escaped so punctuation in titles cannot widen the match.
 */
function extractSectionBody(options: {
  content: string;
  heading: string;
}): string | null {
  const escapedHeading = options.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `^#{2,3}\\s+${escapedHeading}\\s*$([\\s\\S]*?)(?=^#{1,3}\\s+|\\Z)`,
    "m",
  );
  const match = options.content.match(regex);

  return match ? match[1] : null;
}

/**
 * Counts non-empty lines in a section for verbosity gates.
 *
 * @remarks
 * Whitespace-only lines and lone ``` fences do not count toward the limit.
 */
function countSectionNonEmptyLines(sectionBody: string): number {
  return sectionBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== "```").length;
}

/**
 * Collects unique `docs/.../*.md` references embedded in markdown prose.
 *
 * @remarks
 * Paths must include a `docs/` segment with a `.md` suffix to match the audit’s link hygiene checks.
 */
function collectDocsReferences(content: string): string[] {
  const matches = [
    ...content.matchAll(
      /(?:^|[^A-Za-z0-9_.-])((?:[A-Za-z0-9_.-]+\/)*docs(?:\/[A-Za-z0-9_.-]+)+\.md)/g,
    ),
  ];

  return [
    ...new Set(
      matches
        .map((match) => match[1])
        .filter((value): value is string => typeof value === "string"),
    ),
  ];
}

/**
 * Returns whether a section body contains an expected documentation path substring.
 *
 * @remarks
 * Matching is a plain substring check; callers pass stable repo-relative reference strings.
 */
function hasReferenceInSection(options: {
  sectionBody: string;
  expectedRef: string;
}): boolean {
  return options.sectionBody.includes(options.expectedRef);
}

/**
 * Builds verbosity and missing-reference issues for an optional AGENTS subsection body.
 *
 * @remarks
 * When `sectionBody` is null, returns an empty array; otherwise applies the same line-count and
 * substring reference checks used for HTML Classes and I18n guidance blocks.
 */
function collectGuidanceSubsectionIssues(options: {
  sectionBody: string | null;
  relativeFilePath: string;
  verboseIssueType: "verbose_html_classes" | "verbose_i18n";
  missingRefIssueType:
    | "missing_html_classes_reference"
    | "missing_i18n_reference";
  expectedRef: string;
  sectionDisplayName: string;
}): FileIssue[] {
  const issues: FileIssue[] = [];

  if (!options.sectionBody) {
    return issues;
  }

  const lineCount = countSectionNonEmptyLines(options.sectionBody);

  if (lineCount > SECTION_MAX_NON_EMPTY_LINES) {
    issues.push({
      file: options.relativeFilePath,
      type: options.verboseIssueType,
      message: `${options.relativeFilePath} has a verbose ${options.sectionDisplayName} section (${lineCount} non-empty lines); keep only essential directive + docs reference.`,
    });
  }

  if (
    !hasReferenceInSection({
      sectionBody: options.sectionBody,
      expectedRef: options.expectedRef,
    })
  ) {
    issues.push({
      file: options.relativeFilePath,
      type: options.missingRefIssueType,
      message: `${options.relativeFilePath} ${options.sectionDisplayName} section is missing ${options.expectedRef} reference.`,
    });
  }

  return issues;
}

/**
 * Audits canonical guidance files for one repo path and collects structured issues.
 *
 * @remarks
 * I/O: reads AGENTS-family files from disk under `repoRoot/repoPath`. Proxy stubs are compared to
 * rendered templates; the canonical file checks section size and doc link targets.
 */
function auditRepo(options: { repoRoot: string; repoPath: string }): RepoAudit {
  const absoluteRepoPath = path.join(options.repoRoot, options.repoPath);
  const issues: FileIssue[] = [];
  const guidanceFilesPresent: string[] = [];

  for (const fileName of ROOT_GUIDANCE_FILES) {
    const absoluteFilePath = path.join(absoluteRepoPath, fileName);
    const relativeFilePath = path.join(options.repoPath, fileName);

    if (!fs.existsSync(absoluteFilePath)) {
      issues.push({
        file: relativeFilePath,
        type: "missing_file",
        message: `${relativeFilePath} is missing`,
      });
      continue;
    }

    guidanceFilesPresent.push(fileName);

    const content = fs.readFileSync(absoluteFilePath, "utf8");
    if (
      ROOT_GUIDANCE_PROXY_FILES.includes(
        fileName as (typeof ROOT_GUIDANCE_PROXY_FILES)[number],
      )
    ) {
      const expectedProxyContent = renderGuidanceProxyFile(
        fileName as (typeof ROOT_GUIDANCE_PROXY_FILES)[number],
      );
      if (
        normalizeSectionBody(content) !==
        normalizeSectionBody(expectedProxyContent)
      ) {
        issues.push({
          file: relativeFilePath,
          type: "proxy_stub_drift",
          message: `${relativeFilePath} must be a minimal AGENTS.md redirect stub.`,
        });
      }
      continue;
    }

    if (fileName !== ROOT_GUIDANCE_CANONICAL_FILE) {
      continue;
    }

    const htmlClassesSection = extractSectionBody({
      content,
      heading: "HTML Classes",
    });

    issues.push(
      ...collectGuidanceSubsectionIssues({
        sectionBody: htmlClassesSection,
        relativeFilePath,
        verboseIssueType: "verbose_html_classes",
        missingRefIssueType: "missing_html_classes_reference",
        expectedRef: "docs/HTML_CLASSES.md",
        sectionDisplayName: "HTML Classes",
      }),
    );

    const i18nSection = extractSectionBody({
      content,
      heading: "I18n",
    });

    issues.push(
      ...collectGuidanceSubsectionIssues({
        sectionBody: i18nSection,
        relativeFilePath,
        verboseIssueType: "verbose_i18n",
        missingRefIssueType: "missing_i18n_reference",
        expectedRef: "docs/LOCALES.md",
        sectionDisplayName: "I18n",
      }),
    );

    const docsReferences = collectDocsReferences(content);

    for (const docsReference of docsReferences) {
      const docsAbsolutePath = path.join(absoluteRepoPath, docsReference);

      if (!fs.existsSync(docsAbsolutePath)) {
        issues.push({
          file: relativeFilePath,
          type: "broken_docs_reference",
          message: `${relativeFilePath} references missing file ${path.join(options.repoPath, docsReference)}.`,
        });
      }
    }
  }

  return {
    repoPath: options.repoPath,
    issues,
    guidanceFilesPresent,
  };
}

/**
 * Prints a multi-repository human-readable report to stdout.
 *
 * @remarks
 * Totals issues across audits for the trailing summary line.
 */
function printHumanReport(audits: RepoAudit[]): void {
  console.log("Agents guidance split audit");
  console.log("===========================\n");

  let totalIssues = 0;

  for (const audit of audits) {
    console.log(`Repo: ${audit.repoPath}`);
    console.log(
      `  Guidance files present: ${audit.guidanceFilesPresent.join(", ") || "none"}`,
    );

    if (audit.issues.length === 0) {
      console.log("  Issues: none\n");
      continue;
    }

    console.log("  Issues:");
    for (const issue of audit.issues) {
      totalIssues += 1;
      console.log(`    - [${issue.type}] ${issue.message}`);
    }
    console.log();
  }

  console.log(`Total issues: ${totalIssues}`);
}

/**
 * CLI entry: audits the cwd plus declared git submodules, then emits JSON or text output.
 *
 * @remarks
 * I/O: resolves paths from `process.cwd()`, writes to stdout, and may exit with code 1 when
 * `--strict` is set and issues remain.
 */
function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const repoRoot = process.cwd();
  const submodulePaths = getSubmodulePaths(repoRoot);
  const repoPaths = [".", ...submodulePaths];

  const audits = repoPaths.map((repoPath) => auditRepo({ repoRoot, repoPath }));
  const totalIssues = audits.reduce(
    (sum, audit) => sum + audit.issues.length,
    0,
  );

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          repoPaths,
          totalIssues,
          audits,
        },
        null,
        2,
      ),
    );
  } else {
    printHumanReport(audits);
  }

  if (options.strict && totalIssues > 0) {
    process.exit(1);
  }
}

main();
