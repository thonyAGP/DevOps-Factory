import { renderProgressBar } from '../formatters.js';
import type { ProjectStatus } from '../types.js';

export const getPerformanceSection = (statuses: ProjectStatus[]): string => {
  const perfAvg = Math.round(statuses.reduce((s, p) => s + p.perfScore, 0) / statuses.length);
  const perfColor = perfAvg >= 80 ? '#22c55e' : perfAvg >= 50 ? '#f59e0b' : '#ef4444';
  const withLighthouse = statuses.filter((p) => p.hasLighthouse || p.hasPerformanceBudget).length;
  const withA11y = statuses.filter((p) => p.hasAccessibilityCheck).length;
  const withCoverage = statuses.filter((p) => p.hasCoverageTracking).length;
  const withDocs = statuses.filter((p) => p.hasTypedoc).length;
  const withRelease = 0;
  const total = statuses.length;

  return `
  <div class="performance-posture">
    <h2>Performance &amp; Quality</h2>
    <div class="security-grid">
      <div class="security-score-card" style="border-color:${perfColor}">
        <div class="security-score-value" style="color:${perfColor}">${perfAvg}%</div>
        <div class="security-score-label">Avg Quality Score</div>
      </div>
      <div class="security-metrics-card">
        <div class="security-metric"><span class="metric-label">Perf budgets</span>${renderProgressBar(withLighthouse, total)}</div>
        <div class="security-metric"><span class="metric-label">Accessibility</span>${renderProgressBar(withA11y, total)}</div>
        <div class="security-metric"><span class="metric-label">Coverage tracking</span>${renderProgressBar(withCoverage, total)}</div>
        <div class="security-metric"><span class="metric-label">Auto docs/changelog</span>${renderProgressBar(withDocs, total)}</div>
        <div class="security-metric"><span class="metric-label">Release mgmt</span>${renderProgressBar(withRelease, total)}</div>
      </div>
    </div>
  </div>`;
};
