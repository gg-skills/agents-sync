#!/usr/bin/env -S npx tsx

/**
 * @fileoverview CLI audit that cross-checks root guidance files against generated skill index entries.
 *
 * Surfaces drift between `AGENTS.md` / proxy stubs and the skills catalog so sync sessions fix real mismatches.
 *
 * @testing CLI: rerun `npx tsx scripts/audit-root-guidance-skills-alignment.ts` from the skill root after editing this file.
 * @see scripts/lib/skill-index.ts - Vendored skill index parsing and rendering helpers used for comparisons.
 * @documentation reviewed=2026-04-13 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */


import fs from "node:fs";
import path from "node:path";
import {
  GENERATED_SKILL_INDEX_FILES,
  ROOT_GUIDANCE_CANONICAL_FILE,
  ROOT_GUIDANCE_PROXY_FILES,
  ROOT_SKILLS_INDEX_HEADING,
  ROOT_SKILLS_INDEX_SECTION_BODY,
  collectSkillIndexEntries,
  extractGeneratedSkillIndexEntries,
  extractMarkdownSectionBody,
  filterSkillIndexEntriesByPartition,
  normalizeSectionBody,
  renderGeneratedSkillIndexFile,
  renderGuidanceProxyFile,
} from "./lib/skill-index";

/**
 * Parsed CLI switches controlling audit output shape and non-zero exit policy.
 *
 * @remarks
 * Only recognizes `--json` and `--strict`; unknown argv tokens are ignored.
 */
type Options = {
  json: boolean;
  strict: boolean;
};

/**
 * Per guidance-file audit result for canonical AGENTS.md or proxy redirect stubs.
 *
 * @remarks
 * `issues` holds human-readable findings; an empty list means the file matches expectations.
 */
type RootGuidanceAudit = {
  filePath: string;
  issues: string[];
};

/**
 * Drift report for one generated skill-index markdown file on disk.
 *
 * @remarks
 * Compares rendered canonical content and ref/description pairs against the repo’s generated file.
 */
type GeneratedIndexAudit = {
  contentDrift: boolean;
  duplicateSkillRefs: string[];
  extraSkillRefs: string[];
  filePath: string;
  mismatchedSkillDescriptions: Array<{
    actual: string | null;
    expected: string;
    ref: string;
  }>;
  missingFile: boolean;
  missingSkillRefs: string[];
};

/**
 * Full audit payload emitted as JSON or summarized for human-readable stdout.
 *
 * @remarks
 * `totalIssues` is a roll-up used for strict-mode exit; it is computed after assembly.
 */
type AuditReport = {
  expectedSkillCounts: {
    aiprofile: number;
    expert: number;
  };
  generatedIndexAudits: GeneratedIndexAudit[];
  rootGuidanceAudits: RootGuidanceAudit[];
  totalIssues: number;
};

/**
 * Extracts supported CLI flags from the argv tail passed to this script.
 *
 * @remarks
 * PURE: does not read the filesystem or mutate global process state.
 */
function parseOptions(argv: string[]): Options {
  const options: Options = {
    json: false,
    strict: false,
  };

  for (const argument of argv) {
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--strict") {
      options.strict = true;
    }
  }

  return options;
}

/**
 * Lists skill refs that occur more than once in the provided ordering.
 *
 * @remarks
 * PURE: returns sorted unique refs whose multiplicity exceeds one.
 */
function countDuplicateRefs(refs: string[]): string[] {
  const refCounts = new Map<string, number>();
  for (const ref of refs) {
    refCounts.set(ref, (refCounts.get(ref) ?? 0) + 1);
  }

  return [...refCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([ref]) => ref)
    .sort((leftRef, rightRef) => leftRef.localeCompare(rightRef));
}

/**
 * Validates the canonical root `AGENTS.md` skills-index section body.
 *
 * @remarks
 * I/O: synchronous read of `options.filePath`. Issues cite missing heading or body mismatch vs canonical template.
 */
