import { getStatusEmoji, getHealthColor } from '../formatters.js';
import { getProjectIssues } from '../data-fetchers.js';
import type { ProjectStatus } from '../types.js';

export const renderAlertCards = (problemProjects: ProjectStatus[]): string => {
  return problemProjects
    .map((p) => {
      const issues = getProjectIssues(p);
      const borderColor = p.ciStatus === 'fail' ? '#ef4444' : '#f59e0b';
      return `
    <div class="alert-card" style="border-left-color: ${borderColor}">
      <div class="alert-header">
        <div>
          <span class="status-icon">${getStatusEmoji(p.ciStatus)}</span>
          <strong>${p.name}</strong>
          <span class="badge badge-${p.stack}">${p.stack}</span>
        </div>
        <div class="health-score" style="color: ${getHealthColor(p.healthScore)}">${p.healthScore}</div>
      </div>
      <ul class="issue-list">
        ${issues.map((i) => `<li>${i}</li>`).join('\n        ')}
      </ul>
    </div>`;
    })
    .join('\n');
};

export const renderOkCards = (okProjects: ProjectStatus[]): string => {
  return okProjects
    .map(
      (p) => `
    <details class="ok-card">
      <summary>
        <span class="status-icon">${getStatusEmoji(p.ciStatus)}</span>
        <strong>${p.name}</strong>
        <span class="badge badge-${p.stack}">${p.stack}</span>
        <span class="health-score" style="color: ${getHealthColor(p.healthScore)}">${p.healthScore}</span>
        <canvas data-sparkline="${p.name}" width="60" height="20"></canvas>
      </summary>
      <div class="ok-detail">
        <div class="metric"><span class="metric-label">CI</span><span>${p.ciStatus}${p.lastRun?.html_url ? ` <a href="${p.lastRun.html_url}" target="_blank">(view)</a>` : ''}</span></div>
        <div class="metric"><span class="metric-label">Open PRs</span><span>${p.openPRs.length}</span></div>
        <div class="metric"><span class="metric-label">Security</span><span style="color:${p.securityScore >= 80 ? '#22c55e' : p.securityScore >= 40 ? '#f59e0b' : '#ef4444'}">${p.securityScore}% <small>(${[p.hasGitleaks ? 'secrets' : '', p.hasSemgrep ? 'SAST' : '', p.hasSupplyChain ? 'supply' : '', p.hasLicenseCheck ? 'license' : ''].filter(Boolean).join(', ') || 'none'})</small></span></div>
        <div class="metric"><span class="metric-label">Review</span><span>${p.hasCodeRabbit ? 'CodeRabbit' : p.configured ? 'Claude' : 'None'}</span></div>
        <div class="metric"><span class="metric-label">Quality</span><span>${[p.hasHusky ? 'Husky' : '', p.hasRenovate ? 'Renovate' : ''].filter(Boolean).join(', ') || 'None'}</span></div>
        <div class="metric"><span class="metric-label">Perf/A11y</span><span style="color:${p.perfScore >= 80 ? '#22c55e' : p.perfScore >= 40 ? '#f59e0b' : '#ef4444'}">${p.perfScore}% <small>(${[p.hasLighthouse || p.hasPerformanceBudget ? 'perf' : '', p.hasAccessibilityCheck ? 'a11y' : '', p.hasCoverageTracking ? 'cov' : '', p.hasSemanticRelease || p.hasReleaseDrafter ? 'rel' : ''].filter(Boolean).join(', ') || 'none'})</small></span></div>
      </div>
    </details>`
    )
    .join('\n');
};
