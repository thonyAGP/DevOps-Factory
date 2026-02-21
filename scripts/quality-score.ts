/**
 * quality-score.ts
 *
 * Calculates composite quality scores (0-100) for monitored repos.
 * Evaluates CI health, coverage, code quality tooling, and security.
 *
 * Run: tsx scripts/quality-score.ts
 * Cron: Daily via GitHub Actions
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { KNOWN_PROJECTS, QUALITY_WEIGHTS, COVERAGE_THRESHOLDS } from '../factory.config.js';
import { logActivity } from './activity-logger.js';
import { jq, devNull } from './shell-utils.js';

interface WorkflowRun {
  id: number;
  conclusion: string;
}

interface CoverageRepoEntry {
  name: string;
  repo: string;
  stack: string;
  testFramework?: string;
  hasTests: boolean;
  testFileCount: number;
  coverage?: { lines: number; branches: number; functions: number; statements: number };
  status: string;
}

interface CoverageEntry {
  date: string;
  repos: CoverageRepoEntry[];
}

interface CoverageHistory {
  version: number;
  lastUpdated: string | null;
  entries: CoverageEntry[];
}

interface ScoreBreakdown {
  ciPasses: number;
  coverageAboveThreshold: number;
  prettierClean: number;
  eslintZeroWarnings: number;
  branchProtection: number;
  depsUpToDate: number;
  noSecrets: number;
}

interface RepoQualityScore {
  name: string;
  repo: string;
  score: number;
  breakdown: ScoreBreakdown;
}

interface QualityHistoryEntry {
  date: string;
  repos: RepoQualityScore[];
}

interface QualityHistory {
  version: number;
  lastUpdated: string;
  entries: QualityHistoryEntry[];
}

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
};

const checkCI = (repo: string, branch: string): boolean => {
  const result = sh(
    `gh api "repos/${repo}/actions/runs?branch=${branch}&per_page=1" --jq ${jq('.workflow_runs[0] | {conclusion}')}`
  );
  if (!result || result === 'null') return false;
  try {
    const run = JSON.parse(result) as WorkflowRun;
    return run.conclusion === 'success';
  } catch {
    return false;
  }
};

const getCoverage = (repoName: string): number => {
  const coveragePath = 'data/coverage-history.json';
  if (!existsSync(coveragePath)) return 0;

  try {
    const history = JSON.parse(readFileSync(coveragePath, 'utf-8')) as CoverageHistory;
    if (!history.entries.length) return 0;
    const latest = history.entries[history.entries.length - 1];
    const repoEntry = latest.repos.find((r) => r.name === repoName);
    return repoEntry?.coverage?.lines ?? 0;
  } catch {
    return 0;
  }
};

const checkConfigExists = (repo: string, filePath: string): boolean => {
  const result = sh(
    `gh api "repos/${repo}/contents/${filePath}" --jq ${jq('.size')} 2>${devNull} || echo "0"`
  );
  return result !== '' && result !== '0' && result !== 'null';
};

const checkBranchProtection = (repo: string, branch: string): boolean => {
  const result = sh(
    `gh api "repos/${repo}/branches/${branch}/protection" --jq ${jq('.enabled')} 2>${devNull} || echo "false"`
  );
  return result === 'true';
};

const checkGitleaksWorkflow = (repo: string): boolean => {
  const result = sh(
    `gh api "repos/${repo}/contents/.github/workflows" --jq ${jq('.[] | select(.name == "gitleaks.yml") | .name')} 2>${devNull} || echo ""`
  );
  return result.includes('gitleaks');
};

const calculateScore = (checks: Partial<ScoreBreakdown>): ScoreBreakdown => {
  return {
    ciPasses: checks.ciPasses ?? 0,
    coverageAboveThreshold: checks.coverageAboveThreshold ?? 0,
    prettierClean: checks.prettierClean ?? 0,
    eslintZeroWarnings: checks.eslintZeroWarnings ?? 0,
    branchProtection: checks.branchProtection ?? 0,
    depsUpToDate: checks.depsUpToDate ?? 0,
    noSecrets: checks.noSecrets ?? 0,
  };
};

const getTotalScore = (breakdown: ScoreBreakdown): number => {
  return Object.values(breakdown).reduce((sum, val) => sum + val, 0);
};

const evaluateRepo = (repo: (typeof KNOWN_PROJECTS)[0]): RepoQualityScore => {
  const breakdown: Partial<ScoreBreakdown> = {};

  // CI passes
  if (repo.hasCI) {
    const defaultBranch = sh(
      `gh api "repos/${repo.repo}" --jq ${jq('.default_branch')} 2>${devNull} || echo "main"`
    );
    if (checkCI(repo.repo, defaultBranch)) {
      breakdown.ciPasses = QUALITY_WEIGHTS.ciPasses;
    } else {
      breakdown.ciPasses = 0;
    }
  } else {
    breakdown.ciPasses = 0;
  }

  // Coverage above threshold
  const coverage = getCoverage(repo.name);
  if (coverage >= COVERAGE_THRESHOLDS.global) {
    breakdown.coverageAboveThreshold = QUALITY_WEIGHTS.coverageAboveThreshold;
  } else {
    breakdown.coverageAboveThreshold = 0;
  }

  // Prettier config exists
  if (
    checkConfigExists(repo.repo, '.prettierrc.json') ||
    checkConfigExists(repo.repo, '.prettierrc')
  ) {
    breakdown.prettierClean = QUALITY_WEIGHTS.prettierClean;
  } else {
    breakdown.prettierClean = 0;
  }

  // ESLint config exists
  const hasEslint =
    checkConfigExists(repo.repo, 'eslint.config.mjs') ||
    checkConfigExists(repo.repo, '.eslintrc.json') ||
    checkConfigExists(repo.repo, '.eslintrc.js') ||
    checkConfigExists(repo.repo, '.eslintrc.cjs');
  if (hasEslint) {
    breakdown.eslintZeroWarnings = QUALITY_WEIGHTS.eslintZeroWarnings;
  } else {
    breakdown.eslintZeroWarnings = 0;
  }

  // Branch protection
  const defaultBranch = sh(
    `gh api "repos/${repo.repo}" --jq ${jq('.default_branch')} 2>${devNull} || echo "main"`
  );
  if (checkBranchProtection(repo.repo, defaultBranch)) {
    breakdown.branchProtection = QUALITY_WEIGHTS.branchProtection;
  } else {
    breakdown.branchProtection = 0;
  }

  // Dependency management (renovate.json proxy)
  if (
    checkConfigExists(repo.repo, 'renovate.json') ||
    checkConfigExists(repo.repo, '.renovaterc')
  ) {
    breakdown.depsUpToDate = QUALITY_WEIGHTS.depsUpToDate;
  } else {
    breakdown.depsUpToDate = 0;
  }

  // Gitleaks (security scanning)
  if (checkGitleaksWorkflow(repo.repo)) {
    breakdown.noSecrets = QUALITY_WEIGHTS.noSecrets;
  } else {
    breakdown.noSecrets = 0;
  }

  const scoreBD = calculateScore(breakdown);
  const totalScore = getTotalScore(scoreBD);

  return {
    name: repo.name,
    repo: repo.repo,
    score: totalScore,
    breakdown: scoreBD,
  };
};

const updateQualityHistory = (scores: RepoQualityScore[]): void => {
  const historyPath = 'data/quality-history.json';
  let history: QualityHistory = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    entries: [],
  };

  if (existsSync(historyPath)) {
    try {
      history = JSON.parse(readFileSync(historyPath, 'utf-8')) as QualityHistory;
    } catch {
      history = { version: 1, lastUpdated: new Date().toISOString(), entries: [] };
    }
  }

  const today = new Date().toISOString().split('T')[0];
  const existingIdx = history.entries.findIndex((e) => e.date === today);

  const entry: QualityHistoryEntry = {
    date: today,
    repos: scores,
  };

  if (existingIdx >= 0) {
    history.entries[existingIdx] = entry;
  } else {
    history.entries.push(entry);
  }

  history.lastUpdated = new Date().toISOString();
  writeFileSync(historyPath, JSON.stringify(history, null, 2));
  console.log(`Quality history updated (${history.entries.length} entries)`);
};

const detectScoreDrops = (
  scores: RepoQualityScore[]
): Array<{ repo: string; drop: number; from: number; to: number }> => {
  const historyPath = 'data/quality-history.json';
  if (!existsSync(historyPath)) return [];

  try {
    const history = JSON.parse(readFileSync(historyPath, 'utf-8')) as QualityHistory;
    if (history.entries.length < 2) return [];

    const prev = history.entries[history.entries.length - 2];
    const drops: Array<{ repo: string; drop: number; from: number; to: number }> = [];

    for (const score of scores) {
      const prevScore = prev.repos.find((r) => r.repo === score.repo);
      if (prevScore && prevScore.score - score.score >= 5) {
        drops.push({
          repo: score.name,
          drop: prevScore.score - score.score,
          from: prevScore.score,
          to: score.score,
        });
      }
    }

    return drops;
  } catch {
    return [];
  }
};

const detectScoreImprovements = (
  scores: RepoQualityScore[]
): Array<{ repo: string; gain: number; from: number; to: number }> => {
  const historyPath = 'data/quality-history.json';
  if (!existsSync(historyPath)) return [];

  try {
    const history = JSON.parse(readFileSync(historyPath, 'utf-8')) as QualityHistory;
    if (history.entries.length < 2) return [];

    const prev = history.entries[history.entries.length - 2];
    const gains: Array<{ repo: string; gain: number; from: number; to: number }> = [];

    for (const score of scores) {
      const prevScore = prev.repos.find((r) => r.repo === score.repo);
      if (prevScore && score.score - prevScore.score >= 5) {
        gains.push({
          repo: score.name,
          gain: score.score - prevScore.score,
          from: prevScore.score,
          to: score.score,
        });
      }
    }

    return gains;
  } catch {
    return [];
  }
};

const generateReport = (
  scores: RepoQualityScore[],
  drops: Array<{ repo: string; drop: number; from: number; to: number }>
): string => {
  const today = new Date().toISOString().split('T')[0];
  const avgScore = Math.round(scores.reduce((sum, s) => sum + s.score, 0) / scores.length);
  const excellent = scores.filter((s) => s.score >= 80).length;
  const good = scores.filter((s) => s.score >= 60 && s.score < 80).length;
  const needsWork = scores.filter((s) => s.score < 60).length;

  let report = `## Quality Score Report - ${today}\n\n`;
  report += `### Summary\n`;
  report += `- **Average Score**: ${avgScore}/100\n`;
  report += `- **Excellent** (80+): ${excellent}\n`;
  report += `- **Good** (60-79): ${good}\n`;
  report += `- **Needs Work** (<60): ${needsWork}\n\n`;

  if (drops.length > 0) {
    report += `### Score Drops (≥5 points)\n`;
    for (const drop of drops) {
      report += `- **${drop.repo}**: ${drop.from} → ${drop.to} (-${drop.drop})\n`;
    }
    report += `\n`;
  }

  report += `### Per Repository\n\n`;
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  for (const s of sorted) {
    report += `#### ${s.name}\n`;
    report += `- **Score**: ${s.score}/100\n`;
    report += `- **CI Passes**: ${s.breakdown.ciPasses > 0 ? '✓' : '✗'}\n`;
    report += `- **Coverage**: ${s.breakdown.coverageAboveThreshold > 0 ? '✓' : '✗'}\n`;
    report += `- **Prettier**: ${s.breakdown.prettierClean > 0 ? '✓' : '✗'}\n`;
    report += `- **ESLint**: ${s.breakdown.eslintZeroWarnings > 0 ? '✓' : '✗'}\n`;
    report += `- **Branch Protection**: ${s.breakdown.branchProtection > 0 ? '✓' : '✗'}\n`;
    report += `- **Dependency Mgmt**: ${s.breakdown.depsUpToDate > 0 ? '✓' : '✗'}\n`;
    report += `- **Gitleaks**: ${s.breakdown.noSecrets > 0 ? '✓' : '✗'}\n\n`;
  }

  return report;
};

const main = (): void => {
  console.log('Evaluating code quality for all repos...\n');

  const knownRepos = KNOWN_PROJECTS.filter((r) => r.stack !== 'unknown');
  const scores: RepoQualityScore[] = [];

  for (const repo of knownRepos) {
    console.log(`Evaluating ${repo.name}...`);
    const score = evaluateRepo(repo);
    scores.push(score);
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  // Update history
  updateQualityHistory(scores);

  // Detect drops and improvements
  const drops = detectScoreDrops(scores);
  const improvements = detectScoreImprovements(scores);

  // Generate and save report
  const report = generateReport(scores, drops);
  writeFileSync('dashboard/quality-report.md', report);
  console.log('\nQuality report written to dashboard/quality-report.md');

  // Write JSON for dashboard consumption
  writeFileSync(
    'dashboard/quality-scores.json',
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        scores,
        drops,
      },
      null,
      2
    )
  );

  console.log(`\nQuality evaluation complete:`);
  console.log(`- ${scores.length} repos evaluated`);
  const avgScore = Math.round(scores.reduce((s, r) => s + r.score, 0) / scores.length);
  console.log(`- Average score: ${avgScore}/100`);
  if (drops.length > 0) {
    console.log(`- ${drops.length} score drop(s) detected`);
  }
  if (improvements.length > 0) {
    console.log(`- ${improvements.length} score improvement(s) detected`);
  }

  // Activity logging
  for (const drop of drops) {
    logActivity(
      'quality-score',
      'quality-drop',
      `${drop.from} → ${drop.to} (-${drop.drop}pts)`,
      'warning',
      drop.repo
    );
  }
  for (const imp of improvements) {
    logActivity(
      'quality-score',
      'quality-improved',
      `${imp.from} → ${imp.to} (+${imp.gain}pts)`,
      'success',
      imp.repo
    );
  }

  const excellent = scores.filter((s) => s.score >= 80).length;
  const needsWork = scores.filter((s) => s.score < 60).length;
  const summaryStatus = drops.length > 0 ? 'warning' : 'success';
  logActivity(
    'quality-score',
    'quality-complete',
    `Avg ${avgScore}/100, ${excellent} excellent, ${needsWork} needs work, ${drops.length} drops, ${improvements.length} improvements`,
    summaryStatus
  );
};

main();
