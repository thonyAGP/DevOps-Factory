/**
 * outcome-registry.ts
 *
 * Captures the final state of self-heal PRs and adjusts pattern confidence
 * scores automatically based on observed merge/close rates.
 *
 * - Reads current audit data from data/pattern-scores.json
 * - Fetches recent PRs (7 days) for repos with hasSelfHealing: true
 * - Records outcomes in data/outcome-registry.json
 * - Promotes/degrades patterns based on historical success rates
 * - Updates data/patterns.json with adjusted confidence scores
 *
 * Run: pnpm outcome-registry
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { KNOWN_PROJECTS } from '../factory.config.js';
import { devNull } from './shell-utils.js';
import { logActivity } from './activity-logger.js';
import { getCached, setCache } from './cache-manager.js';

// --- Types ---

interface OutcomeEntry {
  repo: string;
  prNumber: number;
  patternId: string;
  state: 'merged' | 'closed' | 'open';
  createdAt: string;
  closedAt: string | null;
  mergedAt: string | null;
}

interface PatternStat {
  total: number;
  merged: number;
  closed: number;
  successRate: number;
  autoMergeEligible: boolean;
}

interface OutcomeRegistry {
  lastUpdated: string;
  outcomes: OutcomeEntry[];
  patternStats: Record<string, PatternStat>;
}

interface PatternScoreEntry {
  total: number;
  merged: number;
  closed: number;
  successRate: number;
  repos: string[];
}

interface PatternScoresFile {
  timestamp: string;
  patterns: Record<string, PatternScoreEntry>;
  summary: {
    totalPRs: number;
    merged: number;
    closed: number;
    overallSuccessRate: number;
    excluded: {
      configPRs: number;
      titles: string[];
    };
  };
}

interface Pattern {
  id: string;
  category: string;
  signature: string;
  fix: string;
  fixType: string;
  repos_seen: string[];
  occurrences: number;
  confidence: number;
}

interface PatternDB {
  version: number;
  lastUpdated: string;
  patterns: Pattern[];
}

// --- Config ---

const SCORES_PATH = 'data/pattern-scores.json';
const REGISTRY_PATH = 'data/outcome-registry.json';
const PATTERN_DB_PATH = 'data/patterns.json';
const LOOKBACK_DAYS = 7;

// Promotion/demotion thresholds
const MIN_PRS_FOR_ADJUSTMENT = 5;
const PROMOTE_THRESHOLD = 0.85;
const DEGRADE_THRESHOLD = 0.3;
const MIN_CONFIDENCE = 0.1;

// --- Shell helper ---

const sh = (cmd: string, timeout = 60000): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout }).trim();
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    return err.stdout?.trim() || err.stderr?.trim() || '';
  }
};

// --- Pattern extraction (shared with audit-pr-outcomes) ---

const extractPatternId = (title: string, body: string): string => {
  // Explicit pattern tag in title: [pattern:xxx]
  const patternTag = title.match(/\[pattern:([^\]]+)\]/);
  if (patternTag) return patternTag[1];

  // Pattern ID in body: **Pattern ID**: `xxx`
  const bodyPattern = body.match(/\*\*Pattern ID\*\*:\s*`([^`]+)`/);
  if (bodyPattern) return bodyPattern[1];

  // Infer pattern from PR title for known fix types
  if (/lockfile/i.test(title)) return 'lockfile-sync';
  if (/prettier/i.test(title)) return 'prettier-format-error';
  if (/eslint/i.test(title)) return 'eslint-unused-vars';
  if (/type\s*error/i.test(title)) return 'next-build-type-error';

  // Generic AI-generated fix
  if (/AI-generated CI fix/i.test(title)) return 'ai-generated';

  return 'unknown';
};

/** Filter out config PRs (tooling setup, not CI fixes) */
const isConfigPR = (title: string): boolean => {
  const configPatterns = [/^chore:\s*add\s+/i, /^feat:\s*add\s+test\s+coverage/i];
  return configPatterns.some((p) => p.test(title));
};

/** Check if a PR was created by DevOps-Factory */
const isFactoryPR = (author: string, body: string, labels: string[]): boolean => {
  if (labels.includes('ai-fix')) return true;
  if (/DevOps.Factory/i.test(body)) return true;
  if (/DevOps Factory Bot/i.test(author)) return true;
  if (/self-heal/i.test(body)) return true;
  return false;
};

// --- GitHub API ---

interface GHPullRequest {
  number: number;
  title: string;
  state: string;
  body: string;
  mergedAt: string | null;
  createdAt: string;
  closedAt: string | null;
  author: { login: string };
  labels: Array<{ name: string }>;
}

