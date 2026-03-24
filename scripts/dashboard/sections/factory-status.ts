import { getRecentActivities, getActivityStats } from '../../activity-logger.js';
import { formatTimeAgo, getStatusIcon, getStatusColor, getSourceLabel, getSourceColor } from '../formatters.js';

export const getFactoryStatusSection = (): string => {
  const stats = getActivityStats();
  const recent = getRecentActivities(30);
  const reversed = [...recent].reverse();

  const last24hEntries = recent.filter(
    (e) => Date.now() - new Date(e.timestamp).getTime() < 24 * 60 * 60 * 1000
  );
  const recentErrors = last24hEntries.filter((e) => e.status === 'error').length;
  const recentWarnings = last24hEntries.filter((e) => e.status === 'warning').length;

  const factoryHealth = recentErrors > 0 ? 'error' : recentWarnings > 0 ? 'warning' : 'success';
  const factoryLabel =
    recentErrors > 0 ? 'Issues Detected' : recentWarnings > 0 ? 'Warnings' : 'All Systems Healthy';
  const factoryColor = getStatusColor(factoryHealth);

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const weekEntries = recent.filter((e) => e.timestamp >= oneWeekAgo);
  const weekPRs = weekEntries.filter((e) => e.action === 'pr-created').length;
  const weekHeals = weekEntries.filter((e) => e.action.includes('self-heal-triggered')).length;
  const weekErrors = weekEntries.filter((e) => e.status === 'error').length;
  const weekScans = weekEntries.filter((e) => e.action === 'scan-complete').length;

  const timelineRows = reversed
    .slice(0, 20)
    .map(
      (e) => `
            <tr>
              <td style="color:#6e7681;white-space:nowrap;font-size:0.75rem" title="${e.timestamp}">${formatTimeAgo(e.timestamp)}</td>
              <td><span class="source-badge" style="background:${getSourceColor(e.source)}20;color:${getSourceColor(e.source)};border:1px solid ${getSourceColor(e.source)}40">${getSourceLabel(e.source)}</span></td>
              <td style="color:${getStatusColor(e.status)}">${getStatusIcon(e.status)}</td>
              <td>${e.target ? `<strong>${e.target}</strong> - ` : ''}${e.details}</td>
            </tr>`
    )
    .join('');

  return `
  <div class="factory-status">
    <h2>Factory Status</h2>
    <div class="factory-grid">
      <div class="factory-health-card" style="border-color:${factoryColor}">
        <div class="factory-health-indicator" style="background:${factoryColor}20;color:${factoryColor}">
          <span style="font-size:1.4rem">${getStatusIcon(factoryHealth)}</span>
          <span style="font-weight:bold;font-size:1.1rem">${factoryLabel}</span>
        </div>
        <div class="factory-health-detail">
          <div class="metric"><span class="metric-label">Last activity</span><span>${stats.lastEntry ? formatTimeAgo(stats.lastEntry) : 'Never'}</span></div>
          <div class="metric"><span class="metric-label">Events (24h)</span><span>${stats.last24h}</span></div>
          <div class="metric"><span class="metric-label">Errors (24h)</span><span style="color:${recentErrors > 0 ? '#ef4444' : '#22c55e'}">${recentErrors}</span></div>
          <div class="metric"><span class="metric-label">Warnings (24h)</span><span style="color:${recentWarnings > 0 ? '#f59e0b' : '#22c55e'}">${recentWarnings}</span></div>
        </div>
      </div>

      <div class="factory-stats-card">
        <h3>This Week</h3>
        <div class="metric"><span class="metric-label">Scans completed</span><span class="val">${weekScans}</span></div>
        <div class="metric"><span class="metric-label">PRs created</span><span class="val">${weekPRs}</span></div>
        <div class="metric"><span class="metric-label">Self-heals triggered</span><span class="val">${weekHeals}</span></div>
        <div class="metric"><span class="metric-label">Errors detected</span><span class="val" style="color:${weekErrors > 0 ? '#ef4444' : '#22c55e'}">${weekErrors}</span></div>
        <div class="metric"><span class="metric-label">Total events (30d)</span><span class="val">${stats.total}</span></div>
      </div>
    </div>

    <details class="activity-timeline" ${recentErrors > 0 ? 'open' : ''}>
      <summary>Recent Activity (${reversed.length} events)</summary>
      <table class="timeline-table">
        <tbody>
          ${timelineRows || '<tr><td colspan="4" style="text-align:center;color:#6e7681">No activity recorded yet</td></tr>'}
        </tbody>
      </table>
    </details>
  </div>`;
};
