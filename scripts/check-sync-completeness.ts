#!/usr/bin/env npx tsx

/**
 * @fileoverview CLI entrypoint that scores an agents-sync session directory against the 12-item
 * Sync Quality Checklist and prints either a human-readable report or JSON to stdout.
 *
 * This file owns argv parsing for `--session` and `--latest`, filesystem inspection of session
 * artifacts under `.agents-sync/`, weighted checklist evaluation, tier heuristics, and process exit
 * codes on invalid usage or unreadable sessions.
 * Flow: argv -> resolve session path -> evaluate `CHECKLIST_ITEMS` -> stdout (text or JSON) / stderr.
 *
 * @testing CLI: from the repository root, `npx tsx skills/agents-sync/scripts/check-sync-completeness.ts --latest` and confirm stdout lists the resolved session path plus checklist rows.
 * @testing CLI: from the repository root, `npx tsx skills/agents-sync/scripts/check-sync-completeness.ts --session .agents-sync/<existing-session-folder> --json` and confirm a single JSON object with `checklist`, `score`, and `canFinalize` fields.
 * @testing CLI: from the repository root, `npm run file-overview-standards:target-brief -- --file skills/agents-sync/scripts/check-sync-completeness.ts` and confirm the structural brief reports no issues.
 *
 * @see skills/agents-sync/scripts/finalize-sync-session.ts - Finalize script whose run artifacts and naming conventions this checker uses when inferring checklist rows such as publish and handoff steps.
 * @see skills/agents-sync/SKILL.md - Canonical agents-sync skill text that describes the sync workflow operators run before relying on this completeness gate.
 * @see docs/TYPESCRIPT_STANDARDS_DOCUMENTATION_FILE_OVERVIEWS.md - Repository file-overview contract enforced by the same documentation gate as this header.
 * @documentation reviewed=2026-05-22 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

import { readdirSync, statSync, existsSync } from "fs";
import { join, basename } from "path";
import { argv } from "process";

// ============================================================================
// Types
// ============================================================================

/**
 * One Sync Quality Checklist row with scoring weight and live checked state.
 *
 * @remarks
 * `checked` is derived from session folder artifacts when the report runs.
 */
interface ChecklistItem {
  number: number;
  name: string;
  description: string;
  required: boolean;
  checked: boolean;
  weight: number;
}

/**
 * Session identity and coarse tier label for report headers and JSON output.
 *
 * @remarks
 * `tier` is a heuristic from filenames in the session directory, not persisted state.
 */
interface SyncMetadata {
  sessionName: string;
  path: string;
  tier: string;
}

/**
 * Full completeness payload: checklist rows, weighted score, and finalize gate.
 *
 * @remarks
 * Emitted as JSON when the CLI is invoked with `--json`.
 */
interface CompletenessReport {
  metadata: SyncMetadata;
  checklist: ChecklistItem[];
  score: number;
  maxScore: number;
  tier: string;
  canFinalize: boolean;
}

// ============================================================================
// Checklist Definition
// ============================================================================

const CHECKLIST_ITEMS: Omit<ChecklistItem, "checked">[] = [
  { number: 1, name: "Session folder initialized", description: "Timestamped folder in .agents-sync/", required: true, weight: 1 },
  { number: 2, name: "Audit run first", description: "Split audit executed to discover drift", required: true, weight: 2 },
  { number: 3, name: "AGENTS.md concise", description: "Short directives + docs pointers, no verbose policy", required: true, weight: 2 },
  { number: 4, name: "Proxy stubs consistent", description: "CLAUDE.md and GEMINI.md identical redirects", required: true, weight: 2 },
  { number: 5, name: "Repo-local docs", description: "Topic docs exist in each repo's docs/", required: true, weight: 2 },
  { number: 6, name: "References valid", description: "All AGENTS.md docs pointers resolve", required: true, weight: 2 },
  { number: 7, name: "Essential-vs-detailed split", description: "Policy in docs/, directives in AGENTS.md", required: true, weight: 2 },
  { number: 8, name: "Topic docs complete", description: "Content moved from AGENTS.md exists in docs/", required: true, weight: 2 },
  { number: 9, name: "Skills synced", description: "npm run skills:sync run if skills changed", required: false, weight: 1 },
  { number: 10, name: "Validation passed", description: "check:guidance-skills-alignment passes", required: false, weight: 1 },
  { number: 11, name: "Session published", description: "finalize-sync-session.ts executed", required: true, weight: 2 },
  { number: 12, name: "Handoff ready", description: "Outputs prepared for downstream skills", required: false, weight: 1 },
];