/**
 * Fetch recent PRs (last 7 days) for a repo created by DevOps-Factory.
 * Checks both open and closed states.
 */
const fetchRecentPRs = (repo: string): OutcomeEntry[] => {
  const cacheKey = `outcome-registry-${repo}`;
  const cached = getCached<OutcomeEntry[]>(cacheKey);
  if (cached) {
    console.log(`  (cached) ${cached.length} PRs`);
    return cached;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
  const cutoffISO = cutoff.toISOString().split('T')[0]; // YYYY-MM-DD

  const entries: OutcomeEntry[] = [];
  const seenNumbers = new Set<number>();

  // Fetch closed PRs with ai-fix label
  for (const state of ['closed', 'open'] as const) {
    const result = sh(
      `gh pr list --repo ${repo} --state ${state} --label ai-fix --limit 100 --json number,title,state,body,mergedAt,createdAt,closedAt,author,labels 2>${devNull}`
    );

    if (!result) continue;

    let prs: GHPullRequest[];
    try {
      prs = JSON.parse(result) as GHPullRequest[];
    } catch {
      continue;
    }

    for (const pr of prs) {
      if (seenNumbers.has(pr.number)) continue;
      if (pr.createdAt < cutoffISO) continue;

      const labels = pr.labels.map((l) => l.name);
      const author = pr.author?.login ?? '';
      const body = pr.body ?? '';

      if (!isFactoryPR(author, body, labels)) continue;
      if (isConfigPR(pr.title)) continue;

      seenNumbers.add(pr.number);

      const isMerged = pr.mergedAt !== null && pr.mergedAt !== '';
      let prState: OutcomeEntry['state'];
      if (isMerged) {
        prState = 'merged';
      } else if (pr.state === 'OPEN' || pr.state === 'open') {
        prState = 'open';
      } else {
        prState = 'closed';
      }

      entries.push({
        repo,
        prNumber: pr.number,
        patternId: extractPatternId(pr.title, body),
        state: prState,
        createdAt: pr.createdAt,
        closedAt: pr.closedAt ?? null,
        mergedAt: pr.mergedAt ?? null,
      });
    }
  }

  // Also search by title/body for unlabeled Factory PRs
  const searchResult = sh(
    `gh pr list --repo ${repo} --state all --search "DevOps Factory in:title,body created:>=${cutoffISO}" --limit 50 --json number,title,state,body,mergedAt,createdAt,closedAt,author,labels 2>${devNull}`
  );

  if (searchResult) {
    let prs: GHPullRequest[];
    try {
      prs = JSON.parse(searchResult) as GHPullRequest[];
    } catch {
      prs = [];
    }

    for (const pr of prs) {
      if (seenNumbers.has(pr.number)) continue;

      const labels = pr.labels.map((l) => l.name);
      const author = pr.author?.login ?? '';
      const body = pr.body ?? '';

      if (!isFactoryPR(author, body, labels)) continue;
      if (isConfigPR(pr.title)) continue;

      seenNumbers.add(pr.number);

      const isMerged = pr.mergedAt !== null && pr.mergedAt !== '';
      let prState: OutcomeEntry['state'];
      if (isMerged) {
        prState = 'merged';
      } else if (pr.state === 'OPEN' || pr.state === 'open') {
        prState = 'open';
      } else {
        prState = 'closed';
      }

      entries.push({
        repo,
        prNumber: pr.number,
        patternId: extractPatternId(pr.title, body),
        state: prState,
        createdAt: pr.createdAt,
        closedAt: pr.closedAt ?? null,
        mergedAt: pr.mergedAt ?? null,
      });
    }
  }

  setCache(cacheKey, entries);
  return entries;
};

// --- Load existing registry ---

const loadRegistry = (): OutcomeRegistry => {
  if (!existsSync(REGISTRY_PATH)) {
    return { lastUpdated: '', outcomes: [], patternStats: {} };
  }
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8')) as OutcomeRegistry;
  } catch {
    return { lastUpdated: '', outcomes: [], patternStats: {} };
  }
};

// --- Merge new outcomes into existing registry ---

const mergeOutcomes = (existing: OutcomeEntry[], fresh: OutcomeEntry[]): OutcomeEntry[] => {
  // Build a set of existing keys for dedup
  const keyOf = (o: OutcomeEntry): string => `${o.repo}#${o.prNumber}`;
  const existingKeys = new Set(existing.map(keyOf));

  const merged = [...existing];

  for (const entry of fresh) {
    const key = keyOf(entry);
    if (existingKeys.has(key)) {
      // Update existing entry state (might have changed from open to merged/closed)
      const idx = merged.findIndex((e) => keyOf(e) === key);
      if (idx !== -1) {
        merged[idx] = entry;
      }
    } else {
      merged.push(entry);
    }
  }

  return merged;
};

