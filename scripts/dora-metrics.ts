/**
 * dora-metrics.ts
 *
 * Calculates DORA (DevOps Research and Assessment) metrics across all repos:
 * - Deployment Frequency (releases per week)
 * - Lead Time for Changes (PR open → merge median)
 * - Mean Time to Recovery (CI fail → pass median)
 * - Change Failure Rate (% PRs that break CI)
 *
 * Outputs: dashboard/dora-metrics.json
 * Run: pnpm dora
 * Cron: weekly via GitHub Actions
 */

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { logActivity } from './activity-logger.js';

interface RepoDoraMetrics {
  repo: string;
  fullName: string;
  deploymentFrequency: number; // deploys per week (30-day avg)
  leadTimeHours: number; // median hours from PR open to merge
  mttrHours: number; // median hours from CI fail to recovery
  changeFailureRate: number; // % of deploys causing failure (0-100)
  rating: 'elite' | 'high' | 'medium' | 'low';
  prsMerged30d: number;
  releases30d: number;
}

interface DoraReport {
  timestamp: string;
  repos: RepoDoraMetrics[];
  summary: {
    totalRepos: number;
    avgDeployFreq: number;
    avgLeadTime: number;
    avgMTTR: number;
    avgChangeFailRate: number;
    overallRating: 'elite' | 'high' | 'medium' | 'low';
    eliteCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
  };
}

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30000 }).trim();
  } catch {
    return '';
  }
};

const median = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const getDeploymentFrequency = (repo: string): { freq: number; count: number } => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const result = sh(
    `gh api "repos/${repo}/releases?per_page=50" --jq "[.[] | select(.published_at > \\"${thirtyDaysAgo}\\") | .published_at] | length"`
  );
  const count = parseInt(result || '0', 10);

  // Also count tags if no releases
  if (count === 0) {
    const tagResult = sh(`gh api "repos/${repo}/tags?per_page=30" --jq "[.[] | .name] | length"`);
    const tagCount = Math.min(parseInt(tagResult || '0', 10), 10); // cap at 10 to avoid old tags
    return { freq: Math.round((tagCount / 30) * 7 * 10) / 10, count: tagCount };
  }

  return { freq: Math.round((count / 30) * 7 * 10) / 10, count };
};

const getLeadTime = (repo: string): { median: number; count: number } => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const result = sh(
    `gh pr list --repo ${repo} --state merged --json createdAt,mergedAt --jq "[.[] | select(.mergedAt > \\"${thirtyDaysAgo}\\") | {created: .createdAt, merged: .mergedAt}]"`
  );

  let prs: Array<{ created: string; merged: string }>;
  try {
    prs = JSON.parse(result || '[]');
  } catch {
    return { median: 0, count: 0 };
  }

  if (prs.length === 0) return { median: 0, count: 0 };

  const leadTimes = prs.map((pr) => {
    const created = new Date(pr.created).getTime();
    const merged = new Date(pr.merged).getTime();
    return (merged - created) / (1000 * 60 * 60); // hours
  });

  return { median: Math.round(median(leadTimes) * 10) / 10, count: prs.length };
};

const getMTTR = (repo: string): number => {
  // Get recent workflow runs to find fail→pass recovery times
  const result = sh(
    `gh api "repos/${repo}/actions/runs?per_page=50&status=completed" --jq "[.workflow_runs[] | {conclusion, created_at, name}]"`
  );

  let runs: Array<{ conclusion: string; created_at: string; name: string }>;
  try {
    runs = JSON.parse(result || '[]');
  } catch {
    return 0;
  }

  if (runs.length < 2) return 0;

  // Sort by time (newest first - API default)
  const recoveryTimes: number[] = [];

  for (let i = 0; i < runs.length - 1; i++) {
    // Current is success, previous (older) is failure = recovery
    if (runs[i].conclusion === 'success' && runs[i + 1].conclusion === 'failure') {
      const failTime = new Date(runs[i + 1].created_at).getTime();
      const recoverTime = new Date(runs[i].created_at).getTime();
      const hours = (recoverTime - failTime) / (1000 * 60 * 60);
      if (hours > 0 && hours < 168) {
        // Cap at 1 week (ignore outliers)
        recoveryTimes.push(hours);
      }
    }
  }

  return Math.round(median(recoveryTimes) * 10) / 10;
};

const getChangeFailureRate = (repo: string): number => {
  // Count workflow runs on default branch in last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const result = sh(
    `gh api "repos/${repo}/actions/runs?per_page=100&status=completed&created=>${thirtyDaysAgo}" --jq "[.workflow_runs[] | .conclusion] | {total: length, failures: [.[] | select(. == \\"failure\\")] | length}"`
  );

  let data: { total: number; failures: number };
  try {
    data = JSON.parse(result || '{"total":0,"failures":0}');
  } catch {
    return 0;
  }

  if (data.total === 0) return 0;
  return Math.round((data.failures / data.total) * 100);
};

