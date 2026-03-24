/**
 * audit-pr-outcomes.ts
 *
 * Audits all PRs created by DevOps-Factory across the org to measure
 * self-healing effectiveness. Calculates success rates per CI pattern
 * and updates confidence scores in data/patterns.json.
 *
 * Run: pnpm audit-pr-outcomes
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { sh as _sh, devNull } from './shell-utils.js';
import { KNOWN_PROJECTS } from '../factory.config.js';
import { logActivity } from './activity-logger.js';
import type { PatternDB } from './types.js';

const sh = (cmd: string) => _sh(cmd, { timeout: 60_000 });

// --- Types ---

interface PRRecord {
  number: number;
  repo: string;
  title: string;
  state: string;
  merged: boolean;
  patternId: string | null;
  createdAt: string;
  closedAt: string | null;
}

interface PatternScore {
  total: number;
  merged: number;
  closed: number;
  successRate: number;
  repos: string[];
}

interface PatternScoresFile {
  timestamp: string;
  patterns: Record<string, PatternScore>;
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

// --- Config ---

const SCORES_PATH = 'data/pattern-scores.json';
const PATTERN_DB_PATH = 'data/patterns.json';

// --- Shell helper ---

// --- Pattern extraction ---

/**
 * Extract pattern ID from PR title or body.
 * Self-heal PRs use: `fix: CI fix [pattern:some-pattern-id]`
 * Also matches: `fix(ci):`, `fix:`, `style:`, `chore:` for other Factory PRs.
 */
const extractPatternId = (title: string, body: string): string | null => {
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

  // Generic  fix (no specific pattern)
  if (/ CI fix/i.test(title)) return '';

  return null;
};

/**
 * Determine if a PR was created by DevOps-Factory.
 * Checks: author name, body content, labels.
 */
const isFactoryPR = (author: string, body: string, labels: string[]): boolean => {
  if (labels.includes('ai-fix')) return true;
  if (/DevOps.Factory/i.test(body)) return true;
  if (/DevOps Factory Bot/i.test(author)) return true;
  if (/self-heal/i.test(body)) return true;
  return false;
};

// --- GitHub API ---

/**
 * Fetch all closed PRs for a repo that might be from DevOps-Factory.
 * Uses gh CLI search to find PRs with ai-fix label or DevOps-Factory in body.
 */
const fetchClosedPRs = (repo: string): PRRecord[] => {
  const records: PRRecord[] = [];

  // Strategy 1: PRs with ai-fix label (most reliable)
  const labelResult = sh(
    `gh pr list --repo ${repo} --state closed --label ai-fix --limit 100 --json number,title,state,body,mergedAt,createdAt,closedAt,author,labels 2>${devNull}`
  );

  if (labelResult) {
    try {
      const prs = JSON.parse(labelResult) as Array<{
        number: number;
        title: string;
        state: string;
        body: string;
        mergedAt: string | null;
        createdAt: string;
        closedAt: string | null;
        author: { login: string };
        labels: Array<{ name: string }>;
      }>;

      for (const pr of prs) {
        const labels = pr.labels.map((l) => l.name);
        const author = pr.author?.login ?? '';
        const body = pr.body ?? '';

        if (isFactoryPR(author, body, labels)) {
          records.push({
            number: pr.number,
            repo,
            title: pr.title,
            state: pr.state,
            merged: pr.mergedAt !== null && pr.mergedAt !== '',
            patternId: extractPatternId(pr.title, body),
            createdAt: pr.createdAt,
            closedAt: pr.closedAt,
          });
        }
      }
    } catch {
      console.warn(`  Failed to parse PR data for ${repo}`);
      logActivity('audit-pr-outcomes', 'error', `Failed to parse PR data for ${repo}`, 'error');
    }
  }

  // Strategy 2: Search PRs with "DevOps Factory" in title (catch unlabeled ones)
  const searchResult = sh(
    `gh pr list --repo ${repo} --state closed --search "DevOps Factory in:title,body" --limit 50 --json number,title,state,body,mergedAt,createdAt,closedAt,author,labels 2>${devNull}`
  );

  if (searchResult) {
    try {
      const prs = JSON.parse(searchResult) as Array<{
        number: number;
        title: string;
        state: string;
        body: string;
        mergedAt: string | null;
        createdAt: string;
        closedAt: string | null;
        author: { login: string };
        labels: Array<{ name: string }>;
      }>;

      const existingNumbers = new Set(records.map((r) => r.number));

      for (const pr of prs) {
        if (existingNumbers.has(pr.number)) continue;

        const labels = pr.labels.map((l) => l.name);
        const author = pr.author?.login ?? '';
        const body = pr.body ?? '';

        if (isFactoryPR(author, body, labels)) {
          records.push({
            number: pr.number,
            repo,
            title: pr.title,
            state: pr.state,
            merged: pr.mergedAt !== null && pr.mergedAt !== '',
            patternId: extractPatternId(pr.title, body),
            createdAt: pr.createdAt,
            closedAt: pr.closedAt,
          });
        }
      }
    } catch {
      // Ignore parse errors for search results
    }
  }

  return records;
};

