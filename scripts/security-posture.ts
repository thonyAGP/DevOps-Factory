/**
 * security-posture.ts
 *
 * Aggregates security scan results across all repos.
 * Collects data from: gitleaks, supply-chain-security, container-scan,
 * security-headers, license-check, and semgrep workflow runs.
 *
 * Outputs: dashboard/security-posture.json
 * Run: pnpm security-posture
 * Cron: daily via dashboard-build.yml
 */

import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { logActivity } from './activity-logger.js';

interface SecurityWorkflowStatus {
  name: string;
  lastRun: string | null;
  conclusion: 'success' | 'failure' | 'skipped' | 'not_found';
  url: string | null;
}

interface RepoSecurityPosture {
  repo: string;
  fullName: string;
  workflows: {
    gitleaks: SecurityWorkflowStatus;
    supplyChain: SecurityWorkflowStatus;
    containerScan: SecurityWorkflowStatus;
    securityHeaders: SecurityWorkflowStatus;
    licenseCheck: SecurityWorkflowStatus;
    semgrep: SecurityWorkflowStatus;
  };
  score: number; // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  issues: string[];
}

interface SecurityPostureReport {
  timestamp: string;
  repos: RepoSecurityPosture[];
  summary: {
    avgScore: number;
    reposWithSecurityWorkflows: number;
    totalRepos: number;
    criticalIssues: number;
    gradeDistribution: Record<string, number>;
  };
}

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30000 }).trim();
  } catch {
    return '';
  }
};

const getWorkflowStatus = (repo: string, workflowNames: string[]): SecurityWorkflowStatus => {
  for (const name of workflowNames) {
    const result = sh(
      `gh api "repos/${repo}/actions/workflows" --jq ".workflows[] | select(.name == \\"${name}\\" or .path | endswith(\\"${name.toLowerCase().replace(/ /g, '-')}.yml\\")) | {id, name, state}" 2>/dev/null`
    );

    if (!result) continue;

    try {
      const workflow = JSON.parse(result) as { id: number; name: string };
      const runResult = sh(
        `gh api "repos/${repo}/actions/workflows/${workflow.id}/runs?per_page=1" --jq ".workflow_runs[0] | {conclusion, created_at, html_url}" 2>/dev/null`
      );

      if (runResult && runResult !== 'null') {
        const run = JSON.parse(runResult) as {
          conclusion: string;
          created_at: string;
          html_url: string;
        };
        return {
          name: workflow.name,
          lastRun: run.created_at,
          conclusion: (run.conclusion as SecurityWorkflowStatus['conclusion']) || 'skipped',
          url: run.html_url,
        };
      }

      return {
        name: workflow.name,
        lastRun: null,
        conclusion: 'skipped',
        url: null,
      };
    } catch {
      continue;
    }
  }

  return {
    name: workflowNames[0],
    lastRun: null,
    conclusion: 'not_found',
    url: null,
  };
};

const calculateSecurityScore = (
  workflows: RepoSecurityPosture['workflows']
): { score: number; issues: string[] } => {
  let score = 100;
  const issues: string[] = [];

  // Gitleaks (critical: -25 if missing, -15 if failing)
  if (workflows.gitleaks.conclusion === 'not_found') {
    score -= 25;
    issues.push('No secret scanning configured');
  } else if (workflows.gitleaks.conclusion === 'failure') {
    score -= 15;
    issues.push('Secret scanning detected issues');
  }

  // Supply chain (important: -20 if missing, -10 if failing)
  if (workflows.supplyChain.conclusion === 'not_found') {
    score -= 20;
    issues.push('No supply chain security scanning');
  } else if (workflows.supplyChain.conclusion === 'failure') {
    score -= 10;
    issues.push('Supply chain vulnerabilities detected');
  }

  // License check (moderate: -10 if missing, -5 if failing)
  if (workflows.licenseCheck.conclusion === 'not_found') {
    score -= 10;
    issues.push('No license compliance check');
  } else if (workflows.licenseCheck.conclusion === 'failure') {
    score -= 5;
    issues.push('License compliance issues');
  }

  // Semgrep SAST (moderate: -10 if missing)
  if (workflows.semgrep.conclusion === 'not_found') {
    score -= 10;
    issues.push('No SAST scanning configured');
  } else if (workflows.semgrep.conclusion === 'failure') {
    score -= 5;
    issues.push('SAST scanner found issues');
  }

  // Container scan (optional: -5 if missing when container exists)
  if (workflows.containerScan.conclusion === 'failure') {
    score -= 5;
    issues.push('Container vulnerabilities detected');
  }

  // Security headers (optional: -5 if failing)
  if (workflows.securityHeaders.conclusion === 'failure') {
    score -= 5;
    issues.push('Security headers misconfigured');
  }

  return { score: Math.max(0, score), issues };
};