function buildCanonicalRootGuidanceAudit(options: {
  filePath: string;
}): RootGuidanceAudit {
  const content = fs.readFileSync(options.filePath, "utf8");
  const sectionBody = extractMarkdownSectionBody(content, ROOT_SKILLS_INDEX_HEADING);
  const issues: string[] = [];

  if (sectionBody === null) {
    issues.push(`Missing ## ${ROOT_SKILLS_INDEX_HEADING} section.`);
  } else if (sectionBody !== normalizeSectionBody(ROOT_SKILLS_INDEX_SECTION_BODY)) {
    issues.push("Unexpected Skills Index body.");
  }

  return {
    filePath: path.basename(options.filePath),
    issues,
  };
}

/**
 * Validates a proxy guidance stub matches the rendered redirect contract.
 *
 * @remarks
 * I/O: synchronous read of `options.filePath`. Normalizes bodies before comparing to `renderGuidanceProxyFile`.
 */
function buildProxyRootGuidanceAudit(options: {
  filePath: string;
}): RootGuidanceAudit {
  const fileName = path.basename(options.filePath) as (typeof ROOT_GUIDANCE_PROXY_FILES)[number];
  const content = fs.readFileSync(options.filePath, "utf8");
  const expectedContent = renderGuidanceProxyFile(fileName);

  return {
    filePath: fileName,
    issues: normalizeSectionBody(content) === normalizeSectionBody(expectedContent)
      ? []
      : ["Proxy stub does not match the required AGENTS.md redirect content."],
  };
}

/**
 * Compares an on-disk generated skill index to the canonical render for a partition.
 *
 * @remarks
 * I/O: `existsSync` and synchronous read when present. Missing files surface as `missingFile` with all expected refs listed as missing.
 */
function buildGeneratedIndexAudit(options: {
  entries: ReturnType<typeof collectSkillIndexEntries>;
  filePath: string;
  partition: "aiprofile" | "expert";
}): GeneratedIndexAudit {
  const expectedEntries = filterSkillIndexEntriesByPartition(options.entries, options.partition);
  const expectedContent = renderGeneratedSkillIndexFile({
    entries: options.entries,
    partition: options.partition,
  });
  const expectedRefs = expectedEntries.map((entry) => entry.ref);

  if (!fs.existsSync(options.filePath)) {
    return {
      contentDrift: false,
      duplicateSkillRefs: [],
      extraSkillRefs: [],
      filePath: path.basename(options.filePath),
      mismatchedSkillDescriptions: [],
      missingFile: true,
      missingSkillRefs: expectedRefs,
    };
  }

  const content = fs.readFileSync(options.filePath, "utf8");
  const actualEntries = extractGeneratedSkillIndexEntries(content);
  const actualRefs = actualEntries.map((entry) => entry.ref);
  const actualRefsSet = new Set(actualRefs);
  const expectedRefsSet = new Set(expectedRefs);
  const actualDescriptionsByRef = new Map<string, string>();

  for (const actualEntry of actualEntries) {
    if (!actualDescriptionsByRef.has(actualEntry.ref)) {
      actualDescriptionsByRef.set(actualEntry.ref, actualEntry.description);
    }
  }

  return {
    contentDrift: content !== expectedContent,
    duplicateSkillRefs: countDuplicateRefs(actualRefs),
    extraSkillRefs: [...actualRefsSet]
      .filter((ref) => !expectedRefsSet.has(ref))
      .sort((leftRef, rightRef) => leftRef.localeCompare(rightRef)),
    filePath: path.basename(options.filePath),
    mismatchedSkillDescriptions: expectedEntries
      .filter((entry) => actualRefsSet.has(entry.ref))
      .filter((entry) => actualDescriptionsByRef.get(entry.ref) !== entry.descriptionSummary)
      .map((entry) => {
        return {
          actual: actualDescriptionsByRef.get(entry.ref) ?? null,
          expected: entry.descriptionSummary,
          ref: entry.ref,
        };
      })
      .sort((leftMismatch, rightMismatch) => leftMismatch.ref.localeCompare(rightMismatch.ref)),
    missingFile: false,
    missingSkillRefs: expectedRefs
      .filter((ref) => !actualRefsSet.has(ref))
      .sort((leftRef, rightRef) => leftRef.localeCompare(rightRef)),
  };
}