// --- PR classification ---

/**
 * Determine if a PR is a scan-and-configure PR (tooling setup)
 * rather than a self-heal PR (CI fix).
 *
 * Config PRs: adding Renovate, Gitleaks, Semgrep, workflows, etc.
 * Self-heal PRs: fix CI failures, Prettier auto-fix, etc.
 */
const isConfigPR = (title: string): boolean => {
  // Explicit config patterns — tooling setup, not CI fixes
  const configPatterns = [
    /^chore:\s*add\s+/i, // "chore: add <tool>" — always config
    /^feat:\s*add\s+test\s+coverage/i, // "feat: add test coverage tracking"
  ];

  if (configPatterns.some((p) => p.test(title))) return true;

  return false;
};

// --- Score calculation ---

const calculateScores = (allPRs: PRRecord[]): PatternScoresFile => {
  // Separate config PRs from self-heal PRs
  const configPRs = allPRs.filter((pr) => isConfigPR(pr.title));
  const selfHealPRs = allPRs.filter((pr) => !isConfigPR(pr.title));

  const patterns: Record<string, PatternScore> = {};

  for (const pr of selfHealPRs) {
    const id = pr.patternId ?? 'unknown';

    if (!patterns[id]) {
      patterns[id] = { total: 0, merged: 0, closed: 0, successRate: 0, repos: [] };
    }

    const score = patterns[id];
    score.total++;
    if (pr.merged) {
      score.merged++;
    } else {
      score.closed++;
    }

    // Track unique repos
    const repoShort = pr.repo.split('/').pop() ?? pr.repo;
    if (!score.repos.includes(repoShort)) {
      score.repos.push(repoShort);
    }
  }

  // Calculate success rates
  for (const score of Object.values(patterns)) {
    score.successRate =
      score.total > 0 ? Math.round((score.merged / score.total) * 1000) / 1000 : 0;
  }

  const totalMerged = selfHealPRs.filter((pr) => pr.merged).length;
  const totalClosed = selfHealPRs.filter((pr) => !pr.merged).length;

  return {
    timestamp: new Date().toISOString(),
    patterns,
    summary: {
      totalPRs: selfHealPRs.length,
      merged: totalMerged,
      closed: totalClosed,
      overallSuccessRate:
        selfHealPRs.length > 0 ? Math.round((totalMerged / selfHealPRs.length) * 1000) / 1000 : 0,
      excluded: {
        configPRs: configPRs.length,
        titles: configPRs.map((pr) => pr.title),
      },
    },
  };
};

// --- Pattern DB update ---