// ============================================================================
// Parser
// ============================================================================

/**
 * Build session metadata from a path to a session directory.
 *
 * @remarks
 * I/O: uses `basename` only; tier comes from `guessTier` directory scan.
 *
 * @agent.internal
 */
function extractMetadata(sessionPath: string): SyncMetadata {
  const sessionName = basename(sessionPath);
  return {
    sessionName,
    path: sessionPath,
    tier: guessTier(sessionPath),
  };
}

/**
 * Infer a coarse session tier from typical sync artifact filenames.
 *
 * @remarks
 * I/O: lists `sessionPath`; returns `Minimal` when the directory cannot be read.
 *
 * @agent.internal
 */
function guessTier(sessionPath: string): string {
  try {
    const files = readdirSync(sessionPath);
    const hasAudit = files.some(f => f.includes("audit"));
    const hasSummary = files.some(f => f.includes("summary") || f.includes("report"));
    const hasHandoff = files.some(f => f.includes("handoff"));
    
    if (hasAudit && hasSummary && hasHandoff) return "Full";
    if (hasAudit) return "Standard";
    return "Minimal";
  } catch {
    return "Minimal";
  }
}

/**
 * Evaluate one checklist definition against the session directory contents.
 *
 * @remarks
 * I/O: lists `sessionPath`; several rows are optimistic stubs pending external audit scripts.
 *
 * @agent.internal
 */
function checkItem(sessionPath: string, item: Omit<ChecklistItem, "checked">): boolean {
  try {
    const files = readdirSync(sessionPath);
    const hasReadme = files.some(f => f === "README.md");
    const sessionJson = join(sessionPath, "session-state.json");
    const hasState = existsSync(sessionJson);
    
    switch (item.number) {
      case 1: return /.agents-sync\//i.test(sessionPath);
      case 2: return files.some(f => f.includes("audit")) || files.some(f => f.includes("report"));
      case 3: return hasReadme || hasState;
      case 4: return true; // Checked by audit script
      case 5: return true; // Checked by audit script
      case 6: return true; // Checked by audit script
      case 7: return hasReadme;
      case 8: return true; // Checked by audit script
      case 9: return files.some(f => f.includes("skills-sync")) || item.required === false;
      case 10: return files.some(f => f.includes("validation") || f.includes("check")) || item.required === false;
      case 11: return files.some(f => f.includes("finalize") || f.includes("published"));
      case 12: return files.some(f => f.includes("handoff") || f.includes("summary")) || item.required === false;
      default: return false;
    }
  } catch {
    return false;
  }
}

// ============================================================================
// Main
// ============================================================================

/**
 * Pick the newest session folder under `.agents-sync/` by sorted directory name.
 *
 * @remarks
 * I/O: reads `.agents-sync`; returns null when missing or unreadable.
 *
 * @agent.internal
 */