const getGrade = (score: number): RepoSecurityPosture['grade'] => {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
};

const main = () => {
  console.log('Security Posture: Scanning repos...\n');

  const reportPath = 'dashboard/scan-report.json';
  if (!existsSync(reportPath)) {
    console.log('No scan report found. Run scan first.');
    return;
  }

  const scanReport = JSON.parse(readFileSync(reportPath, 'utf-8')) as {
    analyses: Array<{ name: string; fullName: string; stack: string }>;
  };

  const activeRepos = scanReport.analyses.filter((a) => a.stack !== 'unknown');
  const repos: RepoSecurityPosture[] = [];

  for (const repo of activeRepos) {
    console.log(`  Scanning: ${repo.name}...`);

    const workflows = {
      gitleaks: getWorkflowStatus(repo.fullName, ['Secret Scanning', 'gitleaks']),
      supplyChain: getWorkflowStatus(repo.fullName, [
        'Supply Chain Security',
        'supply-chain-security',
      ]),
      containerScan: getWorkflowStatus(repo.fullName, ['Container Scan', 'container-scan']),
      securityHeaders: getWorkflowStatus(repo.fullName, ['Security Headers', 'security-headers']),
      licenseCheck: getWorkflowStatus(repo.fullName, ['License Check', 'license-check']),
      semgrep: getWorkflowStatus(repo.fullName, ['Semgrep SAST', 'semgrep']),
    };

    const { score, issues } = calculateSecurityScore(workflows);
    const grade = getGrade(score);

    repos.push({
      repo: repo.name,
      fullName: repo.fullName,
      workflows,
      score,
      grade,
      issues,
    });

    console.log(`    Score: ${score}/100 (${grade}) - ${issues.length} issues`);
  }

  const gradeDistribution: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const r of repos) gradeDistribution[r.grade]++;

  const report: SecurityPostureReport = {
    timestamp: new Date().toISOString(),
    repos,
    summary: {
      avgScore: Math.round(repos.reduce((s, r) => s + r.score, 0) / repos.length),
      reposWithSecurityWorkflows: repos.filter((r) => r.score >= 60).length,
      totalRepos: repos.length,
      criticalIssues: repos.reduce(
        (s, r) =>
          s +
          r.issues.filter((i) => i.includes('secret') || i.includes('vulnerabilities detected'))
            .length,
        0
      ),
      gradeDistribution,
    },
  };

  writeFileSync('dashboard/security-posture.json', JSON.stringify(report, null, 2));
  console.log(`\nSecurity Posture Report saved.`);
  console.log(`  Average score: ${report.summary.avgScore}/100`);
  console.log(
    `  Repos with security: ${report.summary.reposWithSecurityWorkflows}/${report.summary.totalRepos}`
  );

  logActivity(
    'build-dashboard',
    'security-posture',
    `Avg score: ${report.summary.avgScore}/100, ${report.summary.criticalIssues} critical issues`,
    report.summary.criticalIssues > 0 ? 'warning' : 'success'
  );
};

main();
