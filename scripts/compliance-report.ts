/**
 * compliance-report.ts
 *
 * Generates compliance and audit report across all repos:
 * - Merged PRs and review coverage
 * - Branch protection status
 * - CI/CD pipeline status
 * - Security scanning setup
 * - Compliance score per repo
 *
 * Outputs:
 *  - dashboard/compliance-report.json (machine-readable)
 *  - dashboard/compliance-report.md (human-readable)
 * Run: pnpm compliance
 * Cron: weekly via GitHub Actions
 */

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logActivity } from './activity-logger.js';
import { jq, devNull } from './shell-utils.js';

interface MergedPR {
  number: number;
  title: string;
  author: string;
  mergedAt: string;
  reviewers: string[];
  labels: string[];
}

interface DeployEvent {
  repo: string;
  sha: string;
  branch: string;
  timestamp: string;
  workflow: string;
  status: string;
}

interface SecurityFinding {
  repo: string;
  type: string;
  severity: string;
  count: number;
  lastScan: string;
}

interface RepoCompliance {
  repo: string;
  fullName: string;
  mergedPRs: MergedPR[];
  deployments: DeployEvent[];
  securityFindings: SecurityFinding[];
  branchProtection: boolean;
  codeReview: boolean;
  ciEnabled: boolean;
  score: number;
}

interface ComplianceReport {
  timestamp: string;
  period: string;
  repos: RepoCompliance[];
  summary: {
    totalRepos: number;
    totalPRsMerged: number;
    prsWithReview: number;
    reviewCoverage: number;
    totalDeployments: number;
    avgComplianceScore: number;
    reposWithBranchProtection: number;
    reposWithCI: number;
  };
}

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30000 }).trim();
  } catch {
    return '';
  }
};

const ensureDir = (filePath: string): void => {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
};

const getMergedPRs = (repo: string): MergedPR[] => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const result = sh(
    `gh pr list --repo ${repo} --state merged --limit 50 --json number,title,author,mergedAt,labels --jq ${jq(`[.[] | select(.mergedAt > "${thirtyDaysAgo}") | {number: .number, title: .title, author: .author.login, mergedAt: .mergedAt, reviewers: [], labels: [.labels[].name]}]`)}`
  );

  let prs: MergedPR[];
  try {
    prs = JSON.parse(result || '[]');
  } catch {
    return [];
  }

  return prs;
};

const getDeployments = (repo: string): DeployEvent[] => {
  const result = sh(
    `gh run list --repo ${repo} --limit 50 --json headSha,headBranch,createdAt,name,conclusion --jq ${jq(`[.[] | select(.conclusion == "success") | {repo: "${repo}", sha: .headSha, branch: .headBranch, timestamp: .createdAt, workflow: .name, status: "success"}]`)}`
  );

  let deployments: DeployEvent[];
  try {
    deployments = JSON.parse(result || '[]');
  } catch {
    return [];
  }

  return deployments;
};

const hasCIWorkflows = (repo: string): boolean => {
  const result = sh(`gh run list --repo ${repo} --limit 1 --json conclusion --jq ${jq('length')}`);
  return parseInt(result || '0', 10) > 0;
};

const getSecurityFindings = (repo: string): SecurityFinding[] => {
  // Check if code scanning alerts exist
  const result = sh(
    `gh api repos/${repo}/code-scanning/alerts --jq "[.[] | {repo: \"${repo}\", type: .rule.id, severity: .rule.severity, count: 1, lastScan: .updated_at}]" 2>${devNull}`
  );

  let findings: Array<{
    repo: string;
    type: string;
    severity: string;
    count: number;
    lastScan: string;
  }>;
  try {
    findings = JSON.parse(result || '[]');
  } catch {
    return [];
  }

  // Aggregate by severity
  const bySeverity = new Map<string, SecurityFinding>();
  for (const finding of findings) {
    const key = `${finding.type}:${finding.severity}`;
    const existing = bySeverity.get(key);
    if (existing) {
      existing.count++;
    } else {
      bySeverity.set(key, {
        repo,
        type: finding.type,
        severity: finding.severity,
        count: 1,
        lastScan: finding.lastScan,
      });
    }
  }

  return Array.from(bySeverity.values());
};