// DORA ratings based on Google's "Accelerate" benchmarks
const rateRepo = (metrics: RepoDoraMetrics): RepoDoraMetrics['rating'] => {
  let score = 0;

  // Deployment frequency: elite=daily+, high=weekly, medium=monthly, low=<monthly
  if (metrics.deploymentFrequency >= 7) score += 4;
  else if (metrics.deploymentFrequency >= 1) score += 3;
  else if (metrics.deploymentFrequency >= 0.25) score += 2;
  else score += 1;

  // Lead time: elite=<1h, high=<24h, medium=<168h(1w), low=>168h
  if (metrics.leadTimeHours > 0 && metrics.leadTimeHours < 1) score += 4;
  else if (metrics.leadTimeHours < 24) score += 3;
  else if (metrics.leadTimeHours < 168) score += 2;
  else score += 1;

  // MTTR: elite=<1h, high=<24h, medium=<168h, low=>168h
  if (metrics.mttrHours > 0 && metrics.mttrHours < 1) score += 4;
  else if (metrics.mttrHours === 0 || metrics.mttrHours < 24) score += 3;
  else if (metrics.mttrHours < 168) score += 2;
  else score += 1;

  // Change failure rate: elite=<5%, high=<15%, medium=<30%, low=>30%
  if (metrics.changeFailureRate < 5) score += 4;
  else if (metrics.changeFailureRate < 15) score += 3;
  else if (metrics.changeFailureRate < 30) score += 2;
  else score += 1;

  const avg = score / 4;
  if (avg >= 3.5) return 'elite';
  if (avg >= 2.5) return 'high';
  if (avg >= 1.5) return 'medium';
  return 'low';
};

const main = () => {
  console.log('DORA Metrics Calculator\n');

  const reportPath = 'dashboard/scan-report.json';
  if (!existsSync(reportPath)) {
    console.log('No scan report found. Run scan first.');
    return;
  }

  const scanReport = JSON.parse(readFileSync(reportPath, 'utf-8')) as {
    analyses: Array<{ name: string; fullName: string; stack: string; hasCI: boolean }>;
  };

  const activeRepos = scanReport.analyses.filter((a) => a.stack !== 'unknown' && a.hasCI);
  const repos: RepoDoraMetrics[] = [];

  for (const repo of activeRepos) {
    console.log(`Analyzing: ${repo.name}...`);

    const deploy = getDeploymentFrequency(repo.fullName);
    const lead = getLeadTime(repo.fullName);
    const mttr = getMTTR(repo.fullName);
    const cfr = getChangeFailureRate(repo.fullName);

    const metrics: RepoDoraMetrics = {
      repo: repo.name,
      fullName: repo.fullName,
      deploymentFrequency: deploy.freq,
      leadTimeHours: lead.median,
      mttrHours: mttr,
      changeFailureRate: cfr,
      rating: 'low',
      prsMerged30d: lead.count,
      releases30d: deploy.count,
    };

    metrics.rating = rateRepo(metrics);
    repos.push(metrics);

    console.log(
      `  Deploy: ${deploy.freq}/wk | Lead: ${lead.median}h | MTTR: ${mttr}h | CFR: ${cfr}% → ${metrics.rating.toUpperCase()}`
    );
  }

  if (repos.length === 0) {
    console.log('No active repos with CI found.');
    return;
  }

  const avgDeployFreq =
    Math.round((repos.reduce((s, r) => s + r.deploymentFrequency, 0) / repos.length) * 10) / 10;
  const activeLeadTimes = repos.filter((r) => r.leadTimeHours > 0);
  const avgLeadTime =
    activeLeadTimes.length > 0
      ? Math.round(
          (activeLeadTimes.reduce((s, r) => s + r.leadTimeHours, 0) / activeLeadTimes.length) * 10
        ) / 10
      : 0;
  const activeMTTR = repos.filter((r) => r.mttrHours > 0);
  const avgMTTR =
    activeMTTR.length > 0
      ? Math.round((activeMTTR.reduce((s, r) => s + r.mttrHours, 0) / activeMTTR.length) * 10) / 10
      : 0;
  const avgCFR = Math.round(repos.reduce((s, r) => s + r.changeFailureRate, 0) / repos.length);

  const eliteCount = repos.filter((r) => r.rating === 'elite').length;
  const highCount = repos.filter((r) => r.rating === 'high').length;
  const mediumCount = repos.filter((r) => r.rating === 'medium').length;
  const lowCount = repos.filter((r) => r.rating === 'low').length;

  // Determine overall rating
  const ratingScore =
    (eliteCount * 4 + highCount * 3 + mediumCount * 2 + lowCount * 1) / repos.length;
  const overallRating: DoraReport['summary']['overallRating'] =
    ratingScore >= 3.5
      ? 'elite'
      : ratingScore >= 2.5
        ? 'high'
        : ratingScore >= 1.5
          ? 'medium'
          : 'low';

  const report: DoraReport = {
    timestamp: new Date().toISOString(),
    repos,
    summary: {
      totalRepos: repos.length,
      avgDeployFreq,
      avgLeadTime,
      avgMTTR,
      avgChangeFailRate: avgCFR,
      overallRating,
      eliteCount,
      highCount,
      mediumCount,
      lowCount,
    },
  };

  writeFileSync('dashboard/dora-metrics.json', JSON.stringify(report, null, 2));

  console.log('\nDORA Metrics Report saved.');
  console.log(`  Overall: ${overallRating.toUpperCase()}`);
  console.log(`  Deploy freq: ${avgDeployFreq}/week`);
  console.log(`  Lead time: ${avgLeadTime}h`);
  console.log(`  MTTR: ${avgMTTR}h`);
  console.log(`  Change failure rate: ${avgCFR}%`);
  console.log(
    `  Ratings: ${eliteCount} elite, ${highCount} high, ${mediumCount} medium, ${lowCount} low`
  );

  logActivity(
    'build-dashboard',
    'dora-metrics',
    `DORA: ${overallRating}, deploy ${avgDeployFreq}/wk, lead ${avgLeadTime}h, MTTR ${avgMTTR}h`,
    overallRating === 'low' ? 'warning' : 'success'
  );
};

main();