// --- Calculate pattern stats from full history ---

const calculatePatternStats = (outcomes: OutcomeEntry[]): Record<string, PatternStat> => {
  const stats: Record<string, PatternStat> = {};

  for (const outcome of outcomes) {
    if (!stats[outcome.patternId]) {
      stats[outcome.patternId] = {
        total: 0,
        merged: 0,
        closed: 0,
        successRate: 0,
        autoMergeEligible: false,
      };
    }

    const stat = stats[outcome.patternId];
    stat.total++;

    if (outcome.state === 'merged') {
      stat.merged++;
    } else if (outcome.state === 'closed') {
      stat.closed++;
    }
    // 'open' PRs are counted in total but not in merged/closed
  }

  // Calculate success rates based on resolved PRs (merged + closed)
  for (const stat of Object.values(stats)) {
    const resolved = stat.merged + stat.closed;
    stat.successRate = resolved > 0 ? Math.round((stat.merged / resolved) * 1000) / 1000 : 0;
    stat.autoMergeEligible =
      stat.total >= MIN_PRS_FOR_ADJUSTMENT && stat.successRate >= PROMOTE_THRESHOLD;
  }

  return stats;
};

// --- Also incorporate data from pattern-scores.json (full audit) ---

const enrichWithAuditData = (
  stats: Record<string, PatternStat>,
  auditScores: PatternScoresFile | null
): Record<string, PatternStat> => {
  if (!auditScores) return stats;

  for (const [patternId, auditScore] of Object.entries(auditScores.patterns)) {
    if (!stats[patternId]) {
      // Pattern only exists in audit data, import it
      const resolved = auditScore.merged + auditScore.closed;
      stats[patternId] = {
        total: auditScore.total,
        merged: auditScore.merged,
        closed: auditScore.closed,
        successRate: resolved > 0 ? Math.round((auditScore.merged / resolved) * 1000) / 1000 : 0,
        autoMergeEligible: false,
      };
    } else {
      // Merge: take the max of registry vs audit (audit has full history)
      const existing = stats[patternId];
      if (auditScore.total > existing.total) {
        existing.total = auditScore.total;
        existing.merged = auditScore.merged;
        existing.closed = auditScore.closed;
        const resolved = existing.merged + existing.closed;
        existing.successRate =
          resolved > 0 ? Math.round((existing.merged / resolved) * 1000) / 1000 : 0;
      }
    }
  }

  // Recalculate autoMergeEligible after enrichment
  for (const stat of Object.values(stats)) {
    stat.autoMergeEligible =
      stat.total >= MIN_PRS_FOR_ADJUSTMENT && stat.successRate >= PROMOTE_THRESHOLD;
  }

  return stats;
};

// --- Update pattern confidence in patterns.json ---

const updatePatternConfidence = (patternStats: Record<string, PatternStat>): number => {
  if (!existsSync(PATTERN_DB_PATH)) {
    console.log('  No patterns.json found, skipping confidence update');
    return 0;
  }

  let db: PatternDB;
  try {
    db = JSON.parse(readFileSync(PATTERN_DB_PATH, 'utf-8')) as PatternDB;
  } catch {
    console.warn('  Failed to parse patterns.json');
    return 0;
  }

  let updated = 0;

  for (const pattern of db.patterns) {
    const stat = patternStats[pattern.id];
    if (!stat || stat.total === 0) continue;

    const observedRate = stat.successRate;
    let newConfidence = pattern.confidence;

    if (stat.total >= MIN_PRS_FOR_ADJUSTMENT && observedRate >= PROMOTE_THRESHOLD) {
      // Promote: set confidence to observed rate
      newConfidence = observedRate;
      console.log(
        `  PROMOTE ${pattern.id}: ${pattern.confidence} -> ${newConfidence} (${stat.merged}/${stat.total}, ${(observedRate * 100).toFixed(1)}%)`
      );
    } else if (stat.total >= MIN_PRS_FOR_ADJUSTMENT && observedRate < DEGRADE_THRESHOLD) {
      // Degrade: set confidence to max(0.1, observedRate)
      newConfidence = Math.max(MIN_CONFIDENCE, observedRate);
      console.log(
        `  DEGRADE ${pattern.id}: ${pattern.confidence} -> ${newConfidence} (${stat.merged}/${stat.total}, ${(observedRate * 100).toFixed(1)}%)`
      );
    } else {
      // Not enough data or in the middle range: blend 30% existing + 70% observed
      const blended = Math.round((0.3 * pattern.confidence + 0.7 * observedRate) * 100) / 100;
      newConfidence = Math.max(MIN_CONFIDENCE, Math.min(0.99, blended));
      if (newConfidence !== pattern.confidence) {
        console.log(
          `  ADJUST ${pattern.id}: ${pattern.confidence} -> ${newConfidence} (blended, ${stat.merged}/${stat.total})`
        );
      }
    }

    // Clamp final value
    newConfidence = Math.max(MIN_CONFIDENCE, Math.min(0.99, newConfidence));

    if (newConfidence !== pattern.confidence) {
      pattern.confidence = newConfidence;
      updated++;
    }
  }

  if (updated > 0) {
    db.lastUpdated = new Date().toISOString();
    writeFileSync(PATTERN_DB_PATH, JSON.stringify(db, null, 2) + '\n');
    console.log(`\n  Updated ${updated} pattern confidence scores in patterns.json`);
  } else {
    console.log('\n  No confidence scores changed');
  }

  return updated;
};

