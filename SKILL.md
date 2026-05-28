---
name: agents-sync
description: when troubleshooting guidance file drift across root repo/submodules. Configure AGENTS.md sections, reset CLAUDE.md/GEMINI.md stubs to canonical paths. MCP-compatible. Not for non-agent configs.
---

# GG → Agents Sync → Guidance Projection

> **Snapshot age:** Living workflow skill — no captured corpus. Scripts and rubric verified 2026-04-13.

## Overview

Use this skill to keep guidance files coherent across repository boundaries:
- root repository guidance files,
- every git submodule repository.

Primary objective:
- keep `AGENTS.md` canonical and operational,
- keep `CLAUDE.md` and `GEMINI.md` as minimal redirect stubs,
- move detailed procedures/specifications into topic-specific docs under each repo's `docs/` folder,
- maintain stable references from `AGENTS.md` to those docs.

If this workflow needs current external docs or web verification, follow
`docs/SKILLS_WEB_RESEARCH.md` and prefer Firecrawl CLI before the built-in `web` tool.

For a direct command lookup, see [Quick Commands](#quick-commands) below.

## When to Use This Skill

**TRIGGER when:**
- `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md` were edited in root or a submodule
- `AGENTS.md` sections exceed ~6 lines and lack a `docs/*.md` reference
- `CLAUDE.md` or `GEMINI.md` contain policy beyond an `AGENTS.md` redirect
- Multiple repos changed instructions in parallel and need reconciliation
- `npm run check:guidance-skills-alignment` fails

**SKIP when:**
- The task is editing source code, tests, or configuration without touching guidance files
- Only one repo is involved and its `AGENTS.md` is already concise with valid docs references

## Scope

Always include:
- root repo (`.`)
- all submodules listed in `.gitmodules`

At minimum, inspect in each repo:
- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`

## Common Misconceptions

| # | Misconception | Correction | Key concept |
|---|---------------|------------|-------------|
| 1 | `CLAUDE.md` and `GEMINI.md` can contain repo-specific policy | They must be minimal redirect stubs only; all policy lives in `AGENTS.md` or `docs/*.md` | Proxy stub rule |
| 2 | One submodule's `docs/` can be referenced from another repo's `AGENTS.md` | Every repo must have its own local topic docs; cross-repo references are prohibited | Repo-local docs |
| 3 | Moving content to `docs/` means removing it from `AGENTS.md` entirely | `AGENTS.md` must keep a short mandatory directive plus the docs path pointer | Essential-vs-detailed split |
| 4 | `skills:sync` is optional after guidance edits | If `skills/**` changed, `skills:sync` is mandatory before closeout | Skill sync gate |
| 5 | The audit script is only for CI | Run it first in every sync session to discover drift before editing | Audit-first workflow |
| 6 | Proxy stubs can have different content | Both CLAUDE.md and GEMINI.md must be identical redirects | Stub consistency |
| 7 | Absolute paths work in AGENTS.md | Use repository-local relative paths only | Path correctness |

## Quick Commands

```bash
# Audit all guidance files across root + submodules
npx tsx skills/agents-sync/scripts/audit-guidance-split.ts

# Audit root guidance alignment (lazy skill index + proxy stubs)
npx tsx skills/agents-sync/scripts/audit-root-guidance-skills-alignment.ts

# Initialize a sync session folder
npx tsx skills/agents-sync/scripts/init-sync-session.ts --name "<session-name>"

# Finalize and publish a session folder
npx tsx skills/agents-sync/scripts/finalize-sync-session.ts --session-dir ".agents-sync/YYYY-MM-DD-session-name"
```

Add `--json` to either audit script for machine-readable output. Add `--strict` for non-zero exit on violations.

## Command Decision Guide

| Scenario | Recommended script |
|----------|-------------------|
| Guidance sections look too long or lack docs references | `audit-guidance-split.ts` |
| Root `AGENTS.md` lazy skill index or proxy stubs might be stale | `audit-root-guidance-skills-alignment.ts` |
| CI gate for guidance split violations | `audit-guidance-split.ts --strict` |
| CI gate for root guidance alignment | `audit-root-guidance-skills-alignment.ts --strict` |

**Rule of thumb:** Run the split audit first to find what to fix; run the alignment audit last to verify the root repo's generated indexes and proxy stubs.

## Sync Quality Checklist

Use this checklist before finalizing any sync session. Each item is a gate - the sync is not ready until all required items are satisfied.

| # | Checklist Item | Why It Matters | Gate |
|---|---------------|---------------|------|
| 1 | **Session folder initialized** - Timestamped folder in `.agents-sync/` | Enables tracking | Pre-sync |
| 2 | **Audit run first** - Split audit executed to discover drift | Prevents editing blindly | Pre-sync |
| 3 | **AGENTS.md concise** - Short directives + docs pointers, no verbose policy | Separation of concerns | Draft |
| 4 | **Proxy stubs consistent** - CLAUDE.md and GEMINI.md identical redirects | Stub correctness | Draft |
| 5 | **Repo-local docs** - Topic docs exist in each repo's `docs/` | No cross-repo refs | Draft |
| 6 | **References valid** - All `AGENTS.md` docs pointers resolve | Prevents broken links | Draft |
| 7 | **Essential-vs-detailed split** - Policy in docs/, directives in AGENTS.md | Structure compliance | Draft |
| 8 | **Topic docs complete** - Content moved from AGENTS.md exists in docs/ | No content loss | Draft |
| 9 | **Skills synced** - `npm run skills:sync` run if skills changed | IDE index current | Closeout |
| 10 | **Validation passed** - `check:guidance-skills-alignment` passes | Root alignment verified | Closeout |
| 11 | **Session published** - finalize-sync-session.ts executed | Artifact hygiene | Closeout |
| 12 | **Handoff ready** - Outputs prepared for downstream skills | Enables coordination | Closeout |

### Quality Tiers

| Tier | Criteria | Use When |
|------|----------|----------|
| **Minimal** | Items 1-3, 11 | Quick stub reset |
| **Standard** | Items 1-8, 11 | Full sync with docs split |
| **Full** | All 12 items | Complete sync with validation |

### Pre-Finalization Verification

Before running finalize-sync-session.ts, verify:

```
□ Session folder initialized in .agents-sync/
□ Split audit run and violations addressed
□ AGENTS.md has short directives + docs pointers
□ CLAUDE.md and GEMINI.md are identical redirects
□ Topic docs exist in each repo's docs/ folder
□ All docs/ references resolve to existing files
□ Essential-vs-detailed split complete
□ skills:sync run if skills changed
□ check:guidance-skills-alignment passes
□ Session folder published
```

## Sync Consistency Validator

Before finalizing a sync session, run these consistency checks.

### Consistency Check Matrix

| Check | What to Verify | How to Fix |
|-------|---------------|------------|
| **Stub vs Redirect** | CLAUDE.md and GEMINI.md are identical | Copy stub to both |
| **AGENTS.md vs Docs** | References point to existing local docs | Create or fix refs |
| **Docs vs Content** | Moved content exists in docs/ | Verify no content loss |
| **Skills vs Index** | Skills sync matches IDE indexes | Run skills:sync |
| **Root vs Submodules** | All repos have consistent structure | Audit all repos |

### Red Flags (Never Present)

A sync with any of these must be fixed before finalizing:

- [ ] Proxy stubs with different content
- [ ] AGENTS.md with verbose policy still present
- [ ] Cross-repo docs references
- [ ] Missing topic docs referenced in AGENTS.md
- [ ] skills:sync not run after skills change
- [ ] check:guidance-skills-alignment failing

## Non-Negotiable Policy

1. `AGENTS.md` is the only canonical policy file per repo.
2. `CLAUDE.md` and `GEMINI.md` must stay minimal `AGENTS.md` redirects.
3. Detailed specs, command catalogs, and examples belong in `docs/*.md` topic guides.
4. Topic guides must be repository-local; do not reference another repo's docs for local policy.
5. References in `AGENTS.md` must use local docs paths (for example `docs/HTML_CLASSES.md`).
6. If `skills/**` files changed, run `npm run skills:sync` before closeout.
7. Store run artifacts under `.agents-sync/YYYY-MM-DD-session-name-selfexplanatory/` and publish before closure unless asked otherwise.
8. Never reconstruct guidance-file content from memory; always read `references/split-rubric.md` first.

## Essential vs Detailed Split Rule

Keep in `AGENTS.md`:
- one short mandatory directive,
- one pointer to the topic guide in `docs/`.

Keep in `CLAUDE.md` and `GEMINI.md`:
- the enforced redirect back to `AGENTS.md`,
- no repo-specific policy beyond that redirect.

Move to `docs/*.md`:
- naming grammars/patterns,
- long enforcement command lists,
- examples and edge cases,
- migration/maintenance workflows,
- validation scripts and troubleshooting notes.

Use templates and examples in `references/split-rubric.md`.

## Recommended Topic Files

Use uppercase snake case topic files in each repo `docs/` directory:
- `docs/HTML_CLASSES.md`
- `docs/LOCALES.md`
- (add others only when warranted, e.g. `docs/ENVIRONMENT_VARIABLES.md` already exists in manager repos)

## Workflow

1. **Classify the task** and load the minimum references:

| Task type | Load these files | Skip |
|-----------|-----------------|------|
| Detecting drift / audit-first | Run audit scripts; no files needed initially | `split-rubric.md` until you know what to fix |
| Splitting verbose sections | `references/split-rubric.md` | Alignment audit |
| Resetting proxy stubs | `references/split-rubric.md` | Split audit |
| Full sync session | `references/split-rubric.md` + audit scripts | — |
| Diagnostic / inspection-first | Run either audit script with `--json` before loading files | All references until scope is clear |

For diagnostic requests, run the inspection commands first before loading any reference files. Load only the subset the task needs.

2. Initialize a timestamped session folder:
   - `npx tsx skills/agents-sync/scripts/init-sync-session.ts --name "<session-name>"`
3. Inventory guidance files across root + submodules.
4. Audit whether `AGENTS.md` sections are too detailed and whether `CLAUDE.md` / `GEMINI.md` still match the required redirect stub.
5. Create or update topic docs in each repo `docs/` folder.
6. Replace verbose `AGENTS.md` sections with concise essential directives + topic-doc reference, and reset `CLAUDE.md` / `GEMINI.md` to the required redirect stub when they drift.
7. Verify every reference points to an existing local docs file.
8. Run package-level validation commands for repos touched.
9. If `skills/**` changed, run `npm run skills:sync` and record output.
10. Summarize what was normalized and any remaining drift inside the session folder.
11. Publish the completed session folder:
    - `npx tsx skills/agents-sync/scripts/finalize-sync-session.ts --session-dir ".agents-sync/YYYY-MM-DD-session-name-selfexplanatory"`
    - Add `--include-path <repo-relative-path>` when the same scoped publish should also include root-repo guidance/doc changes alongside the session folder.

## Script Inventory

| Script | Purpose | Flags |
|--------|---------|-------|
| `audit-guidance-split.ts` | Audits `AGENTS.md` content, proxy stubs, and docs references across root + submodules | `--json`, `--strict` |
| `audit-root-guidance-skills-alignment.ts` | Validates root `AGENTS.md` lazy skill-index stanza, proxy stubs, and generated skill indexes | `--json`, `--strict` |
| `init-sync-session.ts` | Creates a timestamped `.agents-sync/` working directory | `--name <session-name>` |
| `finalize-sync-session.ts` | Publishes a session folder with an optional scoped commit | `--session-dir <path>`, `--latest`, `--include-path <path>`, `--commit-message <msg>`, `--dry-run` |

## Validation Baseline

After edits, run relevant checks in each touched repo:
- type checks (`npm run ts:check` or package equivalent),
- lint where required by that repo guidance,
- topic-specific checks from the referenced docs (for example class-name regex checks, locale parity checks).
- root guidance alignment check:
  - `npm run check:guidance-skills-alignment`

## Cross-Skill Handoffs

### AUTO_TRIGGER_WHEN

1. `plan/SKILL.md` execution touches `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md` in root or submodules.
2. The host project's documentation-sync workflow identifies guidance-file edits requiring split/reference reconciliation.
3. Any workflow closeout includes guidance-file deltas that need root proxy reconciliation.

### AUTO_SUGGEST_WHEN

1. Guidance-file policy sections become long and drift from local docs references.
2. Multiple repos/submodules changed instructions in parallel.

### BLOCKING_GATES

1. Do not close guidance-file changes until split/reference audit passes.
2. Do not finalize cross-repo policy updates when the root lazy-reference stanza or generated skill indexes are inconsistent.
3. Do not close combined guidance+skill workflows without `skills:sync` output.
4. Do not close root guidance updates when `check:guidance-skills-alignment` fails.

### HANDOFF_OUTPUTS

1. To `plan/SKILL.md`:
   - synchronized guidance file list,
   - unresolved drift findings.
2. To the host project's documentation-sync workflow:
   - docs references updated from guidance files,
   - verification commands and audit results.
3. To `plan/SKILL.md` and any standalone task-tracking workflow in use:
   - `skills:sync` output when skill files were modified.

## Common Pitfalls

1. **Moving all content out of `AGENTS.md`** — leaving no directive or docs pointer. Correction: always keep one short mandatory directive plus the path to the topic doc.
2. **Different content in `CLAUDE.md` vs `GEMINI.md`** — they must be identical in meaning as redirect stubs. Correction: copy the same stub into both files.
3. **Absolute paths or URLs instead of local docs paths** — `AGENTS.md` must reference `docs/LOCALES.md`, not a URL or another repo's path. Correction: use repo-local relative paths.
4. **Skipping the audit before closeout** — undetected drift accumulates. Correction: run both audit scripts before every sync session closeout.
5. **Forgetting `skills:sync`** — when `skills/**` files changed, the generated IDE skill indexes stale. Correction: run `npm run skills:sync` and include its output in handoffs.
6. **Referencing another repo's docs for local policy** — each repo must own its topic docs. Correction: create a local topic doc and point to it.
7. **Creating topic docs without updating `AGENTS.md`** — the split is incomplete if `AGENTS.md` still contains the full content. Correction: replace the verbose section with the essential directive + pointer.

## Troubleshooting

| Symptom | Likely cause and fix | Reference |
|---------|---------------------|-----------|
| Audit script reports missing `docs/HTML_CLASSES.md` reference | The `AGENTS.md` section references a topic doc that does not exist. Create the doc or remove the reference. | `references/split-rubric.md` |
| `skills:sync` fails after guidance edits | Generated skill indexes may be out of date. Re-run `npm run skills:sync` from repo root after all guidance files are saved. | Workflow step 9 |
| Proxy stub drift detected | `CLAUDE.md` or `GEMINI.md` contains content beyond a minimal redirect. Copy the expected stub from `references/split-rubric.md` and overwrite the file. | `references/split-rubric.md` |
| Session folder not published | The finalize script was not run. Execute `npx tsx skills/agents-sync/scripts/finalize-sync-session.ts --session-dir <path>`. | Script Inventory |
| Cross-repo policy inconsistency | One repo's `AGENTS.md` references another repo's `docs/` path. Each repo must have its own local topic doc. | Non-Negotiable Policy rule 4 |

## Local Corpus Layout

The `references/` directory contains **1 file** and **no subfolders**:

- `split-rubric.md` — Templates and rules for the essential-vs-detailed split (`AGENTS.md` vs `docs/*.md` vs proxy stubs).

## Temporary Files

If this skill needs to create temporary files, place them under `.tmp/agents-sync/YYYY-MM-DD-{subject}`. The root `.tmp/` directory is already gitignored. Do not create top-level dotfile temp directories.
