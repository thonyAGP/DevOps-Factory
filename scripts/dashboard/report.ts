import { readFileSync, existsSync } from 'node:fs';
import type { ProjectStatus } from './types.js';

export const generateDailyReport = (statuses: ProjectStatus[]): string => {
  const failingProjects = statuses.filter((p) => p.ciStatus === 'fail');
  const pendingAIFixes = statuses.flatMap((p) => p.aiFixPRs.map((pr) => ({ project: p.name, pr })));
  const configuredCount = statuses.filter((p) => p.configured).length;

  const avgSecScore = Math.round(
    statuses.reduce((s, p) => s + p.securityScore, 0) / statuses.length
  );
  const reviewedCount = statuses.filter((p) => p.hasCodeRabbit || p.configured).length;

  let body = `## Summary\n`;
  body += `- **${statuses.length}** projects monitored\n`;
  body += `- **${configuredCount}/${statuses.length}** fully configured\n`;
  body += `- **${pendingAIFixes.length}** AI fix PR(s) pending merge\n`;
  body += `- **${failingProjects.length}** CI failure(s)\n`;
  body += `- **${avgSecScore}%** avg security score\n`;
  body += `- **${reviewedCount}/${statuses.length}** repos with AI code review\n`;
  const avgPerfReport = Math.round(statuses.reduce((s, p) => s + p.perfScore, 0) / statuses.length);
  body += `- **${avgPerfReport}%** avg quality score (perf, a11y, coverage, release)\n`;

  const doraPath = 'dashboard/dora-metrics.json';
  if (existsSync(doraPath)) {
    try {
      const dora = JSON.parse(readFileSync(doraPath, 'utf-8')) as {
        summary: {
          overallRating: string;
          avgDeployFreq: number;
          avgLeadTime: number;
          avgMTTR: number;
          avgChangeFailRate: number;
        };
      };
      const ds = dora.summary;
      body += `- **DORA**: ${ds.overallRating.toUpperCase()} (deploy ${ds.avgDeployFreq}/wk, lead ${ds.avgLeadTime}h, MTTR ${ds.avgMTTR}h, CFR ${ds.avgChangeFailRate}%)\n`;
    } catch {
      /* ignore */
    }
  }

  const costPath = 'dashboard/cost-report.json';
  if (existsSync(costPath)) {
    try {
      const cost = JSON.parse(readFileSync(costPath, 'utf-8')) as {
        summary: { totalMinutes: number; wastedMinutes: number; estimatedMonthlyCost: number };
      };
      const cs = cost.summary;
      body += `- **CI Cost**: ${cs.totalMinutes}min total, ${cs.wastedMinutes}min wasted, ~$${cs.estimatedMonthlyCost}/mo\n`;
    } catch {
      /* ignore */
    }
  }

  const compPath = 'dashboard/compliance-report.json';
  if (existsSync(compPath)) {
    try {
      const comp = JSON.parse(readFileSync(compPath, 'utf-8')) as {
        summary: {
          avgComplianceScore: number;
          reviewCoverage: number;
          totalPRsMerged: number;
          reposWithBranchProtection: number;
          totalRepos: number;
        };
      };
      const cs = comp.summary;
      body += `- **Compliance**: ${cs.avgComplianceScore}/100 avg, ${cs.reviewCoverage}% review coverage, ${cs.reposWithBranchProtection}/${cs.totalRepos} branch protected\n`;
    } catch {
      /* ignore */
    }
  }

  body += `\n`;
  body += `## Per Project\n\n`;

  for (const p of statuses.sort((a, b) => a.healthScore - b.healthScore)) {
    const icon =
      p.ciStatus === 'pass' ? 'white_check_mark' : p.ciStatus === 'fail' ? 'x' : 'white_circle';
    body += `### ${p.name} :${icon}:\n`;
    body += `- **Health**: ${p.healthScore}/100\n`;
    body += `- **CI**: ${p.ciStatus}`;
    if (p.lastRun) body += ` ([view](${p.lastRun.html_url}))`;
    body += `\n`;
    body += `- **Open PRs**: ${p.openPRs.length}\n`;

    if (p.aiFixPRs.length > 0) {
      body += `- **AI Fix PRs (needs merge)**:\n`;
      for (const pr of p.aiFixPRs) {
        body += `  - [#${pr.number} ${pr.title}](${pr.html_url})\n`;
      }
    }
    body += `\n`;
  }

  if (pendingAIFixes.length > 0) {
    body += `## Action Required\n\n`;
    body += `The following AI-generated PRs need your review:\n\n`;
    for (const { project, pr } of pendingAIFixes) {
      body += `- **${project}**: [#${pr.number} ${pr.title}](${pr.html_url})\n`;
    }
  }

  return body;
};
