import { formatDashboardDate, getHealthColor } from './formatters.js';
import { DASHBOARD_CSS } from './styles.js';
import { DASHBOARD_SCRIPTS } from './client-scripts.js';
import {
  getFactoryStatusSection,
  getSecurityPostureSection,
  getPerformanceSection,
  getDoraSection,
  getCostSection,
  getComplianceSection,
  getRecommendationsSection,
  getMigrationSection,
  renderAlertCards,
  renderOkCards,
} from './sections/index.js';
import type { ProjectStatus } from './types.js';

export const generateHTML = (statuses: ProjectStatus[]): string => {
  const timestamp = formatDashboardDate(new Date());
  const avgHealth = Math.round(statuses.reduce((s, p) => s + p.healthScore, 0) / statuses.length);
  const failingCount = statuses.filter((p) => p.ciStatus === 'fail').length;
  const totalAIFixes = statuses.reduce((s, p) => s + p.aiFixPRs.length, 0);
  const avgSecurity = Math.round(
    statuses.reduce((s, p) => s + p.securityScore, 0) / statuses.length
  );
  const reviewCoverage = Math.round(
    (statuses.filter((p) => p.hasCodeRabbit || p.configured).length / statuses.length) * 100
  );
  const avgPerf = Math.round(statuses.reduce((s, p) => s + p.perfScore, 0) / statuses.length);

  const problemProjects = statuses
    .filter(
      (p) =>
        p.ciStatus === 'fail' ||
        p.aiFixPRs.length > 0 ||
        p.openPRs.length > 5 ||
        p.renovatePRs.length > 0
    )
    .sort((a, b) => a.healthScore - b.healthScore);

  const okProjects = statuses
    .filter((p) => !problemProjects.includes(p))
    .sort((a, b) => a.name.localeCompare(b.name));

  const alertCards = renderAlertCards(problemProjects);
  const okCards = renderOkCards(okProjects);

  const allClearBanner =
    problemProjects.length === 0
      ? `<div class="all-clear">All ${statuses.length} projects are healthy</div>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevOps Factory - Dashboard</title>
  <style>${DASHBOARD_CSS}</style>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
</head>
<body>
  <div class="header">
    <h1>DevOps Factory Dashboard</h1>
    <div class="timestamp">Last updated: ${timestamp}</div>
  </div>

  <div class="summary">
    <div class="summary-item">
      <div class="number">${statuses.length}</div>
      <div class="label">Projects</div>
    </div>
    <div class="summary-item">
      <div class="number" style="color: ${getHealthColor(avgHealth)}">${avgHealth}</div>
      <div class="label">Avg Health</div>
    </div>
    <div class="summary-item">
      <div class="number" style="color: ${failingCount > 0 ? '#ef4444' : '#22c55e'}">${failingCount}</div>
      <div class="label">Failing CI</div>
    </div>
    <div class="summary-item">
      <div class="number" style="color: ${totalAIFixes > 0 ? '#f59e0b' : '#22c55e'}">${totalAIFixes}</div>
      <div class="label">AI Fixes</div>
    </div>
    <div class="summary-item">
      <div class="number" style="color: ${avgSecurity >= 80 ? '#22c55e' : avgSecurity >= 50 ? '#f59e0b' : '#ef4444'}">${avgSecurity}%</div>
      <div class="label">Security</div>
    </div>
    <div class="summary-item">
      <div class="number" style="color: ${reviewCoverage >= 80 ? '#22c55e' : reviewCoverage >= 50 ? '#f59e0b' : '#ef4444'}">${reviewCoverage}%</div>
      <div class="label">Review Coverage</div>
    </div>
    <div class="summary-item">
      <div class="number" style="color: ${avgPerf >= 80 ? '#22c55e' : avgPerf >= 50 ? '#f59e0b' : '#ef4444'}">${avgPerf}%</div>
      <div class="label">Quality</div>
    </div>
  </div>

  ${getFactoryStatusSection()}

  ${getSecurityPostureSection(statuses)}

  ${getPerformanceSection(statuses)}

  ${getDoraSection()}

  ${getCostSection()}

  ${getComplianceSection()}

  ${getRecommendationsSection()}

  ${allClearBanner}

  ${
    problemProjects.length > 0
      ? `
  <div class="alerts">
    <div class="section-title alert">Needs Attention (${problemProjects.length})</div>
    ${alertCards}
  </div>`
      : ''
  }

  <div class="ok-section">
    <div class="section-title">Healthy (${okProjects.length})</div>
    <div class="ok-grid">
      ${okCards}
    </div>
  </div>

  <div class="trends">
    <h2>Health Trends (30 days)</h2>
    <canvas id="trendsChart"></canvas>
  </div>

  ${getMigrationSection()}

  <script>${DASHBOARD_SCRIPTS}</script>
</body>
</html>`;
};
