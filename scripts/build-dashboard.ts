/**
 * build-dashboard.ts
 *
 * Generates a static HTML dashboard from scan results and GitHub API data.
 * Also generates a daily GitHub Issue report.
 *
 * Run: pnpm dashboard
 * Cron: every 4h via GitHub Actions
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

interface ScanResult {
  name: string;
  fullName: string;
  stack: string;
  hasCI: boolean;
  hasClaudeReview: boolean;
  hasSelfHealing: boolean;
  hasQodoMerge: boolean;
  defaultBranch: string;
}

interface ScanReport {
  timestamp: string;
  analyses: ScanResult[];
}

interface WorkflowRun {
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
  ciStatus: "pass" | "fail" | "none";
  lastRun: WorkflowRun | null;
  openPRs: PRInfo[];
  aiFixPRs: PRInfo[];
  healthScore: number;
  configured: boolean;
}

const gh = (cmd: string): string => {
  try {
    return execSync(`gh ${cmd}`, { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
};

const getLatestWorkflowRun = (
  repo: string,
  branch: string
): WorkflowRun | null => {
  const result = gh(
    `api repos/${repo}/actions/runs?branch=${branch}&per_page=1 --jq '.workflow_runs[0] | {conclusion, name, html_url, created_at, head_branch}'`
  );
  if (!result || result === "null") return null;
  try {
    return JSON.parse(result) as WorkflowRun;
  } catch {
    return null;
  }
};

const getOpenPRs = (repo: string): PRInfo[] => {
  const result = gh(
    `pr list --repo ${repo} --json number,title,state,url,author,labels,createdAt --jq '[.[] | {number, title, state, html_url: .url, user: {login: .author.login}, labels: [.labels[].name], created_at: .createdAt}]'`
  );
  try {
    return JSON.parse(result || "[]") as PRInfo[];
  } catch {
    return [];
  }
};

const calculateHealthScore = (status: ProjectStatus): number => {
  let score = 100;
  if (status.ciStatus === "fail") score -= 30;
  if (status.ciStatus === "none") score -= 10;
  if (!status.configured) score -= 20;
  if (status.aiFixPRs.length > 0) score -= 10;
  if (status.openPRs.length > 5) score -= 10;
  return Math.max(0, score);
};

const getStatusEmoji = (status: "pass" | "fail" | "none"): string => {
  switch (status) {
    case "pass":
      return "&#9989;"; // green check
    case "fail":
      return "&#10060;"; // red X
    case "none":
      return "&#9898;"; // white circle
  }
};

const getHealthColor = (score: number): string => {
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#f59e0b";
  return "#ef4444";
};

const buildProjectStatuses = (report: ScanReport): ProjectStatus[] => {
  return report.analyses
    .filter((a) => a.stack !== "unknown")
    .map((analysis) => {
      const lastRun = getLatestWorkflowRun(
        analysis.fullName,
        analysis.defaultBranch
      );
      const allPRs = getOpenPRs(analysis.fullName);
      const aiFixPRs = allPRs.filter((pr) =>
        pr.labels.some((l) => l.name === "ai-fix")
      );

      const ciStatus: ProjectStatus["ciStatus"] = lastRun
        ? lastRun.conclusion === "success"
          ? "pass"
          : "fail"
        : "none";

      const configured =
        analysis.hasClaudeReview && analysis.hasSelfHealing;

      const status: ProjectStatus = {
        name: analysis.name,
        fullName: analysis.fullName,
        stack: analysis.stack,
        ciStatus,
        lastRun,
        openPRs: allPRs,
        aiFixPRs,
        healthScore: 0,
        configured,
      };

      status.healthScore = calculateHealthScore(status);
      return status;
    });
};

const generateHTML = (statuses: ProjectStatus[]): string => {
  const timestamp = new Date().toISOString();
  const avgHealth = Math.round(
    statuses.reduce((s, p) => s + p.healthScore, 0) / statuses.length
  );
  const totalAIFixes = statuses.reduce(
    (s, p) => s + p.aiFixPRs.length,
    0
  );
  const failingProjects = statuses.filter(
    (p) => p.ciStatus === "fail"
  ).length;

  const projectCards = statuses
    .sort((a, b) => a.healthScore - b.healthScore)
    .map(
      (p) => `
    <div class="card">
      <div class="card-header">
        <div>
          <span class="status-icon">${getStatusEmoji(p.ciStatus)}</span>
          <strong>${p.name}</strong>
          <span class="badge badge-${p.stack}">${p.stack}</span>
        </div>
        <div class="health-score" style="color: ${getHealthColor(p.healthScore)}">
          ${p.healthScore}/100
        </div>
      </div>
      <div class="card-body">
        <div class="metric">
          <span class="metric-label">CI Status</span>
          <span class="metric-value">${p.ciStatus}${p.lastRun ? ` <a href="${p.lastRun.html_url}" target="_blank">(view)</a>` : ""}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Open PRs</span>
          <span class="metric-value">${p.openPRs.length}</span>
        </div>
        <div class="metric">
          <span class="metric-label">AI Fix PRs</span>
          <span class="metric-value">${p.aiFixPRs.length > 0 ? `<strong style="color: #f59e0b">${p.aiFixPRs.length} pending</strong>` : "0"}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Configured</span>
          <span class="metric-value">${p.configured ? "Claude + Self-heal" : "<em>Partial</em>"}</span>
        </div>
      </div>
    </div>`
    )
    .join("\n");

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
    }
    .header {
      text-align: center;
      margin-bottom: 2rem;
    }
    .header h1 { color: #58a6ff; font-size: 1.8rem; }
    .header .timestamp { color: #8b949e; font-size: 0.85rem; margin-top: 0.5rem; }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .summary-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.2rem;
      text-align: center;
    }
    .summary-card .number { font-size: 2rem; font-weight: bold; }
    .summary-card .label { color: #8b949e; font-size: 0.85rem; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1rem;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      overflow: hidden;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem;
      border-bottom: 1px solid #30363d;
    }
    .card-body { padding: 1rem; }
    .status-icon { margin-right: 0.5rem; }
    .health-score { font-size: 1.2rem; font-weight: bold; }
    .badge {
      font-size: 0.7rem;
      padding: 2px 6px;
      border-radius: 4px;
      margin-left: 0.5rem;
    }
    .badge-nextjs { background: #000; color: #fff; border: 1px solid #333; }
    .badge-node { background: #026e00; color: #fff; }
    .badge-dotnet { background: #512bd4; color: #fff; }
    .badge-fastify { background: #000; color: #fff; }
    .metric {
      display: flex;
      justify-content: space-between;
      padding: 0.4rem 0;
      border-bottom: 1px solid #21262d;
    }
    .metric:last-child { border-bottom: none; }
    .metric-label { color: #8b949e; }
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="header">
    <h1>DevOps Factory Dashboard</h1>
    <div class="timestamp">Last updated: ${timestamp}</div>
  </div>

  <div class="summary">
    <div class="summary-card">
      <div class="number">${statuses.length}</div>
      <div class="label">Projects</div>
    </div>
    <div class="summary-card">
      <div class="number" style="color: ${getHealthColor(avgHealth)}">${avgHealth}</div>
      <div class="label">Avg Health</div>
    </div>
    <div class="summary-card">
      <div class="number" style="color: ${failingProjects > 0 ? "#ef4444" : "#22c55e"}">${failingProjects}</div>
      <div class="label">Failing CI</div>
    </div>
    <div class="summary-card">
      <div class="number" style="color: ${totalAIFixes > 0 ? "#f59e0b" : "#22c55e"}">${totalAIFixes}</div>
      <div class="label">AI Fixes Pending</div>
    </div>
  </div>

  <div class="grid">
    ${projectCards}
  </div>
</body>
</html>`;
};

const generateDailyReport = (statuses: ProjectStatus[]): string => {
  const date = new Date().toISOString().split("T")[0];
  const failingProjects = statuses.filter((p) => p.ciStatus === "fail");
  const pendingAIFixes = statuses.flatMap((p) =>
    p.aiFixPRs.map((pr) => ({ project: p.name, pr }))
  );
  const configuredCount = statuses.filter((p) => p.configured).length;

  let body = `## Summary\n`;
  body += `- **${statuses.length}** projects monitored\n`;
  body += `- **${configuredCount}/${statuses.length}** fully configured\n`;
  body += `- **${pendingAIFixes.length}** AI fix PR(s) pending merge\n`;
  body += `- **${failingProjects.length}** CI failure(s)\n\n`;

  body += `## Per Project\n\n`;

  for (const p of statuses.sort((a, b) => a.healthScore - b.healthScore)) {
    const icon =
      p.ciStatus === "pass"
        ? "white_check_mark"
        : p.ciStatus === "fail"
          ? "x"
          : "white_circle";
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

// Main
const main = () => {
  const reportPath = "dashboard/scan-report.json";

  if (!existsSync(reportPath)) {
    console.error(
      "No scan report found. Run 'pnpm scan' first."
    );
    process.exit(1);
  }

  const report: ScanReport = JSON.parse(
    readFileSync(reportPath, "utf-8")
  );

  console.log("Building dashboard...\n");
  const statuses = buildProjectStatuses(report);

  // Generate HTML dashboard
  const html = generateHTML(statuses);
  writeFileSync("dashboard/index.html", html);
  console.log("Dashboard written to dashboard/index.html");

  // Generate daily report
  const reportBody = generateDailyReport(statuses);
  writeFileSync("dashboard/daily-report.md", reportBody);
  console.log("Daily report written to dashboard/daily-report.md");

  // Write statuses JSON for other consumers
  writeFileSync(
    "dashboard/statuses.json",
    JSON.stringify(
      { timestamp: new Date().toISOString(), projects: statuses },
      null,
      2
    )
  );

  // If running in GitHub Actions, create the daily issue
  if (process.env.GITHUB_ACTIONS === "true") {
    const date = new Date().toISOString().split("T")[0];
    const title = `DevOps Report - ${date}`;

    // Close previous daily reports
    gh(
      `issue list --repo ${process.env.GITHUB_REPOSITORY} --label "daily-report" --state open --json number --jq '.[].number' | while read num; do gh issue close $num --repo ${process.env.GITHUB_REPOSITORY}; done`
    );

    gh(
      `issue create --repo ${process.env.GITHUB_REPOSITORY} --title "${title}" --body-file dashboard/daily-report.md --label "daily-report"`
    );
    console.log(`GitHub Issue created: ${title}`);
  }
};

main();
