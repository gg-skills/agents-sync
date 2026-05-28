/**
 * @fileoverview Vendored skill-index helpers for guidance-split and guidance-alignment auditors in agents-sync.
 *
 * Mirrors the current `ide-sync` skill-index render contract while keeping the root guidance
 * constants needed by guidance auditors self-contained inside this skill package.
 * Flow: scan each immediate child directory under `skills` for `SKILL.md` -> derive
 * partition and section labels -> render or diff markdown indexes and proxy stubs consumed by root
 * guidance audits.
 *
 * @example
 * ```typescript
 * import {
 *   collectSkillIndexEntries,
 *   renderGeneratedSkillIndexFile,
 * } from "skills/agents-sync/scripts/lib/skill-index";
 *
 * const entries = collectSkillIndexEntries(repoRoot);
 * const markdown = renderGeneratedSkillIndexFile({
 *   entries,
 *   partition: "aiprofile",
 * });
 * ```
 *
 * @testing CLI: npm run check:guidance-skills-alignment
 * @testing File-overview gate (repository root): npm run check:typescript-file-overview-errors
 *
 * @see skills/agents-sync/scripts/audit-root-guidance-skills-alignment.ts - Root guidance audit that imports catalog collection, generated-index parsing, and markdown rendering from this module to validate `AGENTS.md` against on-disk `SKILLS.*.md` artifacts.
 * @see skills/agents-sync/scripts/audit-guidance-split.ts - Guidance-split auditor that imports section normalization and proxy-body rendering helpers owned here to compare split guidance files.
 * @see skills/ide-sync/scripts/skill-index/skill-index-shared.ts - ide-sync source-of-truth skill-index scanner and renderer whose contract this package mirrors for parity across skills sync and guidance audits.
 * @documentation reviewed=2026-05-22 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

/**
 * One catalog row describing a canonical skill directory and its SKILL.md reference for index rendering.
 */
export type SkillIndexEntry = {
  descriptionSummary: string;
  name: string;
  partition: string;
  ref: string;
  section: string;
};

/**
 * Minimal YAML mapping shape used when narrowing `yaml.load` output before property reads.
 */
type YamlMapping = Record<string, unknown>;

/**
 * Parsed SKILL.md frontmatter subset consumed when building index descriptions.
 */
type FrontMatterData = {
  description?: unknown;
};

export const GENERATED_SKILL_INDEX_FILES = {
  aiprofile: "SKILLS.aiprofile.md",
  expert: "SKILLS.expert.md",
} as const;

export const ROOT_GUIDANCE_CANONICAL_FILE = "AGENTS.md" as const;
export const ROOT_GUIDANCE_PROXY_FILES = ["CLAUDE.md", "GEMINI.md"] as const;
export const ROOT_GUIDANCE_FILES = [
  ROOT_GUIDANCE_CANONICAL_FILE,
  ...ROOT_GUIDANCE_PROXY_FILES,
] as const;

export const ROOT_SKILLS_INDEX_HEADING = "Skills Index";

export const ROOT_SKILLS_INDEX_SECTION_BODY_LINES = [
  "Read `SKILLS.aiprofile.md` when you need repo-specific help for Planning, Decisions, Study, task tracking, Playwright checks, Worktrees, Merging to `main`, Updating from `main`, deploy promotions, or other project workflows.",
  "Read `SKILLS.expert.md` when you need reusable expert help for Coding Tools, Vercel, Caddy/nginx, Docker, Tailscale, OAuth/Auth, UI systems, accessibility, Firecrawl/web research, or other external tools and domains.",
  "Do not read these files unless one of those skill lookups or routing decisions is needed.",
] as const;

export const ROOT_SKILLS_INDEX_SECTION_BODY =
  ROOT_SKILLS_INDEX_SECTION_BODY_LINES.join("\n");

export const GUIDANCE_PROXY_BODY_LINES = [
  "`AGENTS.md` is the canonical source of truth for this repository.",
  "",
  "Before planning, editing, or validating:",
  "1. Read `AGENTS.md` in this repository.",
  "2. If you will work inside a git submodule or nested folder that has its own `AGENTS.md`, read that local `AGENTS.md` too and follow the closest applicable one.",
  "3. Treat this file as a routing stub only.",
] as const;

export const GUIDANCE_PROXY_BODY = GUIDANCE_PROXY_BODY_LINES.join("\n");

/**
 * Type guard for plain object YAML payloads (not arrays or null).
 */