/**
 * Computes the aggregate issue count used for reporting and strict exit.
 *
 * @remarks
 * PURE: counts root guidance issue strings plus generated-index drift signals (booleans as 0/1 and list lengths).
 */
function countIssues(report: AuditReport): number {
  const rootGuidanceIssues = report.rootGuidanceAudits.reduce((total, audit) => {
    return total + audit.issues.length;
  }, 0);

  const generatedIndexIssues = report.generatedIndexAudits.reduce((total, audit) => {
    return total
      + Number(audit.missingFile)
      + Number(audit.contentDrift)
      + audit.missingSkillRefs.length
      + audit.extraSkillRefs.length
      + audit.duplicateSkillRefs.length
      + audit.mismatchedSkillDescriptions.length;
  }, 0);

  return rootGuidanceIssues + generatedIndexIssues;
}

/**
 * Prints expected canonical AGENTS.md body context when the root skills index section drifts.
 */
function printCanonicalRootGuidanceExpectedBody(audit: RootGuidanceAudit): void {
  const content = fs.readFileSync(path.join(process.cwd(), audit.filePath), "utf8");
  const actualSectionBody = extractMarkdownSectionBody(content, ROOT_SKILLS_INDEX_HEADING);
  if (actualSectionBody !== null) {
    console.log("    Found body:");
    for (const line of actualSectionBody.split("\n")) {
      console.log(`      ${line}`);
    }
  }
  console.log("    Expected body:");
  for (const line of ROOT_SKILLS_INDEX_SECTION_BODY.split("\n")) {
    console.log(`      ${line}`);
  }
}

/**
 * Prints expected proxy-file content for root guidance stubs.
 */
function printProxyRootGuidanceExpectedContent(audit: RootGuidanceAudit): void {
  const expectedProxyContent = renderGuidanceProxyFile(
    audit.filePath as (typeof ROOT_GUIDANCE_PROXY_FILES)[number],
  );
  console.log("    Expected content:");
  for (const line of expectedProxyContent.trimEnd().split("\n")) {
    console.log(`      ${line}`);
  }
}

/**
 * Prints one root-guidance audit block with expected-body details for drifted files.
 */
function printRootGuidanceAudit(audit: RootGuidanceAudit): void {
  console.log(`  File: ${audit.filePath}`);
  if (audit.issues.length === 0) {
    console.log("    Issues: none");
    return;
  }

  for (const issue of audit.issues) {
    console.log(`    ${issue}`);
  }

  if (audit.filePath === ROOT_GUIDANCE_CANONICAL_FILE) {
    printCanonicalRootGuidanceExpectedBody(audit);
    return;
  }

  printProxyRootGuidanceExpectedContent(audit);
}

/**
 * Returns whether a generated skill-index audit has any issue bucket populated.
 */
function generatedIndexAuditHasIssues(audit: GeneratedIndexAudit): boolean {
  return (
    audit.missingFile ||
    audit.contentDrift ||
    audit.missingSkillRefs.length > 0 ||
    audit.extraSkillRefs.length > 0 ||
    audit.duplicateSkillRefs.length > 0 ||
    audit.mismatchedSkillDescriptions.length > 0
  );
}

/**
 * Prints a titled list of refs when the list is non-empty.
 */
function printGeneratedIndexRefList(title: string, refs: string[]): void {
  if (refs.length === 0) {
    return;
  }

  console.log(`    ${title}:`);
  for (const ref of refs) {
    console.log(`      - ${ref}`);
  }
}

