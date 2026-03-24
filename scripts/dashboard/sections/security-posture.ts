import { renderProgressBar } from '../formatters.js';
import type { ProjectStatus } from '../types.js';

export const getSecurityPostureSection = (statuses: ProjectStatus[]): string => {
  const secAvg = Math.round(statuses.reduce((s, p) => s + p.securityScore, 0) / statuses.length);
  const secColor = secAvg >= 80 ? '#22c55e' : secAvg >= 50 ? '#f59e0b' : '#ef4444';
  const withGitleaks = statuses.filter((p) => p.hasGitleaks).length;
  const withSAST = statuses.filter((p) => p.hasSemgrep).length;
  const withSupply = statuses.filter((p) => p.hasSupplyChain).length;
  const withLicense = statuses.filter((p) => p.hasLicenseCheck).length;
  const withReview = statuses.filter((p) => p.hasCodeRabbit || p.configured).length;
  const total = statuses.length;

  return `
  <div class="security-posture">
    <h2>Security &amp; Review Posture</h2>
    <div class="security-grid">
      <div class="security-score-card" style="border-color:${secColor}">
        <div class="security-score-value" style="color:${secColor}">${secAvg}%</div>
        <div class="security-score-label">Avg Security Score</div>
      </div>
      <div class="security-metrics-card">
        <div class="security-metric"><span class="metric-label">Secret scanning</span>${renderProgressBar(withGitleaks, total)}</div>
        <div class="security-metric"><span class="metric-label">SAST (Semgrep)</span>${renderProgressBar(withSAST, total)}</div>
        <div class="security-metric"><span class="metric-label">Supply chain</span>${renderProgressBar(withSupply, total)}</div>
        <div class="security-metric"><span class="metric-label">License check</span>${renderProgressBar(withLicense, total)}</div>
        <div class="security-metric"><span class="metric-label">AI code review</span>${renderProgressBar(withReview, total)}</div>
      </div>
    </div>
  </div>`;
};
