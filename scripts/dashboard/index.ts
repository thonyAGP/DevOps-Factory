/**
 * dashboard/index.ts
 *
 * Generates a static HTML dashboard from scan results and GitHub API data.
 * Also generates a daily GitHub Issue report.
 *
 * Run: pnpm dashboard
 * Cron: every 4h via GitHub Actions
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { DASHBOARD_URL } from '../../factory.config.js';
import { logActivity } from '../activity-logger.js';
import { sh } from '../shell-utils.js';
import { buildProjectStatuses } from './data-fetchers.js';
import { generateHTML } from './html-assembly.js';
import { generateDailyReport } from './report.js';
import { updateHistory } from './history.js';
import { detectAlerts } from './alerts.js';
import type { ScanReport } from './types.js';

const main = () => {
  const reportPath = 'dashboard/scan-report.json';

  if (!existsSync(reportPath)) {
    console.error("No scan report found. Run 'pnpm scan' first.");
    process.exit(1);
  }

  const report: ScanReport = JSON.parse(readFileSync(reportPath, 'utf-8'));

  console.log('Building dashboard...\n');
  const statuses = buildProjectStatuses(report);

  const html = generateHTML(statuses);
  writeFileSync('dashboard/index.html', html);
  console.log('Dashboard written to dashboard/index.html');

  const reportBody = generateDailyReport(statuses);
  writeFileSync('dashboard/daily-report.md', reportBody);
  console.log('Daily report written to dashboard/daily-report.md');

  updateHistory(statuses);

  writeFileSync(
    'dashboard/statuses.json',
    JSON.stringify({ timestamp: new Date().toISOString(), projects: statuses }, null, 2)
  );

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

  if (process.env.GITHUB_ACTIONS === 'true') {
    const date = new Date().toISOString().split('T')[0];
    const title = `DevOps Report - ${date}`;

    const openIssues = sh(
      `gh issue list --repo ${process.env.GITHUB_REPOSITORY} --label "daily-report" --state open --json number --jq ".[].number"`
    );
    for (const num of openIssues.split('\n').filter(Boolean)) {
      sh(`gh issue close ${num} --repo ${process.env.GITHUB_REPOSITORY}`);
    }

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