const getBranchProtection = (repo: string): boolean => {
  // Try main first, then master
  let result = sh(`gh api repos/${repo}/branches/main/protection 2>${devNull}`);
  if (!result) {
    result = sh(`gh api repos/${repo}/branches/master/protection 2>${devNull}`);
  }
  return result.length > 0;
};

const getCodeReviewStatus = (repo: string): boolean => {
  const prs = getMergedPRs(repo);
  if (prs.length === 0) return false;
  const reviewed = prs.filter((pr) => pr.reviewers && pr.reviewers.length > 0);
  return reviewed.length > 0;
};

const calculateComplianceScore = (compliance: Omit<RepoCompliance, 'score'>): number => {
  let score = 0;

  // CI enabled: 20 points
  if (compliance.ciEnabled) score += 20;

  // Branch protection: 20 points
  if (compliance.branchProtection) score += 20;

  // Code review status: 20 points
  if (compliance.codeReview) score += 20;

  // Security scanning: 20 points
  if (compliance.securityFindings.length > 0) score += 20;

  // PR review coverage: 20 points
  if (compliance.mergedPRs.length > 0) {
    const reviewed = compliance.mergedPRs.filter((pr) => pr.reviewers && pr.reviewers.length > 0);
    const coverage =
      compliance.mergedPRs.length > 0 ? reviewed.length / compliance.mergedPRs.length : 0;
    if (coverage >= 0.5) score += 20;
  }

  return Math.min(100, score);
};

const main = () => {
  console.log('Compliance & Audit Report Generator\n');

  const reportPath = 'dashboard/scan-report.json';
  if (!existsSync(reportPath)) {
    console.log('No scan report found. Run scan first.');
    return;
  }

  const scanReport = JSON.parse(readFileSync(reportPath, 'utf-8')) as {
    analyses: Array<{ name: string; fullName: string; stack: string }>;
  };

  const activeRepos = scanReport.analyses.filter((a) => a.stack !== 'unknown');
  const repos: RepoCompliance[] = [];

  for (const repo of activeRepos) {
    console.log(`Analyzing: ${repo.name}...`);

    const mergedPRs = getMergedPRs(repo.fullName);
    const deployments = getDeployments(repo.fullName);
    const securityFindings = getSecurityFindings(repo.fullName);
    const branchProtection = getBranchProtection(repo.fullName);
    const codeReview = getCodeReviewStatus(repo.fullName);
    const ciEnabled = deployments.length > 0 || hasCIWorkflows(repo.fullName);

    const compliance: Omit<RepoCompliance, 'score'> = {
      repo: repo.name,
      fullName: repo.fullName,
      mergedPRs,
      deployments,
      securityFindings,
      branchProtection,
      codeReview,
      ciEnabled,
    };

    const score = calculateComplianceScore(compliance);

    repos.push({
      ...compliance,
      score,
    });

    const status = score >= 80 ? 'EXCELLENT' : score >= 60 ? 'GOOD' : score >= 40 ? 'FAIR' : 'POOR';
    console.log(
      `  Score: ${score}/100 (${status}) | PRs: ${mergedPRs.length} | Deployments: ${deployments.length} | Security: ${securityFindings.length} findings`
    );
  }

  if (repos.length === 0) {
    console.log('No active repos found.');
    return;
  }

  const totalPRsMerged = repos.reduce((s, r) => s + r.mergedPRs.length, 0);
  const prsWithReview = repos.reduce(
    (s, r) => s + r.mergedPRs.filter((pr) => pr.reviewers && pr.reviewers.length > 0).length,
    0
  );
  const reviewCoverage =
    totalPRsMerged > 0 ? Math.round((prsWithReview / totalPRsMerged) * 100) : 0;
  const totalDeployments = repos.reduce((s, r) => s + r.deployments.length, 0);
  const avgComplianceScore = Math.round(repos.reduce((s, r) => s + r.score, 0) / repos.length);
  const reposWithBranchProtection = repos.filter((r) => r.branchProtection).length;
  const reposWithCI = repos.filter((r) => r.ciEnabled).length;

  const report: ComplianceReport = {
    timestamp: new Date().toISOString(),
    period: '30-day window',
    repos: repos.sort((a, b) => b.score - a.score),
    summary: {
      totalRepos: repos.length,
      totalPRsMerged,
      prsWithReview,
      reviewCoverage,
      totalDeployments,
      avgComplianceScore,
      reposWithBranchProtection,
      reposWithCI,
    },
  };

  // Write JSON report
  ensureDir('dashboard/compliance-report.json');
  writeFileSync('dashboard/compliance-report.json', JSON.stringify(report, null, 2));

  // Generate markdown report
  const md = generateMarkdownReport(report);
  ensureDir('dashboard/compliance-report.md');
  writeFileSync('dashboard/compliance-report.md', md);

  console.log('\nCompliance Report saved.');
  console.log(`  Total repos: ${repos.length}`);
  console.log(`  Avg compliance score: ${avgComplianceScore}/100`);
  console.log(`  Branch protection: ${reposWithBranchProtection}/${repos.length}`);
  console.log(`  CI enabled: ${reposWithCI}/${repos.length}`);
  console.log(`  PR review coverage: ${reviewCoverage}%`);
  console.log(`  Total PRs merged: ${totalPRsMerged}`);
  console.log(`  Total deployments: ${totalDeployments}`);

  // Identify gaps
  const noProtection = repos.filter((r) => !r.branchProtection);
  const noCI = repos.filter((r) => !r.ciEnabled);
  const lowReview = repos.filter(
    (r) =>
      r.mergedPRs.length > 0 &&
      r.mergedPRs.filter((pr) => pr.reviewers && pr.reviewers.length > 0).length === 0
  );

  if (noProtection.length > 0) {
    console.log(`  ⚠️  No branch protection: ${noProtection.map((r) => r.repo).join(', ')}`);
  }
  if (noCI.length > 0) {
    console.log(`  ⚠️  No CI enabled: ${noCI.map((r) => r.repo).join(', ')}`);
  }
  if (lowReview.length > 0) {
    console.log(`  ⚠️  No code review: ${lowReview.map((r) => r.repo).join(', ')}`);
  }

  logActivity(
    'build-dashboard',
    'compliance-report',
    `Compliance: avg ${avgComplianceScore}/100, branch protection ${reposWithBranchProtection}/${repos.length}, CI ${reposWithCI}/${repos.length}, review coverage ${reviewCoverage}%`,
    avgComplianceScore >= 60 ? 'success' : 'warning'
  );
};