// --- Main ---

const main = async (): Promise<void> => {
  console.log('=== DevOps Factory - Outcome Registry ===\n');

  // 1. Load existing registry and audit data
  const registry = loadRegistry();
  let auditScores: PatternScoresFile | null = null;

  if (existsSync(SCORES_PATH)) {
    try {
      auditScores = JSON.parse(readFileSync(SCORES_PATH, 'utf-8')) as PatternScoresFile;
      console.log(
        `Loaded audit data: ${auditScores.summary.totalPRs} PRs from pattern-scores.json`
      );
    } catch {
      console.warn('Failed to parse pattern-scores.json, continuing without audit data');
    }
  }

  // 2. Fetch recent PRs for self-healing repos
  const selfHealRepos = KNOWN_PROJECTS.filter((p) => p.hasSelfHealing).map((p) => p.repo);
  console.log(
    `\nScanning ${selfHealRepos.length} self-healing repos (last ${LOOKBACK_DAYS} days)...\n`
  );

  const freshOutcomes: OutcomeEntry[] = [];

  for (const repo of selfHealRepos) {
    process.stdout.write(`  ${repo}... `);
    const prs = fetchRecentPRs(repo);
    if (prs.length > 0) {
      console.log(`${prs.length} PRs`);
      freshOutcomes.push(...prs);
    } else {
      console.log('no recent PRs');
    }
  }

  console.log(`\nFresh outcomes: ${freshOutcomes.length} PRs from last ${LOOKBACK_DAYS} days`);

  // 3. Merge with existing registry
  const allOutcomes = mergeOutcomes(registry.outcomes, freshOutcomes);
  console.log(`Total outcomes in registry: ${allOutcomes.length}`);

  // 4. Calculate pattern stats from full history
  let patternStats = calculatePatternStats(allOutcomes);

  // 5. Enrich with audit data (for patterns not seen in recent window)
  patternStats = enrichWithAuditData(patternStats, auditScores);

  // 6. Save registry
  if (!existsSync('data')) {
    mkdirSync('data', { recursive: true });
  }

  const updatedRegistry: OutcomeRegistry = {
    lastUpdated: new Date().toISOString(),
    outcomes: allOutcomes,
    patternStats,
  };

  writeFileSync(REGISTRY_PATH, JSON.stringify(updatedRegistry, null, 2) + '\n');
  console.log(`\nRegistry saved to ${REGISTRY_PATH}`);

  // 7. Update confidence scores in patterns.json
  console.log('\nAdjusting confidence scores...');
  const updatedCount = updatePatternConfidence(patternStats);

  // 8. Print summary
  console.log('\n--- Pattern Stats ---');
  const sortedStats = Object.entries(patternStats).sort(([, a], [, b]) => b.total - a.total);
  for (const [id, stat] of sortedStats) {
    const eligibleMark = stat.autoMergeEligible ? ' [AUTO-MERGE]' : '';
    console.log(
      `  ${id.padEnd(35)} ${stat.merged}/${stat.total} merged (${(stat.successRate * 100).toFixed(1)}%)${eligibleMark}`
    );
  }

  // 9. Log activity
  const totalMerged = allOutcomes.filter((o) => o.state === 'merged').length;
  const totalClosed = allOutcomes.filter((o) => o.state === 'closed').length;
  const totalOpen = allOutcomes.filter((o) => o.state === 'open').length;

  logActivity(
    'scan-and-configure',
    'outcome-registry',
    `Registry updated: ${allOutcomes.length} outcomes (${totalMerged} merged, ${totalClosed} closed, ${totalOpen} open). ${freshOutcomes.length} new in last ${LOOKBACK_DAYS}d. ${updatedCount} confidence scores adjusted.`,
    'info'
  );

  console.log('\nDone.');
};

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
