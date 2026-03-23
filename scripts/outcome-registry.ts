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
import { notify } from './notify.js';
import { indexFix, cleanupDegradedPatterns } from './knowledge-graph.js';

// --- Types ---

type CloseReason =
  | 'merged' // Successfully merged
  | 'healing_verified' // Merged AND CI confirmed green after merge
  | 'healing_failed' // Merged BUT CI still red after merge (bad fix)
  | 'reverted' // Merged then reverted (detected via revert commits)
  | 'rejected' // Closed with fix-rejected label (explicit negative)
  | 'superseded' // Closed because a newer fix PR replaced it
  | 'manual_close' // Closed without label (neutral)
  | 'open' // Still open
  | 'unknown'; // Legacy entries without closeReason

interface OutcomeEntry {
  repo: string;
  prNumber: number;
  patternId: string;
  state: 'merged' | 'closed' | 'open';
  rejected: boolean; // true if label `fix-rejected` was applied (strong negative signal)
  closeReason: CloseReason;
  createdAt: string;
  closedAt: string | null;
  mergedAt: string | null;
}

interface PatternStat {
  total: number;
  merged: number;
  closed: number;
  rejected: number; // PRs explicitly marked fix-rejected (strong negative signal)
  healingFailed: number; // PRs merged but CI still red after (bad fix)
  reverted: number; // PRs merged then reverted
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
const FACTORY_CONFIG_PATH = 'factory.config.ts';
const LOOKBACK_DAYS = 7;

// Promotion/demotion thresholds
const MIN_PRS_FOR_ADJUSTMENT = 5;
const PROMOTE_THRESHOLD = 0.85;
const DEGRADE_THRESHOLD = 0.3;
const MIN_CONFIDENCE = 0.1;

// Repo state promotion thresholds
const MIN_MERGED_FOR_GRADUATION = 3; // 3+ merged PRs to graduate
const MIN_SUCCESS_RATE_FOR_GRADUATION = 0.7; // 70%+ success rate

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

// --- Close reason inference ---

const inferCloseReason = (
  state: OutcomeEntry['state'],
  labels: string[],
  isMerged: boolean
): CloseReason => {
  if (state === 'open') return 'open';
  if (isMerged) return 'merged'; // May be upgraded to healing_verified/healing_failed/reverted later
  if (labels.includes('fix-rejected')) return 'rejected';
  return 'manual_close';
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
        rejected: labels.includes('fix-rejected'),
        closeReason: inferCloseReason(prState, labels, isMerged),
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
        rejected: labels.includes('fix-rejected'),
        closeReason: inferCloseReason(prState, labels, isMerged),
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
        rejected: 0,
        healingFailed: 0,
        reverted: 0,
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

    if (outcome.rejected) {
      stat.rejected++;
    }
    if (outcome.closeReason === 'healing_failed') {
      stat.healingFailed++;
    }
    if (outcome.closeReason === 'reverted') {
      stat.reverted++;
    }
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
        rejected: 0,
        healingFailed: 0,
        reverted: 0,
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

const updatePatternConfidence = (
  patternStats: Record<string, PatternStat>
): { updated: number; degradedIds: string[] } => {
  if (!existsSync(PATTERN_DB_PATH)) {
    console.log('  No patterns.json found, skipping confidence update');
    return { updated: 0, degradedIds: [] };
  }

  let db: PatternDB;
  try {
    db = JSON.parse(readFileSync(PATTERN_DB_PATH, 'utf-8')) as PatternDB;
  } catch {
    console.warn('  Failed to parse patterns.json');
    return { updated: 0, degradedIds: [] };
  }

  let updated = 0;
  const degradedIds: string[] = [];

  for (const pattern of db.patterns) {
    const stat = patternStats[pattern.id];
    if (!stat || stat.total === 0) continue;

    const observedRate = stat.successRate;
    let newConfidence = pattern.confidence;

    // Strong penalties for negative signals (rejected, reverted, healing_failed)
    const negativeCount = stat.rejected + stat.reverted;
    const healFailCount = stat.healingFailed;
    if (negativeCount > 0 || healFailCount > 0) {
      const rejectionPenalty = negativeCount * 0.15; // -15% per rejection/revert
      const healFailPenalty = healFailCount * 0.1; // -10% per healing failure
      const totalPenalty = rejectionPenalty + healFailPenalty;
      newConfidence = Math.max(MIN_CONFIDENCE, pattern.confidence - totalPenalty);
      const reasons: string[] = [];
      if (stat.rejected > 0) reasons.push(`${stat.rejected} rejected`);
      if (stat.reverted > 0) reasons.push(`${stat.reverted} reverted`);
      if (healFailCount > 0) reasons.push(`${healFailCount} heal-failed`);
      console.log(
        `  PENALTY ${pattern.id}: ${pattern.confidence} -> ${newConfidence} (${reasons.join(', ')}, -${(totalPenalty * 100).toFixed(0)}%)`
      );
      newConfidence = Math.max(MIN_CONFIDENCE, Math.min(0.99, newConfidence));
      if (newConfidence !== pattern.confidence) {
        pattern.confidence = newConfidence;
        updated++;
      }
      continue;
    }

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
      notify('pattern_degraded', {
        patternId: pattern.id,
        confidence: newConfidence,
        message: `${stat.merged}/${stat.total} merged (${(observedRate * 100).toFixed(1)}%)`,
      });
      if (newConfidence < 0.3) degradedIds.push(pattern.id);
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

  return { updated, degradedIds };
};

// --- Revert detection: check if merged PRs were reverted ---

/**
 * Scan recent commits on the default branch for "Revert" commits that reference
 * a merged healing PR. If found, mark the outcome as 'reverted'.
 */
const detectReverts = (outcomes: OutcomeEntry[]): number => {
  const mergedOutcomes = outcomes.filter(
    (o) => o.state === 'merged' && o.closeReason !== 'reverted'
  );
  if (mergedOutcomes.length === 0) return 0;

  // Group by repo for efficient API calls
  const byRepo = new Map<string, OutcomeEntry[]>();
  for (const o of mergedOutcomes) {
    const list = byRepo.get(o.repo) || [];
    list.push(o);
    byRepo.set(o.repo, list);
  }

  let reverted = 0;

  for (const [repo, entries] of byRepo) {
    // Fetch recent commits looking for "Revert" in the message
    const raw = sh(
      `gh api repos/${repo}/commits?per_page=50 --jq '.[].commit.message' 2>${devNull}`,
      30_000
    );
    if (!raw) continue;

    const commitMessages = raw.split('\n');
    const revertMessages = commitMessages.filter((m) => /^revert/i.test(m.trim()));

    for (const entry of entries) {
      // Check if any revert commit mentions this PR number
      const prRef = `#${entry.prNumber}`;
      const isReverted = revertMessages.some((m) => m.includes(prRef));

      if (isReverted) {
        entry.closeReason = 'reverted';
        entry.rejected = true; // Treat reverts as strong negative signal
        console.log(`  [REVERT] ${repo} PR #${entry.prNumber} was reverted`);
        reverted++;
      }
    }
  }

  return reverted;
};

// --- Healing verification: check CI after merge ---

const HEALING_VERIFICATION_HOURS = 48;

/**
 * For recently merged healing PRs (< 48h), check if the repo CI is currently passing.
 * If CI is red after merge → healing_failed (negative signal).
 * If CI is green → healing_verified (positive signal).
 */
const verifyHealingOutcomes = (outcomes: OutcomeEntry[]): { verified: number; failed: number } => {
  const now = Date.now();
  const windowMs = HEALING_VERIFICATION_HOURS * 60 * 60 * 1000;

  const recentMerged = outcomes.filter((o) => {
    if (o.state !== 'merged') return false;
    if (o.closeReason === 'healing_verified' || o.closeReason === 'healing_failed') return false;
    if (o.closeReason === 'reverted') return false;
    if (!o.mergedAt) return false;
    const mergedTime = new Date(o.mergedAt).getTime();
    return now - mergedTime < windowMs;
  });

  if (recentMerged.length === 0) return { verified: 0, failed: 0 };

  // Group by repo — one CI check per repo
  const byRepo = new Map<string, OutcomeEntry[]>();
  for (const o of recentMerged) {
    const list = byRepo.get(o.repo) || [];
    list.push(o);
    byRepo.set(o.repo, list);
  }

  let verified = 0;
  let failed = 0;

  for (const [repo, entries] of byRepo) {
    // Get latest CI run status on default branch
    const raw = sh(
      `gh run list --repo ${repo} --branch master --limit 1 --json conclusion 2>${devNull}`
    );
    if (!raw) {
      // Try 'main' branch
      const rawMain = sh(
        `gh run list --repo ${repo} --branch main --limit 1 --json conclusion 2>${devNull}`
      );
      if (!rawMain) continue;
      try {
        const runs = JSON.parse(rawMain) as Array<{ conclusion: string }>;
        if (runs.length === 0) continue;
        const ciPassing = runs[0].conclusion === 'success';
        for (const entry of entries) {
          entry.closeReason = ciPassing ? 'healing_verified' : 'healing_failed';
          if (ciPassing) verified++;
          else failed++;
        }
      } catch {
        continue;
      }
      continue;
    }

    try {
      const runs = JSON.parse(raw) as Array<{ conclusion: string }>;
      if (runs.length === 0) continue;

      const ciPassing = runs[0].conclusion === 'success';

      for (const entry of entries) {
        entry.closeReason = ciPassing ? 'healing_verified' : 'healing_failed';
        if (ciPassing) {
          verified++;
          console.log(`  [VERIFIED] ${repo} PR #${entry.prNumber} — CI green after merge`);
          notify('healing_verified', {
            repo,
            prNumber: entry.prNumber,
            patternId: entry.patternId,
          });
          // Feed knowledge graph with verified fix
          if (entry.patternId) {
            const project = KNOWN_PROJECTS.find((p) => p.repo === repo);
            try {
              const diff = sh(`gh pr diff ${entry.prNumber} --repo ${repo} 2>${devNull}`);
              const filesRaw = sh(
                `gh pr view ${entry.prNumber} --repo ${repo} --json files --jq ".files[].path" 2>${devNull}`
              );
              indexFix({
                patternId: entry.patternId,
                stack: project?.stack ?? 'unknown',
                filePaths: filesRaw ? filesRaw.split('\n').filter(Boolean) : [],
                diff: diff.slice(0, 5000), // Cap diff size
                repo,
                prNumber: entry.prNumber,
                confidence: 0.9, // Verified fix = high confidence
              });
            } catch {
              /* KG indexing is best-effort */
            }
          }
        } else {
          failed++;
          console.log(`  [HEAL FAILED] ${repo} PR #${entry.prNumber} — CI still red after merge`);
          notify('healing_failed', { repo, prNumber: entry.prNumber, patternId: entry.patternId });
        }
      }
    } catch {
      continue;
    }
  }

  return { verified, failed };
};

// --- Auto-promote repos SUPERVISED → GRADUATED ---

interface RepoPromotion {
  repo: string;
  mergedCount: number;
  totalCount: number;
  successRate: number;
}

const promoteRepos = (outcomes: OutcomeEntry[]): RepoPromotion[] => {
  // Group outcomes by repo
  const repoOutcomes = new Map<string, OutcomeEntry[]>();
  for (const o of outcomes) {
    const existing = repoOutcomes.get(o.repo) || [];
    existing.push(o);
    repoOutcomes.set(o.repo, existing);
  }

  const promotions: RepoPromotion[] = [];

  // Check each self-healing repo in SUPERVISED state
  const supervisedRepos = KNOWN_PROJECTS.filter(
    (p) => p.hasSelfHealing && p.healingState === 'healing_supervised'
  );

  for (const project of supervisedRepos) {
    const entries = repoOutcomes.get(project.repo) || [];
    const resolved = entries.filter((e) => e.state === 'merged' || e.state === 'closed');
    const merged = entries.filter((e) => e.state === 'merged');

    if (merged.length < MIN_MERGED_FOR_GRADUATION) continue;

    const successRate = resolved.length > 0 ? merged.length / resolved.length : 0;
    if (successRate < MIN_SUCCESS_RATE_FOR_GRADUATION) continue;

    promotions.push({
      repo: project.repo,
      mergedCount: merged.length,
      totalCount: resolved.length,
      successRate,
    });
  }

  if (promotions.length === 0) {
    console.log('  No repos eligible for promotion');
    return promotions;
  }

  // Update factory.config.ts
  let configContent = readFileSync(FACTORY_CONFIG_PATH, 'utf-8');

  for (const promo of promotions) {
    console.log(
      `  PROMOTE ${promo.repo}: healing_supervised → healing_graduated (${promo.mergedCount}/${promo.totalCount} merged, ${(promo.successRate * 100).toFixed(0)}%)`
    );
    notify('repo_promoted', {
      repo: promo.repo,
      message: `Promoted to GRADUATED (${promo.mergedCount}/${promo.totalCount} merged, ${(promo.successRate * 100).toFixed(0)}% success)`,
    });

    // Replace healingState for this repo in factory.config.ts
    // Match the pattern: repo line followed eventually by healingState line
    const repoEscaped = promo.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `(repo:\\s*'${repoEscaped}'[\\s\\S]*?healingState:\\s*)'healing_supervised'`,
      'g'
    );
    configContent = configContent.replace(pattern, "$1'healing_graduated'");
  }

  writeFileSync(FACTORY_CONFIG_PATH, configContent);

  logActivity(
    'scan-and-configure',
    'repo-promotion',
    `Promoted ${promotions.length} repo(s) to healing_graduated: ${promotions.map((p) => p.repo).join(', ')}`,
    'info'
  );

  return promotions;
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

  // 3b. Backfill closeReason for legacy entries missing it
  for (const o of allOutcomes) {
    if (!o.closeReason) {
      if (o.state === 'open') o.closeReason = 'open';
      else if (o.state === 'merged') o.closeReason = 'merged';
      else if (o.rejected) o.closeReason = 'rejected';
      else o.closeReason = 'manual_close';
    }
  }

  // 3c. Detect reverts (merged PRs that were subsequently reverted)
  console.log('\nDetecting reverts...');
  const revertCount = detectReverts(allOutcomes);
  if (revertCount > 0) {
    console.log(`  ${revertCount} revert(s) detected`);
  } else {
    console.log('  No reverts detected');
  }

  // 3d. Healing verification (check CI after merge for recent PRs)
  console.log('\nVerifying healing outcomes...');
  const { verified, failed } = verifyHealingOutcomes(allOutcomes);
  console.log(`  ${verified} verified, ${failed} failed`);

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
  const { updated: updatedCount, degradedIds } = updatePatternConfidence(patternStats);
  cleanupDegradedPatterns(degradedIds);

  // 8. Print summary
  console.log('\n--- Pattern Stats ---');
  const sortedStats = Object.entries(patternStats).sort(([, a], [, b]) => b.total - a.total);
  for (const [id, stat] of sortedStats) {
    const eligibleMark = stat.autoMergeEligible ? ' [AUTO-MERGE]' : '';
    console.log(
      `  ${id.padEnd(35)} ${stat.merged}/${stat.total} merged (${(stat.successRate * 100).toFixed(1)}%)${eligibleMark}`
    );
  }

  // 9. Auto-promote repos: SUPERVISED → GRADUATED
  console.log('\nChecking repo state promotions...');
  const promotions = promoteRepos(allOutcomes);

  // 10. Log activity
  const totalMerged = allOutcomes.filter((o) => o.state === 'merged').length;
  const totalClosed = allOutcomes.filter((o) => o.state === 'closed').length;
  const totalOpen = allOutcomes.filter((o) => o.state === 'open').length;

  logActivity(
    'scan-and-configure',
    'outcome-registry',
    `Registry updated: ${allOutcomes.length} outcomes (${totalMerged} merged, ${totalClosed} closed, ${totalOpen} open). ${freshOutcomes.length} new in last ${LOOKBACK_DAYS}d. ${updatedCount} confidence scores adjusted. ${promotions.length} repo(s) promoted.`,
    'info'
  );

  console.log('\nDone.');
};

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
