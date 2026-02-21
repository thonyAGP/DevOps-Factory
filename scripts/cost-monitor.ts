/**
 * cost-monitor.ts
 *
 * Monitors GitHub Actions usage across all repos:
 * - Minutes consumed per repo (last 30 days)
 * - Most expensive workflows
 * - Optimization recommendations
 *
 * Outputs: dashboard/cost-report.json
 * Run: pnpm cost-monitor
 * Cron: weekly via GitHub Actions
 */

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { logActivity } from './activity-logger.js';

interface WorkflowUsage {
  name: string;
  runs: number;
  totalMinutes: number;
  avgMinutes: number;
  failedRuns: number;
  wastedMinutes: number; // minutes spent on failed runs
}

interface RepoUsage {
  repo: string;
  fullName: string;
  totalMinutes: number;
  totalRuns: number;
  workflows: WorkflowUsage[];
  recommendations: string[];
}

interface CostReport {
  timestamp: string;
  repos: RepoUsage[];
  summary: {
    totalMinutes: number;
    totalRuns: number;
    wastedMinutes: number;
    mostExpensiveRepo: string;
    mostExpensiveWorkflow: string;
    totalRecommendations: number;
    estimatedMonthlyCost: number; // USD based on GitHub pricing
  };
}

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30000 }).trim();
  } catch {
    return '';
  }
};

// GitHub Actions pricing: $0.008/min for Linux
const COST_PER_MINUTE = 0.008;
const FREE_MINUTES = 2000; // Free tier per month

const getWorkflowUsage = (repo: string): WorkflowUsage[] => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Get all completed runs in last 30 days
  const result = sh(
    `gh api "repos/${repo}/actions/runs?per_page=100&status=completed&created=>${thirtyDaysAgo}" --jq "[.workflow_runs[] | {name, conclusion, run_started_at, updated_at}]"`
  );

  let runs: Array<{
    name: string;
    conclusion: string;
    run_started_at: string;
    updated_at: string;
  }>;
  try {
    runs = JSON.parse(result || '[]');
  } catch {
    return [];
  }

  // Group by workflow name
  const byWorkflow = new Map<string, typeof runs>();
  for (const run of runs) {
    const existing = byWorkflow.get(run.name) ?? [];
    existing.push(run);
    byWorkflow.set(run.name, existing);
  }

  const workflows: WorkflowUsage[] = [];
  for (const [name, wfRuns] of byWorkflow) {
    let totalMinutes = 0;
    let wastedMinutes = 0;

    for (const run of wfRuns) {
      const start = new Date(run.run_started_at).getTime();
      const end = new Date(run.updated_at).getTime();
      const minutes = Math.max(1, Math.round((end - start) / 60000)); // minimum 1 min
      totalMinutes += minutes;
      if (run.conclusion === 'failure') {
        wastedMinutes += minutes;
      }
    }

    const failedRuns = wfRuns.filter((r) => r.conclusion === 'failure').length;

    workflows.push({
      name,
      runs: wfRuns.length,
      totalMinutes,
      avgMinutes: wfRuns.length > 0 ? Math.round(totalMinutes / wfRuns.length) : 0,
      failedRuns,
      wastedMinutes,
    });
  }

  return workflows.sort((a, b) => b.totalMinutes - a.totalMinutes);
};

const generateRecommendations = (workflows: WorkflowUsage[]): string[] => {
  const recs: string[] = [];

  for (const wf of workflows) {
    // High failure rate
    if (wf.runs > 5 && wf.failedRuns / wf.runs > 0.3) {
      recs.push(
        `${wf.name}: ${Math.round((wf.failedRuns / wf.runs) * 100)}% failure rate (${wf.wastedMinutes}min wasted). Fix root cause.`
      );
    }

    // Runs too frequently
    if (wf.runs > 120 && wf.avgMinutes > 2) {
      recs.push(
        `${wf.name}: ${wf.runs} runs in 30 days. Consider reducing trigger frequency or adding path filters.`
      );
    }

    // Long-running workflow
    if (wf.avgMinutes > 15) {
      recs.push(
        `${wf.name}: avg ${wf.avgMinutes}min/run. Consider caching, parallelization, or splitting.`
      );
    }

    // Redundant runs (same name, many runs with short interval)
    if (wf.runs > 60 && wf.avgMinutes < 2) {
      recs.push(
        `${wf.name}: ${wf.runs} very short runs. Consider concurrency groups or debouncing.`
      );
    }
  }

  return recs;
};

