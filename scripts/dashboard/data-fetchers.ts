import { sh, jq } from '../shell-utils.js';
import { KNOWN_PROJECTS } from '../../factory.config.js';
import { calculateSecurityScore, calculatePerfScore, calculateHealthScore } from './scoring.js';
import type { ScanReport, ProjectStatus, PRInfo } from './types.js';
import type { WorkflowRun } from '../types.js';

const MONITORING_WORKFLOWS = new Set([
  'Cron Monitor',
  'Stale Bot',
  'Label Sync',
  'Auto-Fix Prettier',
  'Auto Merge Dependencies',
]);

const hiddenRepos = new Set(KNOWN_PROJECTS.filter((p) => p.hidden).map((p) => p.repo));

export const getLatestWorkflowRun = (repo: string, branch: string): WorkflowRun | null => {
  const result = sh(
    `gh api "repos/${repo}/actions/runs?branch=${branch}&per_page=5" --jq ${jq('[.workflow_runs[] | {id, conclusion, name, html_url, created_at, head_branch}]')}`
  );
  if (!result || result === 'null') return null;
  try {
    const runs = JSON.parse(result) as WorkflowRun[];
    return runs.find((r) => !MONITORING_WORKFLOWS.has(r.name)) || runs[0] || null;
  } catch {
    return null;
  }
};

export const getOpenPRs = (repo: string): PRInfo[] => {
  const result = sh(
    `gh pr list --repo ${repo} --json number,title,state,url,author,labels,createdAt --jq ${jq('[.[] | {number, title, state, html_url: .url, user: {login: .author.login}, labels: [.labels[].name], created_at: .createdAt}]')}`
  );
  try {
    return JSON.parse(result || '[]') as PRInfo[];
  } catch {
    return [];
  }
};

export const getProjectIssues = (p: ProjectStatus): string[] => {
  const issues: string[] = [];
  if (p.ciStatus === 'fail') {
    issues.push(
      `CI failing${p.lastRun?.html_url ? ` <a href="${p.lastRun.html_url}" target="_blank">(view run)</a>` : ''}`
    );
  }
  if (p.aiFixPRs.length > 0) {
    for (const pr of p.aiFixPRs) {
      issues.push(
        `AI fix PR needs review: <a href="${pr.html_url}" target="_blank">#${pr.number} ${pr.title}</a>`
      );
    }
  }
  if (p.openPRs.length > 5) {
    issues.push(`${p.openPRs.length} open PRs (backlog growing)`);
  }
  if (p.renovatePRs.length > 0) {
    issues.push(`${p.renovatePRs.length} Renovate PR(s) to merge`);
  }
  return issues;
};

export const buildProjectStatuses = (report: ScanReport): ProjectStatus[] => {
  return report.analyses
    .filter((a) => a.stack !== 'unknown' && !hiddenRepos.has(a.fullName))
    .map((analysis) => {
      const lastRun = getLatestWorkflowRun(analysis.fullName, analysis.defaultBranch);
      const allPRs = getOpenPRs(analysis.fullName);
      const aiFixPRs = allPRs.filter((pr) => pr.labels.some((l) => l.name === 'ai-fix'));
      const renovatePRs = allPRs.filter((pr) => pr.labels.some((l) => l.name === 'dependencies'));

      const ciStatus: ProjectStatus['ciStatus'] = !analysis.hasCI
        ? 'none'
        : lastRun && lastRun.conclusion
          ? lastRun.conclusion === 'success'
            ? 'pass'
            : 'fail'
          : 'none';

      const configured = analysis.hasClaudeReview && analysis.hasSelfHealing;

      const status: ProjectStatus = {
        name: analysis.name,
        fullName: analysis.fullName,
        stack: analysis.stack,
        ciStatus,
        lastRun,
        openPRs: allPRs,
        aiFixPRs,
        renovatePRs,
        healthScore: 0,
        configured,
        hasGitleaks: analysis.hasGitleaks ?? false,
        hasRenovate: analysis.hasRenovate ?? false,
        hasHusky: analysis.hasHusky ?? false,
        hasCodeRabbit: analysis.hasCodeRabbit ?? false,
        hasLicenseCheck: analysis.hasLicenseCheck ?? false,
        hasSemgrep: analysis.hasSemgrep ?? false,
        hasSupplyChain: analysis.hasSupplyChainSecurity ?? false,
        securityScore: 0,
        hasPerformanceBudget: analysis.hasPerformanceBudget ?? false,
        hasAccessibilityCheck: analysis.hasAccessibilityCheck ?? false,
        hasLighthouse: analysis.hasLighthouse ?? false,
        hasTypedoc: analysis.hasTypedoc ?? false,
        hasCoverageTracking: analysis.hasCoverageTracking ?? false,
        perfScore: 0,
      };

      status.securityScore = calculateSecurityScore(status);
      status.perfScore = calculatePerfScore(status);
      status.healthScore = calculateHealthScore(status);
      return status;
    });
};
