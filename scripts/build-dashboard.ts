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
import { DASHBOARD_URL } from '../factory.config.js';

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

const buildProjectStatuses = (report: ScanReport): ProjectStatus[] => {
  return report.analyses
    .filter((a) => a.stack !== 'unknown')
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

const generateHTML = (statuses: ProjectStatus[]): string => {
  const timestamp = new Date().toISOString();
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