/**
 * Prints mismatched skill descriptions when the generated index has stale or missing text.
 */
function printGeneratedIndexDescriptionMismatches(
  mismatches: GeneratedIndexAudit["mismatchedSkillDescriptions"],
): void {
  if (mismatches.length === 0) {
    return;
  }

  console.log("    Mismatched descriptions:");
  for (const mismatch of mismatches) {
    console.log(
      `      - ${mismatch.ref}: expected '${mismatch.expected}', found '${mismatch.actual ?? "(missing)"}'`,
    );
  }
}

/**
 * Prints one generated skill-index audit block.
 */
function printGeneratedIndexAudit(audit: GeneratedIndexAudit): void {
  console.log(`  File: ${audit.filePath}`);
  if (!generatedIndexAuditHasIssues(audit)) {
    console.log("    Issues: none");
    return;
  }
  if (audit.missingFile) {
    console.log("    Generated file is missing.");
  }
  if (audit.contentDrift) {
    console.log("    File content drifts from the generated layout.");
  }
  printGeneratedIndexRefList("Missing refs", audit.missingSkillRefs);
  printGeneratedIndexRefList("Extra refs", audit.extraSkillRefs);
  printGeneratedIndexRefList("Duplicate refs", audit.duplicateSkillRefs);
  printGeneratedIndexDescriptionMismatches(audit.mismatchedSkillDescriptions);
}

/**
 * Prints a structured human-readable audit summary to stdout.
 *
 * @remarks
 * I/O: reads `AGENTS.md` from cwd when canonical guidance issues need an inline body diff; otherwise stdout only.
 */
function printHumanReport(report: AuditReport): void {
  console.log("Root guidance lazy skill-index alignment audit");
  console.log("============================================\n");
  console.log("Expected skill counts:");
  console.log(`  - aiprofile partition: ${report.expectedSkillCounts.aiprofile}`);
  console.log(`  - Expert: ${report.expectedSkillCounts.expert}\n`);

  console.log("Root guidance files:");
  for (const audit of report.rootGuidanceAudits) {
    printRootGuidanceAudit(audit);
  }

  console.log("\nGenerated skill index files:");
  for (const audit of report.generatedIndexAudits) {
    printGeneratedIndexAudit(audit);
  }

  console.log(`\nTotal issues: ${report.totalIssues}`);
}

/**
 * CLI entry: scans repo guidance and generated indexes, then prints JSON or a human report.
 *
 * @remarks
 * I/O: cwd-relative filesystem reads across guidance and generated index paths. Exits with code 1 when `--strict` and `totalIssues` is positive.
 */
function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const repoRoot = process.cwd();
  const entries = collectSkillIndexEntries(repoRoot);
  const rootGuidanceAudits = [
    buildCanonicalRootGuidanceAudit({
      filePath: path.join(repoRoot, ROOT_GUIDANCE_CANONICAL_FILE),
    }),
    ...ROOT_GUIDANCE_PROXY_FILES.map((guidanceFile) =>
      buildProxyRootGuidanceAudit({
        filePath: path.join(repoRoot, guidanceFile),
      })
    ),
  ];
  const generatedIndexAudits = (["aiprofile", "expert"] as const).map((partition) =>
    buildGeneratedIndexAudit({
      entries,
      filePath: path.join(repoRoot, GENERATED_SKILL_INDEX_FILES[partition]),
      partition,
    })
  );
  const report: AuditReport = {
    expectedSkillCounts: {
      aiprofile: filterSkillIndexEntriesByPartition(entries, "aiprofile").length,
      expert: filterSkillIndexEntriesByPartition(entries, "expert").length,
    },
    generatedIndexAudits,
    rootGuidanceAudits,
    totalIssues: 0,
  };
  report.totalIssues = countIssues(report);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }

  if (options.strict && report.totalIssues > 0) {
    process.exit(1);
  }
}

main();