const generateMarkdownReport = (report: ComplianceReport): string => {
  const lines: string[] = [];

  lines.push('# Compliance & Audit Report\n');
  lines.push(`**Generated**: ${new Date(report.timestamp).toLocaleString()}`);
  lines.push(`**Period**: ${report.period}\n`);

  // Summary
  lines.push('## Summary\n');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Repos | ${report.summary.totalRepos} |`);
  lines.push(`| Avg Compliance Score | ${report.summary.avgComplianceScore}/100 |`);
  lines.push(
    `| Repos with Branch Protection | ${report.summary.reposWithBranchProtection}/${report.summary.totalRepos} |`
  );
  lines.push(`| Repos with CI | ${report.summary.reposWithCI}/${report.summary.totalRepos} |`);
  lines.push(`| PR Review Coverage | ${report.summary.reviewCoverage}% |`);
  lines.push(`| PRs Merged (30d) | ${report.summary.totalPRsMerged} |`);
  lines.push(`| Deployments (30d) | ${report.summary.totalDeployments} |`);
  lines.push(
    `| PRs with Review | ${report.summary.prsWithReview}/${report.summary.totalPRsMerged} |`
  );
  lines.push('');

  // Per-repo breakdown
  lines.push('## Repository Compliance\n');
  lines.push('| Repo | Score | Branch Prot | CI | Review | Security |');
  lines.push('|------|-------|-------------|----|------------|----------|');

  for (const repo of report.repos) {
    const scoreColor = repo.score >= 80 ? '🟢' : repo.score >= 60 ? '🟡' : '🔴';
    lines.push(
      `| ${repo.repo} | ${scoreColor} ${repo.score}/100 | ${repo.branchProtection ? '✓' : '✗'} | ${repo.ciEnabled ? '✓' : '✗'} | ${repo.codeReview ? '✓' : '✗'} | ${repo.securityFindings.length} |`
    );
  }
  lines.push('');

  // Gaps
  const noProtection = report.repos.filter((r) => !r.branchProtection);
  const noCI = report.repos.filter((r) => !r.ciEnabled);
  const lowScore = report.repos.filter((r) => r.score < 60);
  const noReview = report.repos.filter(
    (r) =>
      r.mergedPRs.length > 0 &&
      r.mergedPRs.filter((pr) => pr.reviewers && pr.reviewers.length > 0).length === 0
  );

  lines.push('## Compliance Gaps\n');

  if (noProtection.length > 0) {
    lines.push(`### ⚠️ No Branch Protection (${noProtection.length})`);
    lines.push(noProtection.map((r) => `- ${r.repo}`).join('\n'));
    lines.push('');
  }

  if (noCI.length > 0) {
    lines.push(`### ⚠️ No CI Pipeline (${noCI.length})`);
    lines.push(noCI.map((r) => `- ${r.repo}`).join('\n'));
    lines.push('');
  }

  if (noReview.length > 0) {
    lines.push(`### ⚠️ No Code Review (${noReview.length})`);
    for (const repo of noReview) {
      lines.push(`- **${repo.repo}**: ${repo.mergedPRs.length} PRs merged without review`);
    }
    lines.push('');
  }

  if (lowScore.length > 0) {
    lines.push(`### 🔴 Low Compliance Score < 60 (${lowScore.length})`);
    for (const repo of lowScore) {
      lines.push(`- ${repo.repo}: ${repo.score}/100`);
    }
    lines.push('');
  }

  // Recommendations
  lines.push('## Recommendations\n');
  lines.push('1. **Enable Branch Protection** on all repos to enforce code review');
  lines.push('2. **Setup CI/CD pipelines** for repos without automated testing');
  lines.push('3. **Require code reviews** before merge on default branches');
  lines.push('4. **Enable security scanning** (dependabot, code scanning)');
  lines.push('5. **Monitor review coverage** - target 100% reviewed PRs\n');

  // Detailed repo breakdown
  lines.push('## Detailed Repository Breakdown\n');

  for (const repo of report.repos) {
    const status =
      repo.score >= 80 ? '✓ EXCELLENT' : repo.score >= 60 ? '⚠️ GOOD' : '❌ NEEDS WORK';
    lines.push(`### ${repo.repo} | ${status} (${repo.score}/100)\n`);

    lines.push(`**Full Name**: \`${repo.fullName}\`\n`);

    lines.push('**Controls**:');
    lines.push(`- Branch Protection: ${repo.branchProtection ? '✓' : '✗'}`);
    lines.push(`- Code Review Required: ${repo.codeReview ? '✓' : '✗'}`);
    lines.push(`- CI/CD Enabled: ${repo.ciEnabled ? '✓' : '✗'}`);
    lines.push(`- Security Findings: ${repo.securityFindings.length} alerts\n`);

    if (repo.mergedPRs.length > 0) {
      const reviewed = repo.mergedPRs.filter((pr) => pr.reviewers && pr.reviewers.length > 0);
      lines.push(
        `**Review Coverage**: ${reviewed.length}/${repo.mergedPRs.length} PRs (${Math.round((reviewed.length / repo.mergedPRs.length) * 100)}%)\n`
      );

      if (reviewed.length < repo.mergedPRs.length) {
        lines.push('**PRs Without Review**:');
        for (const pr of repo.mergedPRs) {
          if (!pr.reviewers || pr.reviewers.length === 0) {
            lines.push(`- #${pr.number} - ${pr.title} (by ${pr.author})`);
          }
        }
        lines.push('');
      }
    }

    if (repo.deployments.length > 0) {
      lines.push(
        `**Recent Deployments**: ${repo.deployments.length} successful deploys in 30 days\n`
      );
    }

    if (repo.securityFindings.length > 0) {
      lines.push('**Security Alerts**:');
      for (const finding of repo.securityFindings) {
        lines.push(`- ${finding.type} (${finding.severity}): ${finding.count} issue(s)`);
      }
      lines.push('');
    }

    lines.push('---\n');
  }

  return lines.join('\n');
};

main();
