/**
 * build-dashboard.ts
 *
 * Generates a static HTML dashboard from scan results and GitHub API data.
 * Also generates a daily GitHub Issue report.
 *
 * Run: pnpm dashboard
 * Cron: every 4h via GitHub Actions
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { DASHBOARD_URL, KNOWN_PROJECTS } from '../factory.config.js';
import {
  getRecentActivities,
  getActivityStats,
  logActivity,
  type ActivityStatus,
} from './activity-logger.js';

interface MigrationModule {
  name: string;
  hasCommands: boolean;
  hasQueries: boolean;
  hasValidators: boolean;
  handlerCount: number;
}

interface MigrationSnapshot {
  date: string;
  backend: {
    modules: MigrationModule[];
    moduleCount: number;
    totalHandlers: number;
    domainEntities: number;
    apiEndpointFiles: number;
    testFiles: number;
    testCount: number;
    csFiles: number;
  };
  frontend: {
    reactComponents: number;
    tsFiles: number;
    htmlPages: number;
    hasStorybook: boolean;
  };
  specs: {
    totalSpecs: number;
    annotatedPrograms: number;
    migrationPatterns: number;
    migrationDocs: number;
  };
  tools: {
    csprojCount: number;
    kbIndexed: boolean;
    mcpServer: boolean;
  };
  overall: {
    progressPercent: number;
    totalFiles: number;
  };
}

interface ScanResult {
  name: string;
  fullName: string;
  stack: string;
  hasCI: boolean;
  hasClaudeReview: boolean;
  hasSelfHealing: boolean;
  hasQodoMerge: boolean;
  hasGitleaks: boolean;
  hasRenovate: boolean;
  hasHusky: boolean;
  defaultBranch: string;
}

interface ScanReport {
  timestamp: string;
  analyses: ScanResult[];
}

interface WorkflowRun {
  id: number;
  conclusion: string;
  name: string;
  html_url: string;
  created_at: string;
  head_branch: string;
}

interface PRInfo {
  number: number;
  title: string;
  state: string;
  html_url: string;
  user: { login: string };
  labels: { name: string }[];
  created_at: string;
}

interface ProjectStatus {
  name: string;
  fullName: string;
  stack: string;
  ciStatus: 'pass' | 'fail' | 'none';
  lastRun: WorkflowRun | null;
  openPRs: PRInfo[];
  aiFixPRs: PRInfo[];
  renovatePRs: PRInfo[];
  healthScore: number;
  configured: boolean;
  hasGitleaks: boolean;
  hasRenovate: boolean;
  hasHusky: boolean;
}

interface HistoryProjectEntry {
  name: string;
  health: number;
  ciStatus: 'pass' | 'fail' | 'none';
}

interface HistoryEntry {
  date: string;
  avgHealth: number;
  failingCI: number;
  passingCI: number;
  totalOpenPRs: number;
  perProject: HistoryProjectEntry[];
}

const HISTORY_MAX_DAYS = 90;

const formatDashboardDate = (date: Date): string => {
  const formatted = date.toLocaleString('en-GB', {
    timeZone: 'Europe/Madrid',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });
  return formatted.replace(/\//g, '-').replace(',', '');
};

const updateHistory = (statuses: ProjectStatus[]): void => {
  const historyPath = 'dashboard/history.json';
  let history: HistoryEntry[] = [];

  if (existsSync(historyPath)) {
    try {
      history = JSON.parse(readFileSync(historyPath, 'utf-8')) as HistoryEntry[];
    } catch {
      history = [];
    }
  }

  const today = new Date().toISOString().split('T')[0];
  const avgHealth = Math.round(statuses.reduce((s, p) => s + p.healthScore, 0) / statuses.length);

  const entry: HistoryEntry = {
    date: today,
    avgHealth,
    failingCI: statuses.filter((p) => p.ciStatus === 'fail').length,
    passingCI: statuses.filter((p) => p.ciStatus === 'pass').length,
    totalOpenPRs: statuses.reduce((s, p) => s + p.openPRs.length, 0),
    perProject: statuses.map((p) => ({
      name: p.name,
      health: p.healthScore,
      ciStatus: p.ciStatus,
    })),
  };

  const existingIdx = history.findIndex((h) => h.date === today);
  if (existingIdx >= 0) {
    history[existingIdx] = entry;
  } else {
    history.push(entry);
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - HISTORY_MAX_DAYS);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  history = history.filter((h) => h.date >= cutoffStr);

  history.sort((a, b) => a.date.localeCompare(b.date));

  writeFileSync(historyPath, JSON.stringify(history, null, 2));
  console.log(`History updated (${history.length} entries)`);
};

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
};

const getLatestWorkflowRun = (repo: string, branch: string): WorkflowRun | null => {
  const result = sh(
    `gh api "repos/${repo}/actions/runs?branch=${branch}&per_page=1" --jq '.workflow_runs[0] | {id, conclusion, name, html_url, created_at, head_branch}'`
  );
  if (!result || result === 'null') return null;
  try {
    return JSON.parse(result) as WorkflowRun;
  } catch {
    return null;
  }
};

const getOpenPRs = (repo: string): PRInfo[] => {
  const result = sh(
    `gh pr list --repo ${repo} --json number,title,state,url,author,labels,createdAt --jq '[.[] | {number, title, state, html_url: .url, user: {login: .author.login}, labels: [.labels[].name], created_at: .createdAt}]'`
  );
  try {
    return JSON.parse(result || '[]') as PRInfo[];
  } catch {
    return [];
  }
};

const calculateHealthScore = (status: ProjectStatus): number => {
  let score = 100;
  if (status.ciStatus === 'fail') score -= 30;
  if (status.ciStatus === 'none') score -= 10;
  if (!status.configured) score -= 15;
  if (status.aiFixPRs.length > 0) score -= 10;
  if (status.openPRs.length > 5) score -= 10;
  if (!status.hasGitleaks) score -= 5;
  if (!status.hasRenovate) score -= 5;
  if (!status.hasHusky) score -= 5;
  return Math.max(0, score);
};

const getStatusEmoji = (status: 'pass' | 'fail' | 'none'): string => {
  switch (status) {
    case 'pass':
      return '&#9989;'; // green check
    case 'fail':
      return '&#10060;'; // red X
    case 'none':
      return '&#9898;'; // white circle
  }
};

const getHealthColor = (score: number): string => {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#f59e0b';
  return '#ef4444';
};

const hiddenRepos = new Set(KNOWN_PROJECTS.filter((p) => p.hidden).map((p) => p.repo));

const buildProjectStatuses = (report: ScanReport): ProjectStatus[] => {
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
      };

      status.healthScore = calculateHealthScore(status);
      return status;
    });
};

const getProjectIssues = (p: ProjectStatus): string[] => {
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

const getMigrationSection = (): string => {
  const latestPath = 'data/migration-latest.json';
  if (!existsSync(latestPath)) return '';

  try {
    const snap = JSON.parse(readFileSync(latestPath, 'utf-8')) as MigrationSnapshot;
    const b = snap.backend;
    const f = snap.frontend;
    const s = snap.specs;
    const pct = snap.overall.progressPercent;
    const pctColor = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';

    const moduleChips = b.modules
      .map((m) => {
        const cls = ['module-chip', m.hasCommands ? 'has-cmd' : '', m.hasQueries ? 'has-qry' : '']
          .filter(Boolean)
          .join(' ');
        return `<span class="${cls}" title="${m.handlerCount} handlers">${m.name}</span>`;
      })
      .join('\n            ');

    return `
  <div class="migration">
    <h2>Lecteur Magic Migration (${snap.date})</h2>
    <div class="migration-grid">
      <div class="migration-card">
        <h3>Overall Progress</h3>
        <div class="migration-stat"><span>Progress</span><span class="val" style="color:${pctColor}">${pct}%</span></div>
        <div class="progress-bar"><div class="fill" style="width:${pct}%;background:${pctColor}"></div></div>
        <div class="migration-stat" style="margin-top:0.4rem"><span>Total files</span><span class="val">${snap.overall.totalFiles}</span></div>
      </div>
      <div class="migration-card">
        <h3>Backend (Caisse.API)</h3>
        <div class="migration-stat"><span>CQRS Modules</span><span class="val">${b.moduleCount}</span></div>
        <div class="migration-stat"><span>Handlers</span><span class="val">${b.totalHandlers}</span></div>
        <div class="migration-stat"><span>Domain entities</span><span class="val">${b.domainEntities}</span></div>
        <div class="migration-stat"><span>C# files</span><span class="val">${b.csFiles}</span></div>
      </div>
      <div class="migration-card">
        <h3>Tests</h3>
        <div class="migration-stat"><span>Test files</span><span class="val">${b.testFiles}</span></div>
        <div class="migration-stat"><span>Est. tests</span><span class="val">~${b.testCount}</span></div>
        <div class="progress-bar"><div class="fill" style="width:${Math.min(100, (b.testCount / 200) * 100)}%;background:#58a6ff"></div></div>
      </div>
      <div class="migration-card">
        <h3>Frontend (adh-web)</h3>
        <div class="migration-stat"><span>React components</span><span class="val">${f.reactComponents}</span></div>
        <div class="migration-stat"><span>TS files</span><span class="val">${f.tsFiles}</span></div>
        <div class="migration-stat"><span>HTML prototypes</span><span class="val">${f.htmlPages}</span></div>
        <div class="migration-stat"><span>Storybook</span><span class="val">${f.hasStorybook ? 'Yes' : 'No'}</span></div>
      </div>
      <div class="migration-card">
        <h3>OpenSpec</h3>
        <div class="migration-stat"><span>Total specs</span><span class="val">${s.totalSpecs}</span></div>
        <div class="migration-stat"><span>Annotated</span><span class="val">${s.annotatedPrograms}</span></div>
        <div class="migration-stat"><span>Patterns</span><span class="val">${s.migrationPatterns}</span></div>
        <div class="migration-stat"><span>Migration docs</span><span class="val">${s.migrationDocs}</span></div>
      </div>
    </div>
    <details>
      <summary style="cursor:pointer;color:#8b949e;font-size:0.85rem">Migrated Modules (${b.moduleCount})</summary>
      <div class="module-grid" style="margin-top:0.5rem">
        ${moduleChips}
      </div>
      <div style="font-size:0.7rem;color:#6e7681;margin-top:0.4rem">
        Green border = Commands | Blue border = Queries
      </div>
    </details>
  </div>`;
  } catch {
    return '';
  }
};

const getStatusIcon = (status: ActivityStatus): string => {
  switch (status) {
    case 'success':
      return '&#9989;';
    case 'warning':
      return '&#9888;&#65039;';
    case 'error':
      return '&#10060;';
    case 'info':
      return '&#8505;&#65039;';
  }
};

const getStatusColor = (status: ActivityStatus): string => {
  switch (status) {
    case 'success':
      return '#22c55e';
    case 'warning':
      return '#f59e0b';
    case 'error':
      return '#ef4444';
    case 'info':
      return '#8b949e';
  }
};

const getSourceLabel = (source: string): string => {
  const labels: Record<string, string> = {
    'scan-and-configure': 'Scanner',
    'ci-health-check': 'CI Health',
    'factory-watchdog': 'Watchdog',
    'build-dashboard': 'Dashboard',
    'quality-score': 'Quality',
    'self-heal': 'Self-Heal',
  };
  return labels[source] ?? source;
};

const getSourceColor = (source: string): string => {
  const colors: Record<string, string> = {
    'scan-and-configure': '#58a6ff',
    'ci-health-check': '#f97316',
    'factory-watchdog': '#a855f7',
    'build-dashboard': '#22c55e',
    'quality-score': '#06b6d4',
    'self-heal': '#ec4899',
  };
  return colors[source] ?? '#8b949e';
};

const formatTimeAgo = (timestamp: string): string => {
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const getFactoryStatusSection = (): string => {
  const stats = getActivityStats();
  const recent = getRecentActivities(30);
  const reversed = [...recent].reverse();

  // Factory health: green if no errors in last 24h, orange if warnings, red if errors
  const last24hEntries = recent.filter(
    (e) => Date.now() - new Date(e.timestamp).getTime() < 24 * 60 * 60 * 1000
  );
  const recentErrors = last24hEntries.filter((e) => e.status === 'error').length;
  const recentWarnings = last24hEntries.filter((e) => e.status === 'warning').length;

  const factoryHealth = recentErrors > 0 ? 'error' : recentWarnings > 0 ? 'warning' : 'success';
  const factoryLabel =
    recentErrors > 0 ? 'Issues Detected' : recentWarnings > 0 ? 'Warnings' : 'All Systems Healthy';
  const factoryColor = getStatusColor(factoryHealth);

  // Weekly stats
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

const generateHTML = (statuses: ProjectStatus[]): string => {
  const timestamp = formatDashboardDate(new Date());
  const avgHealth = Math.round(statuses.reduce((s, p) => s + p.healthScore, 0) / statuses.length);
  const failingCount = statuses.filter((p) => p.ciStatus === 'fail').length;
  const totalAIFixes = statuses.reduce((s, p) => s + p.aiFixPRs.length, 0);

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

  const alertCards = problemProjects
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

  const okCards = okProjects
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
        <div class="metric"><span class="metric-label">Security</span><span>${p.hasGitleaks ? 'Gitleaks' : 'None'}</span></div>
        <div class="metric"><span class="metric-label">Quality</span><span>${[p.hasHusky ? 'Husky' : '', p.hasRenovate ? 'Renovate' : ''].filter(Boolean).join(', ') || 'None'}</span></div>
      </div>
    </details>`
    )
    .join('\n');

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
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      padding: 2rem;
      max-width: 1200px;
      margin: 0 auto;
    }
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* Header */
    .header { text-align: center; margin-bottom: 1.5rem; }
    .header h1 { color: #58a6ff; font-size: 1.8rem; }
    .header .timestamp { color: #8b949e; font-size: 0.8rem; margin-top: 0.3rem; }

    /* Summary strip */
    .summary {
      display: flex;
      gap: 1rem;
      justify-content: center;
      flex-wrap: wrap;
      margin-bottom: 1.5rem;
    }
    .summary-item {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 0.8rem 1.5rem;
      text-align: center;
      min-width: 120px;
    }
    .summary-item .number { font-size: 1.6rem; font-weight: bold; }
    .summary-item .label { color: #8b949e; font-size: 0.75rem; }

    /* All clear banner */
    .all-clear {
      background: rgba(34,197,94,0.1);
      border: 1px solid #22c55e;
      border-radius: 8px;
      padding: 1rem;
      text-align: center;
      color: #22c55e;
      font-weight: bold;
      font-size: 1.1rem;
      margin-bottom: 1.5rem;
    }

    /* Section titles */
    .section-title {
      font-size: 1rem;
      color: #8b949e;
      margin-bottom: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .section-title.alert { color: #ef4444; }

    /* Alert cards - problems */
    .alerts { margin-bottom: 2rem; }
    .alert-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-left: 4px solid #ef4444;
      border-radius: 8px;
      padding: 1rem 1.2rem;
      margin-bottom: 0.8rem;
    }
    .alert-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.6rem;
    }
    .issue-list {
      list-style: none;
      padding: 0;
    }
    .issue-list li {
      padding: 0.3rem 0;
      padding-left: 1.2rem;
      position: relative;
      font-size: 0.9rem;
    }
    .issue-list li::before {
      content: "\\26A0";
      position: absolute;
      left: 0;
    }

    /* OK cards - compact expandable */
    .ok-section { margin-bottom: 2rem; }
    .ok-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 0.5rem;
    }
    .ok-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      overflow: hidden;
    }
    .ok-card summary {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.7rem 1rem;
      cursor: pointer;
      list-style: none;
      user-select: none;
    }
    .ok-card summary::-webkit-details-marker { display: none; }
    .ok-card summary .health-score { margin-left: auto; font-size: 0.9rem; font-weight: bold; }
    .ok-card summary canvas { flex-shrink: 0; }
    .ok-card[open] { border-color: #58a6ff; }
    .ok-detail { padding: 0 1rem 0.8rem; border-top: 1px solid #21262d; }
    .ok-detail .metric {
      display: flex;
      justify-content: space-between;
      padding: 0.3rem 0;
      font-size: 0.85rem;
    }

    /* Shared */
    .status-icon { margin-right: 0.3rem; }
    .health-score { font-weight: bold; }
    .badge { font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; margin-left: 0.3rem; }
    .badge-nextjs { background: #000; color: #fff; border: 1px solid #333; }
    .badge-node { background: #026e00; color: #fff; }
    .badge-dotnet { background: #512bd4; color: #fff; }
    .badge-fastify { background: #000; color: #fff; }
    .badge-astro { background: #ff5d01; color: #fff; }
    .metric-label { color: #8b949e; }

    /* Trends */
    .trends {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.2rem;
      margin-bottom: 1.5rem;
    }
    .trends h2 { color: #58a6ff; font-size: 1rem; margin-bottom: 0.8rem; }
    .trends canvas { max-height: 220px; }

    /* Migration section */
    .migration {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.2rem;
      margin-bottom: 1.5rem;
    }
    .migration h2 { color: #8b5cf6; font-size: 1rem; margin-bottom: 0.8rem; }
    .migration-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 0.8rem;
      margin-bottom: 1rem;
    }
    .migration-card {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 0.8rem 1rem;
    }
    .migration-card h3 {
      font-size: 0.85rem;
      color: #8b949e;
      margin-bottom: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .migration-stat {
      display: flex;
      justify-content: space-between;
      padding: 0.2rem 0;
      font-size: 0.85rem;
    }
    .migration-stat .val { font-weight: bold; }
    .progress-bar {
      background: #21262d;
      border-radius: 4px;
      height: 8px;
      margin-top: 0.5rem;
      overflow: hidden;
    }
    .progress-bar .fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s;
    }
    .module-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      margin-top: 0.5rem;
    }
    .module-chip {
      font-size: 0.7rem;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(139,92,246,0.15);
      color: #a78bfa;
      border: 1px solid rgba(139,92,246,0.3);
    }
    .module-chip.has-cmd { border-left: 2px solid #22c55e; }
    .module-chip.has-qry { border-right: 2px solid #58a6ff; }

    /* Factory Status */
    .factory-status {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.2rem;
      margin-bottom: 1.5rem;
    }
    .factory-status h2 { color: #a855f7; font-size: 1rem; margin-bottom: 0.8rem; }
    .factory-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.8rem;
      margin-bottom: 0.8rem;
    }
    @media (max-width: 700px) { .factory-grid { grid-template-columns: 1fr; } }
    .factory-health-card {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 0.8rem 1rem;
      border-left: 3px solid;
    }
    .factory-health-indicator {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.5rem 0.8rem;
      border-radius: 6px;
      margin-bottom: 0.6rem;
    }
    .factory-health-detail .metric {
      display: flex;
      justify-content: space-between;
      padding: 0.25rem 0;
      font-size: 0.85rem;
    }
    .factory-stats-card {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 0.8rem 1rem;
    }
    .factory-stats-card h3 {
      font-size: 0.85rem;
      color: #8b949e;
      margin-bottom: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .factory-stats-card .metric {
      display: flex;
      justify-content: space-between;
      padding: 0.25rem 0;
      font-size: 0.85rem;
    }
    .factory-stats-card .val { font-weight: bold; }
    .activity-timeline {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      overflow: hidden;
    }
    .activity-timeline summary {
      padding: 0.7rem 1rem;
      cursor: pointer;
      color: #8b949e;
      font-size: 0.85rem;
      user-select: none;
    }
    .activity-timeline[open] { border-color: #a855f7; }
    .timeline-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .timeline-table td {
      padding: 0.4rem 0.6rem;
      border-top: 1px solid #21262d;
      vertical-align: middle;
    }
    .source-badge {
      font-size: 0.65rem;
      padding: 1px 6px;
      border-radius: 4px;
      white-space: nowrap;
    }
  </style>
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
  </div>

  ${getFactoryStatusSection()}

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

  <script>
    fetch('history.json')
      .then(r => r.ok ? r.json() : [])
      .then(history => {
        if (!history.length) return;
        const last30 = history.slice(-30);
        const labels = last30.map(h => h.date.slice(5));
        const healthData = last30.map(h => h.avgHealth);
        const failData = last30.map(h => h.failingCI);

        new Chart(document.getElementById('trendsChart'), {
          type: 'line',
          data: {
            labels,
            datasets: [
              {
                label: 'Avg Health',
                data: healthData,
                borderColor: '#58a6ff',
                backgroundColor: 'rgba(88,166,255,0.1)',
                fill: true,
                tension: 0.3,
                yAxisID: 'y',
              },
              {
                label: 'Failing CI',
                data: failData,
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239,68,68,0.1)',
                fill: true,
                tension: 0.3,
                yAxisID: 'y1',
              },
            ],
          },
          options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            scales: {
              y: {
                type: 'linear', position: 'left', min: 0, max: 100,
                title: { display: true, text: 'Health', color: '#8b949e' },
                ticks: { color: '#8b949e' }, grid: { color: '#21262d' },
              },
              y1: {
                type: 'linear', position: 'right', min: 0,
                title: { display: true, text: 'Failing', color: '#8b949e' },
                ticks: { color: '#8b949e', stepSize: 1 }, grid: { drawOnChartArea: false },
              },
              x: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' } },
            },
            plugins: { legend: { labels: { color: '#c9d1d9' } } },
          },
        });

        document.querySelectorAll('[data-sparkline]').forEach(canvas => {
          const name = canvas.getAttribute('data-sparkline');
          const last14 = history.slice(-14);
          const data = last14.map(h => {
            const proj = h.perProject.find(p => p.name === name);
            return proj ? proj.health : null;
          }).filter(v => v !== null);
          if (!data.length) return;
          new Chart(canvas, {
            type: 'line',
            data: {
              labels: data.map((_, i) => i),
              datasets: [{ data, borderColor: '#58a6ff', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3 }],
            },
            options: {
              responsive: false,
              plugins: { legend: { display: false }, tooltip: { enabled: false } },
              scales: { x: { display: false }, y: { display: false, min: 0, max: 100 } },
            },
          });
        });
      })
      .catch(() => {});
  </script>
</body>
</html>`;
};

const generateDailyReport = (statuses: ProjectStatus[]): string => {
  const failingProjects = statuses.filter((p) => p.ciStatus === 'fail');
  const pendingAIFixes = statuses.flatMap((p) => p.aiFixPRs.map((pr) => ({ project: p.name, pr })));
  const configuredCount = statuses.filter((p) => p.configured).length;

  let body = `## Summary\n`;
  body += `- **${statuses.length}** projects monitored\n`;
  body += `- **${configuredCount}/${statuses.length}** fully configured\n`;
  body += `- **${pendingAIFixes.length}** AI fix PR(s) pending merge\n`;
  body += `- **${failingProjects.length}** CI failure(s)\n\n`;

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

interface AlertEvent {
  type: 'ci_fail' | 'ai_fix_pending' | 'health_drop';
  project: string;
  repo: string;
  runId: string;
  message: string;
}

const detectAlerts = (statuses: ProjectStatus[]): AlertEvent[] => {
  const alerts: AlertEvent[] = [];

  for (const p of statuses) {
    if (p.ciStatus === 'fail') {
      alerts.push({
        type: 'ci_fail',
        project: p.name,
        repo: p.fullName,
        runId: p.lastRun?.id ? String(p.lastRun.id) : '',
        message: `CI is failing on ${p.name} (${p.fullName})`,
      });
    }

    if (p.aiFixPRs.length > 0) {
      alerts.push({
        type: 'ai_fix_pending',
        project: p.name,
        repo: p.fullName,
        runId: '',
        message: `${p.aiFixPRs.length} AI fix PR(s) pending review on ${p.name}`,
      });
    }
  }

  // Check health drops against previous history
  const historyPath = 'dashboard/history.json';
  if (existsSync(historyPath)) {
    try {
      const history = JSON.parse(readFileSync(historyPath, 'utf-8')) as HistoryEntry[];
      if (history.length >= 2) {
        const prev = history[history.length - 2];
        for (const p of statuses) {
          const prevProject = prev.perProject.find((pp) => pp.name === p.name);
          if (prevProject && prevProject.health - p.healthScore >= 15) {
            alerts.push({
              type: 'health_drop',
              project: p.name,
              repo: p.fullName,
              runId: '',
              message: `Health dropped from ${prevProject.health} to ${p.healthScore} on ${p.name}`,
            });
          }
        }
      }
    } catch {
      // ignore history parse errors
    }
  }

  return alerts;
};

// Main
const main = () => {
  const reportPath = 'dashboard/scan-report.json';

  if (!existsSync(reportPath)) {
    console.error("No scan report found. Run 'pnpm scan' first.");
    process.exit(1);
  }

  const report: ScanReport = JSON.parse(readFileSync(reportPath, 'utf-8'));

  console.log('Building dashboard...\n');
  const statuses = buildProjectStatuses(report);

  // Generate HTML dashboard
  const html = generateHTML(statuses);
  writeFileSync('dashboard/index.html', html);
  console.log('Dashboard written to dashboard/index.html');

  // Generate daily report
  const reportBody = generateDailyReport(statuses);
  writeFileSync('dashboard/daily-report.md', reportBody);
  console.log('Daily report written to dashboard/daily-report.md');

  // Update history for trends
  updateHistory(statuses);

  // Write statuses JSON for other consumers
  writeFileSync(
    'dashboard/statuses.json',
    JSON.stringify({ timestamp: new Date().toISOString(), projects: statuses }, null, 2)
  );

  // Detect alerts for email notifications
  const alerts = detectAlerts(statuses);
  if (alerts.length > 0) {
    writeFileSync(
      'dashboard/alert-payload.json',
      JSON.stringify({ timestamp: new Date().toISOString(), alerts }, null, 2)
    );
    console.log(`${alerts.length} alert(s) detected - alert-payload.json written`);
  } else {
    console.log('No alerts detected');
  }

  logActivity(
    'build-dashboard',
    'dashboard-built',
    `${statuses.length} projects, avg health ${Math.round(statuses.reduce((s, p) => s + p.healthScore, 0) / statuses.length)}`,
    alerts.length > 0 ? 'warning' : 'success'
  );

  console.log(`\nDashboard URL: ${DASHBOARD_URL}\n`);

  // If running in GitHub Actions, create the daily issue
  if (process.env.GITHUB_ACTIONS === 'true') {
    const date = new Date().toISOString().split('T')[0];
    const title = `DevOps Report - ${date}`;

    // Close previous daily reports
    const openIssues = sh(
      `gh issue list --repo ${process.env.GITHUB_REPOSITORY} --label "daily-report" --state open --json number --jq ".[].number"`
    );
    for (const num of openIssues.split('\n').filter(Boolean)) {
      sh(`gh issue close ${num} --repo ${process.env.GITHUB_REPOSITORY}`);
    }

    // Create new issue
    try {
      execSync(
        `gh issue create --repo ${process.env.GITHUB_REPOSITORY} --title "${title}" --body-file dashboard/daily-report.md --label "daily-report"`,
        { encoding: 'utf-8', stdio: 'inherit' }
      );
    } catch (e) {
      console.error('Failed to create issue:', e);
    }
    console.log(`GitHub Issue created: ${title}`);
  }
};

main();