function isRecord(value: unknown): value is YamlMapping {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turns kebab-case segments into Title Case words for human-facing headings.
 *
 * @remarks
 * PURITY: pure string transform; splits on `-` and drops empty segments.
 */
function titleCaseToken(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((token) => `${token.charAt(0).toUpperCase()}${token.slice(1)}`)
    .join(" ");
}

/**
 * Maps a `skills/<name>` directory token into index partition and section labels.
 *
 * @remarks
 * Encodes naming conventions for `skills-*`, `skill-*`, and generic hyphenated folders so generated
 * indexes stay stable for guidance audits.
 */
function classifySkillDirectoryName(skillName: string): { partition: string; section: string } {
  if (skillName.startsWith("skills-")) {
    const namespace = skillName.slice("skills-".length) || "general";
    return { partition: namespace, section: "Managers" };
  }

  if (skillName.startsWith("skill-")) {
    const tokens = skillName.slice("skill-".length).split("-").filter(Boolean);
    const namespace = tokens[0] ?? "general";
    const sectionToken = tokens[1] ?? "general";
    return { partition: namespace, section: titleCaseToken(sectionToken) };
  }

  const firstToken = skillName.split("-").filter(Boolean)[0] ?? "general";
  return { partition: firstToken, section: "General" };
}

/**
 * Normalizes markdown block text by trimming trailing whitespace per line and outer blank lines.
 *
 * @remarks
 * PURITY: local string normalization only; no filesystem I/O.
 */
function normalizeBlock(blockText: string): string {
  return blockText
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .join("\n")
    .trim();
}

/**
 * Escapes regex metacharacters so arbitrary markdown headings can be embedded safely in patterns.
 *
 * @remarks
 * PURITY: local string transform for `RegExp` construction.
 */
function escapeRegExp(rawText: string): string {
  return rawText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Splits leading YAML frontmatter from a SKILL.md body using the standard `---` fence delimiter.
 *
 * @remarks
 * Returns `null` when the opening fence pattern is absent; callers treat that as missing frontmatter.
 * @param skillBody - Full SKILL.md file contents including optional YAML lead block.
 * @returns Parsed frontmatter string plus remainder body, or `null` when no fenced frontmatter exists.
 */
function parseFrontmatter(skillBody: string): { frontMatter: string; body: string } | null {
  const match = skillBody.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---\s*[\r\n]+/);
  if (!match || typeof match[1] !== "string") {
    return null;
  }
  return { frontMatter: match[1], body: skillBody.slice(match[0].length) };
}

/**
 * Loads SKILL.md YAML frontmatter into a narrow object contract for description extraction.
 *
 * @remarks
 * I/O: none beyond in-memory parse. Throws when fenced YAML is absent or parses to a non-object mapping.
 * @param skillBody - Full SKILL.md file contents including optional YAML lead block.
 */
function loadFrontmatterData(skillBody: string): FrontMatterData {
  const parsedFrontmatter = parseFrontmatter(skillBody);
  if (!parsedFrontmatter) {
    throw new Error("SKILL.md is missing YAML frontmatter.");
  }
  const loadedFrontmatter = yaml.load(parsedFrontmatter.frontMatter);
  if (!isRecord(loadedFrontmatter)) {
    throw new Error("SKILL.md frontmatter must be a YAML object.");
  }
  return loadedFrontmatter;
}

/**
 * Extracts the markdown body under a `## <heading>` section without crossing the next `##` fence.
 *
 * @remarks
 * PURITY: regex scan over provided string content only.
 * @param content - Full markdown document text to search.
 * @param heading - Section title text without leading `##` markers.
 * @returns Trimmed section body, or `null` when the heading is absent.
 */
export function extractMarkdownSectionBody(
  content: string,
  heading: string,
): string | null {
  const headingPattern = `^## ${escapeRegExp(heading)}\\s*$`;
  const sectionRegex = new RegExp(
    `${headingPattern}\n([\\s\\S]*?)(?=^##\\s|\\Z)`,
    "m",
  );
  const match = content.match(sectionRegex);
  if (!match || typeof match[1] !== "string") {
    return null;
  }
  return normalizeBlock(match[1]);
}

/**
 * Scans `skills` for SKILL.md files and builds sorted index rows for registry rendering.
 *
 * @remarks
 * I/O: synchronous filesystem reads and directory listing under `repoRoot/skills/*`.
 * Missing `skills` yields an empty array; directories without SKILL.md are skipped silently.
 * @param repoRoot - Repository root path containing `skills/` when present.
 * @returns Sorted rows suitable for generated markdown indices and parity audits.
 */
export function collectSkillIndexEntries(repoRoot: string): SkillIndexEntry[] {
  const skillsRoot = path.join(repoRoot, "skills");
  if (!fs.existsSync(skillsRoot)) {
    return [];
  }

  return fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .flatMap((entry): SkillIndexEntry[] => {
      const ref = path.posix.join("skills", entry.name, "SKILL.md");
      const skillFilePath = path.join(repoRoot, ref);
      if (!fs.existsSync(skillFilePath)) {
        return [];
      }

      const skillBody = fs.readFileSync(skillFilePath, "utf8");
      const frontMatterData = loadFrontmatterData(skillBody);
      const descriptionSummary =
        typeof frontMatterData.description === "string" &&
        frontMatterData.description.trim().length > 0
          ? frontMatterData.description.trim()
          : "No description provided.";
      const { partition, section } = classifySkillDirectoryName(entry.name);

      return [
        {
          descriptionSummary,
          name: entry.name,
          partition,
          ref,
          section,
        },
      ];
    })
    .sort((leftEntry, rightEntry) => leftEntry.name.localeCompare(rightEntry.name));
}

/**
 * Keeps index rows whose `partition` matches the requested generated file family.
 *
 * @remarks
 * PURITY: filters the provided array without mutating inputs.
 * @param entries - Catalog rows typically produced by `collectSkillIndexEntries`.
 * @param partition - Namespace discriminator aligned with generated index filenames.
 */
export function filterSkillIndexEntriesByPartition(
  entries: SkillIndexEntry[],
  partition: string,
): SkillIndexEntry[] {
  return entries.filter((entry) => entry.partition === partition);
}

/**
 * Parses legacy and current generated skill-index bullet lines back into ref/description tuples.
 *
 * @remarks
 * PURITY: line-oriented scan of markdown text; tolerates two bullet shapes for backward-compatible diffs.
 * @param fileContent - Full contents of a generated skills index markdown file.
 */
export function extractGeneratedSkillIndexEntries(fileContent: string): Array<{
  description: string;
  ref: string;
}> {
  const entries: Array<{ description: string; ref: string }> = [];
  const currentEntryRegex = /^- `([A-Za-z0-9_.-]+)` — (.+)$/;
  const legacyEntryRegex = /^- `(skills\/[A-Za-z0-9_.-]+\/SKILL\.md)` — (.+)$/;

  for (const line of fileContent.split("\n")) {
    const legacyMatch = line.match(legacyEntryRegex);
    if (legacyMatch) {
      entries.push({
        description: (legacyMatch[2] ?? "").trim(),
        ref: legacyMatch[1] ?? "",
      });
      continue;
    }

    const currentMatch = line.match(currentEntryRegex);
    if (currentMatch) {
      const skillName = currentMatch[1] ?? "";
      entries.push({
        description: (currentMatch[2] ?? "").trim(),
        ref: path.posix.join("skills", skillName, "SKILL.md"),
      });
    }
  }

  return entries;
}

/**
 * Renders a generated markdown skills index grouped by section for a single partition namespace.
 *
 * @remarks
 * PURITY: string assembly only; callers persist outputs.
 * @param options.entries - Full catalog; internally filtered by `options.partition`.
 * @param options.partition - Target partition key determining which skills appear in output.
 * @returns Stable trailing-newline markdown suitable for writing to `SKILLS.*.md` artifacts.
 */
export function renderGeneratedSkillIndexFile(options: {
  entries: SkillIndexEntry[];
  partition: string;
}): string {
  const entries = filterSkillIndexEntriesByPartition(options.entries, options.partition);
  const groupedEntries = new Map<string, SkillIndexEntry[]>();

  for (const entry of entries) {
    const sectionEntries = groupedEntries.get(entry.section) ?? [];
    sectionEntries.push(entry);
    groupedEntries.set(entry.section, sectionEntries);
  }

  const sections = [...groupedEntries.keys()].sort((left, right) =>
    left.localeCompare(right),
  );
  const lines = [
    `# ${titleCaseToken(options.partition)} Skills Index`,
    "",
    "Generated from `skills/*/SKILL.md`. Do not edit manually.",
    "",
  ];

  for (const section of sections) {
    lines.push(`## ${section}`, "");
    const sectionEntries = groupedEntries.get(section) ?? [];
    for (const entry of sectionEntries) {
      lines.push(`- \`${entry.name}\` — ${entry.descriptionSummary}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * Builds the stub markdown body for `CLAUDE.md` or `GEMINI.md` routing proxies from shared constants.
 *
 * @remarks
 * PURITY: template interpolation using `GUIDANCE_PROXY_BODY` lines.
 * @param fileName - Proxy filename token; must match `ROOT_GUIDANCE_PROXY_FILES` entries.
 */
export function renderGuidanceProxyFile(
  fileName: (typeof ROOT_GUIDANCE_PROXY_FILES)[number],
): string {
  return `# ${fileName}\n\n${GUIDANCE_PROXY_BODY}\n`;
}

/**
 * Public wrapper around shared markdown block trimming used by guidance section synchronizers.
 *
 * @remarks
 * PURITY: delegates to local `normalizeBlock` without extra behavioral deltas.
 */
export function normalizeSectionBody(blockText: string): string {
  return normalizeBlock(blockText);
}