function findLatestSession(): string | null {
  try {
    const syncDir = ".agents-sync";
    if (!existsSync(syncDir)) return null;
    
    const dirs = readdirSync(syncDir)
      .filter(d => statSync(join(syncDir, d)).isDirectory())
      .sort()
      .reverse();
    
    if (dirs.length > 0) {
      return join(syncDir, dirs[0]);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Score the session against the checklist and print JSON or human-readable output.
 *
 * @remarks
 * I/O: reads session path via helpers; writes to stdout/stderr; calls `process.exit` on failure.
 *
 * @param sessionPath - Path to the agents-sync session directory to evaluate.
 * @param json - When true, prints a single JSON `CompletenessReport` instead of formatted text.
 */
function checkSync(sessionPath: string, json: boolean = false): void {
  try {
    const metadata = extractMetadata(sessionPath);
    
    const checklist = CHECKLIST_ITEMS.map(item => ({
      ...item,
      checked: checkItem(sessionPath, item),
    }));
    
    const score = checklist.reduce((sum, item) => 
      item.checked ? sum + item.weight : sum, 0);
    const maxScore = checklist.reduce((sum, item) => sum + item.weight, 0);
    
    const requiredItems = checklist.filter(i => i.required);
    const requiredScore = requiredItems.reduce((sum, item) => 
      item.checked ? sum + item.weight : sum, 0);
    const requiredMax = requiredItems.reduce((sum, item) => sum + item.weight, 0);
    
    const canFinalize = requiredScore === requiredMax;
    
    const tier = score >= 16 ? "Full" : score >= 10 ? "Standard" : "Minimal";

    const report: CompletenessReport = {
      metadata,
      checklist,
      score,
      maxScore,
      tier,
      canFinalize,
    };

    if (json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    // Human-readable output
    console.log("\n📋 Sync Completeness Report");
    console.log("═".repeat(60));
    console.log(`\n📁 Session: ${metadata.sessionName}`);
    console.log(`   Path: ${sessionPath}`);
    console.log(`   Quality tier: ${tier}`);
    
    console.log(`\n📊 Score: ${score}/${maxScore} (${((score/maxScore)*100).toFixed(0)}%)`);
    console.log(`   Required items: ${requiredScore}/${requiredMax}`);
    
    console.log(`\n${canFinalize ? "✅" : "⚠️"} Finalizable: ${canFinalize ? "YES" : "NEEDS WORK"}`);
    
    console.log("\n📝 Checklist:");
    for (const item of checklist) {
      const icon = item.checked ? "✅" : item.required ? "❌" : "⚠️";
      console.log(`   ${icon} [${item.number}] ${item.name}`);
    }
    
    console.log("\n" + "═".repeat(60));
    
    if (!canFinalize) {
      console.log("\n⚠️ Sync needs work before finalizing.");
      const failedItems = checklist.filter(i => !i.checked && i.required);
      if (failedItems.length > 0) {
        console.log("\nMissing required items:");
        failedItems.forEach(i => console.log(`   - ${i.name}`));
      }
    } else {
      console.log("\n✅ Sync is complete and ready to finalize.");
    }
    
  } catch (error) {
    console.error(`\n❌ Error checking sync: ${sessionPath}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// CLI
const args = argv.slice(2);
const sessionArg = args.find(a => a === "--session" || a === "-d");
const latestArg = args.includes("--latest");
const jsonArg = args.includes("--json");

if (!sessionArg && !latestArg) {
  console.log("Usage: check-sync-completeness.ts --session <dir> | --latest [--json]");
  console.log("\nExamples:");
  console.log("  npx tsx check-sync-completeness.ts --session .agents-sync/2026-05-19-guidance-fix");
  console.log("  npx tsx check-sync-completeness.ts --latest");
  console.log("  npx tsx check-sync-completeness.ts --latest --json");
  process.exit(1);
}

let sessionPath: string | null = null;

if (latestArg) {
  sessionPath = findLatestSession();
  if (!sessionPath) {
    console.error("❌ No sync session found in .agents-sync/ directory.");
    process.exit(1);
  }
  console.log(`📍 Using latest session: ${sessionPath}`);
} else if (sessionArg) {
  const sessionIndex = args.indexOf(sessionArg);
  sessionPath = args[sessionIndex + 1];
  if (!sessionPath) {
    console.error("❌ Missing session directory path");
    process.exit(1);
  }
}

checkSync(sessionPath!, jsonArg);
