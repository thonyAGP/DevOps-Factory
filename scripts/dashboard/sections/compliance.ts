import { readFileSync, existsSync } from 'node:fs';

export const getComplianceSection = (): string => {
  const compPath = 'dashboard/compliance-report.json';
  if (!existsSync(compPath)) return '';

  try {
    const report = JSON.parse(readFileSync(compPath, 'utf-8')) as {
      period: string;
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
      repos: Array<{
        repo: string;
        score: number;
        branchProtection: boolean;
        codeReview: boolean;
        ciEnabled: boolean;
      }>;
    };

    const s = report.summary;
    const scoreColor =
      s.avgComplianceScore >= 70 ? '#22c55e' : s.avgComplianceScore >= 40 ? '#f59e0b' : '#ef4444';
    const reviewColor =
      s.reviewCoverage >= 70 ? '#22c55e' : s.reviewCoverage >= 40 ? '#f59e0b' : '#ef4444';

    const gaps: string[] = [];
    for (const r of report.repos) {
      if (!r.branchProtection) gaps.push(`${r.repo}: no branch protection`);
      if (!r.ciEnabled) gaps.push(`${r.repo}: no CI`);
      if (r.score < 40) gaps.push(`${r.repo}: compliance score ${r.score}/100`);
    }
    const gapsList =
      gaps.length > 0
        ? `<div class="compliance-gaps"><strong style="color:#8b949e">Compliance gaps:</strong><ul>${gaps
            .slice(0, 6)
            .map((g) => `<li>${g}</li>`)
            .join('')}</ul></div>`
        : '';

    return `
  <div class="compliance-section">
    <h2>Compliance &amp; Audit</h2>
    <div class="compliance-grid">
      <div class="compliance-card">
        <div class="compliance-value" style="color:${scoreColor}">${s.avgComplianceScore}</div>
        <div class="compliance-label">Avg Score /100</div>
      </div>
      <div class="compliance-card">
        <div class="compliance-value" style="color:#f59e0b">${s.totalPRsMerged}</div>
        <div class="compliance-label">PRs Merged (30d)</div>
      </div>
      <div class="compliance-card">
        <div class="compliance-value" style="color:${reviewColor}">${s.reviewCoverage}%</div>
        <div class="compliance-label">Review Coverage</div>
      </div>
      <div class="compliance-card">
        <div class="compliance-value" style="color:#a78bfa">${s.totalDeployments}</div>
        <div class="compliance-label">Deployments</div>
      </div>
      <div class="compliance-card">
        <div class="compliance-value" style="color:#22c55e">${s.reposWithBranchProtection}</div>
        <div class="compliance-label">Branch Protected</div>
      </div>
    </div>
    <div style="font-size:0.75rem;color:#8b949e;margin-bottom:0.4rem">
      Period: ${report.period} | ${s.reposWithCI}/${s.totalRepos} repos with CI
    </div>
    ${gapsList}
  </div>`;
  } catch {
    return '';
  }
};