const main = () => {
  console.log('GitHub Actions Cost Monitor\n');

  const reportPath = 'dashboard/scan-report.json';
  if (!existsSync(reportPath)) {
    console.log('No scan report found. Run scan first.');
    return;
  }

  const scanReport = JSON.parse(readFileSync(reportPath, 'utf-8')) as {
    analyses: Array<{ name: string; fullName: string; stack: string }>;
  };

  const activeRepos = scanReport.analyses.filter((a) => a.stack !== 'unknown');
  const repos: RepoUsage[] = [];

  for (const repo of activeRepos) {
    console.log(`Analyzing: ${repo.name}...`);

    const workflows = getWorkflowUsage(repo.fullName);
    const totalMinutes = workflows.reduce((s, w) => s + w.totalMinutes, 0);
    const totalRuns = workflows.reduce((s, w) => s + w.runs, 0);
    const recommendations = generateRecommendations(workflows);

    repos.push({
      repo: repo.name,
      fullName: repo.fullName,
      totalMinutes,
      totalRuns,
      workflows,
      recommendations,
    });

    console.log(`  ${totalRuns} runs, ${totalMinutes} min, ${recommendations.length} rec(s)`);
  }

  const totalMinutes = repos.reduce((s, r) => s + r.totalMinutes, 0);
  const totalRuns = repos.reduce((s, r) => s + r.totalRuns, 0);
  const wastedMinutes = repos.reduce(
    (s, r) => s + r.workflows.reduce((ws, w) => ws + w.wastedMinutes, 0),
    0
  );
  const mostExpensiveRepo = repos.reduce((max, r) => (r.totalMinutes > max.totalMinutes ? r : max));
  const allWorkflows = repos.flatMap((r) => r.workflows.map((w) => ({ ...w, repo: r.repo })));
  const mostExpensiveWorkflow = allWorkflows.reduce(
    (max, w) => (w.totalMinutes > max.totalMinutes ? w : max),
    allWorkflows[0] ?? { name: 'none', repo: 'none', totalMinutes: 0 }
  );

  const billableMinutes = Math.max(0, totalMinutes - FREE_MINUTES);
  const estimatedCost = Math.round(billableMinutes * COST_PER_MINUTE * 100) / 100;

  const report: CostReport = {
    timestamp: new Date().toISOString(),
    repos: repos.sort((a, b) => b.totalMinutes - a.totalMinutes),
    summary: {
      totalMinutes,
      totalRuns,
      wastedMinutes,
      mostExpensiveRepo: mostExpensiveRepo?.repo ?? 'none',
      mostExpensiveWorkflow: mostExpensiveWorkflow
        ? `${mostExpensiveWorkflow.name} (${(mostExpensiveWorkflow as { repo: string }).repo})`
        : 'none',
      totalRecommendations: repos.reduce((s, r) => s + r.recommendations.length, 0),
      estimatedMonthlyCost: estimatedCost,
    },
  };

  writeFileSync('dashboard/cost-report.json', JSON.stringify(report, null, 2));

  console.log('\nCost Report saved.');
  console.log(`  Total: ${totalMinutes} min / ${totalRuns} runs`);
  console.log(`  Wasted (failed): ${wastedMinutes} min`);
  console.log(`  Free tier: ${FREE_MINUTES} min, billable: ${billableMinutes} min`);
  console.log(`  Est. cost: $${estimatedCost}/month`);
  console.log(
    `  Most expensive: ${mostExpensiveRepo?.repo} (${mostExpensiveRepo?.totalMinutes} min)`
  );

  logActivity(
    'build-dashboard',
    'cost-monitor',
    `CI cost: ${totalMinutes}min total, ${wastedMinutes}min wasted, ~$${estimatedCost}/mo`,
    wastedMinutes > totalMinutes * 0.2 ? 'warning' : 'success'
  );
};

main();