const updatePatternConfidence = (scores: PatternScoresFile): number => {
  if (!existsSync(PATTERN_DB_PATH)) {
    console.log('  No patterns.json found, skipping confidence update');
    return 0;
  }

  let db: PatternDB;
  try {
    db = JSON.parse(readFileSync(PATTERN_DB_PATH, 'utf-8')) as PatternDB;
  } catch {
    console.warn('  Failed to parse patterns.json');
    logActivity('audit-pr-outcomes', 'error', 'Failed to parse patterns.json', 'error');
    return 0;
  }

  let updated = 0;

  for (const pattern of db.patterns) {
    const score = scores.patterns[pattern.id];
    if (!score || score.total === 0) continue;

    // Blend existing confidence with observed success rate
    // Weight: 30% existing + 70% observed (observed data is more reliable)
    const observedRate = score.successRate;
    const blended = Math.round((0.3 * pattern.confidence + 0.7 * observedRate) * 100) / 100;

    // Clamp between 0.1 and 0.99
    const newConfidence = Math.max(0.1, Math.min(0.99, blended));

    if (newConfidence !== pattern.confidence) {
      console.log(
        `  ${pattern.id}: confidence ${pattern.confidence} -> ${newConfidence} (observed: ${observedRate})`
      );
      logActivity(
        'audit-pr-outcomes',
        'scores-updated',
        `Pattern ${pattern.id}: confidence ${pattern.confidence} -> ${newConfidence} (observed: ${observedRate})`,
        'success'
      );
      pattern.confidence = newConfidence;
      updated++;
    }
  }

  if (updated > 0) {
    db.lastUpdated = new Date().toISOString();
    writeFileSync(PATTERN_DB_PATH, JSON.stringify(db, null, 2) + '\n');
    console.log(`  Updated ${updated} pattern confidence scores`);
  }

  return updated;
};

// --- Main ---

const main = async (): Promise<void> => {
  console.log('=== DevOps Factory - PR Outcome Audit ===\n');

  const repos = KNOWN_PROJECTS.map((p) => p.repo);
  const allPRs: PRRecord[] = [];

  console.log(`Scanning ${repos.length} repositories...\n`);

  for (const repo of repos) {
    process.stdout.write(`  ${repo}... `);
    const prs = fetchClosedPRs(repo);
    if (prs.length > 0) {
      console.log(`${prs.length} PRs found`);
      allPRs.push(...prs);
    } else {
      console.log('no Factory PRs');
    }
  }

  console.log(`\nTotal Factory PRs found: ${allPRs.length}`);

  if (allPRs.length === 0) {
    console.log('No PRs to analyze. Exiting.');
    return;
  }

  // Calculate scores
  const scores = calculateScores(allPRs);

  // Ensure data directory exists
  if (!existsSync('data')) {
    mkdirSync('data', { recursive: true });
  }

  // Write pattern-scores.json
  writeFileSync(SCORES_PATH, JSON.stringify(scores, null, 2) + '\n');
  console.log(`\nScores written to ${SCORES_PATH}`);

  // Update pattern confidence in patterns.json
  console.log('\nUpdating pattern confidence scores...');
  const updatedCount = updatePatternConfidence(scores);

  // Print summary
  console.log('\n--- Summary (self-heal PRs only) ---');
  console.log(`Total PRs:     ${scores.summary.totalPRs}`);
  console.log(`Merged:        ${scores.summary.merged}`);
  console.log(`Closed:        ${scores.summary.closed}`);
  console.log(`Success Rate:  ${(scores.summary.overallSuccessRate * 100).toFixed(1)}%`);
  if (scores.summary.excluded.configPRs > 0) {
    console.log(`\nExcluded config PRs: ${scores.summary.excluded.configPRs}`);
    for (const title of scores.summary.excluded.titles) {
      console.log(`  - ${title}`);
    }
  }

  console.log('\nBy pattern:');
  const sortedPatterns = Object.entries(scores.patterns).sort(([, a], [, b]) => b.total - a.total);
  for (const [id, score] of sortedPatterns) {
    console.log(
      `  ${id.padEnd(35)} ${score.merged}/${score.total} (${(score.successRate * 100).toFixed(0)}%) - repos: ${score.repos.join(', ')}`
    );
  }

  // Log activity
  logActivity(
    'audit-pr-outcomes',
    'audit-complete',
    `Audited ${scores.summary.totalPRs} self-heal PRs: ${scores.summary.merged} merged, ${scores.summary.closed} closed (${(scores.summary.overallSuccessRate * 100).toFixed(1)}% success). ${scores.summary.excluded.configPRs} config PRs excluded. ${updatedCount} confidence scores updated.`,
    'success'
  );

  console.log('\nDone.');
};

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
