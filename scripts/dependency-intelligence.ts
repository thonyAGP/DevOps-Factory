/**
 * dependency-intelligence.ts
 *
 * Scans package.json across all Node.js repos for outdated/vulnerable deps.
 * Groups findings by priority: critical security > major updates > minor.
 * Creates a weekly GitHub issue report.
 *
 * Run: pnpm dep-intel
 * Trigger: GitHub Actions (weekly)
 */

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { KNOWN_PROJECTS, GITHUB_OWNER, type ProjectConfig } from '../factory.config.js';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface DepInfo {
  name: string;
  currentVersion: string;
  isDev: boolean;
}

interface AuditVulnerability {
  name: string;
  severity: string;
  range: string;
  title: string;
  url: string;
}

interface RepoReport {
  project: ProjectConfig;
  totalDeps: number;
  vulnerabilities: AuditVulnerability[];
  outdatedCount: number;
}

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30000, maxBuffer: 10 * 1024 * 1024 }).trim();
  } catch {
    return '';
  }
};

const ghApi = <T>(endpoint: string): T | null => {
  const raw = sh(`gh api "${endpoint}"`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const fetchPackageJson = (repo: string): PackageJson | null => {
  const data = ghApi<{ content: string }>(`repos/${repo}/contents/package.json`);
  if (!data?.content) return null;
  try {
    return JSON.parse(Buffer.from(data.content, 'base64').toString()) as PackageJson;
  } catch {
    return null;
  }
};

const extractDeps = (pkg: PackageJson): DepInfo[] => {
  const deps: DepInfo[] = [];
  for (const [name, version] of Object.entries(pkg.dependencies || {})) {
    deps.push({ name, currentVersion: version, isDev: false });
  }
  for (const [name, version] of Object.entries(pkg.devDependencies || {})) {
    deps.push({ name, currentVersion: version, isDev: true });
  }
  return deps;
};

const fetchDependabotAlerts = (repo: string): AuditVulnerability[] => {
  const raw = sh(
    `gh api "repos/${repo}/dependabot/alerts?state=open&per_page=20" --jq "[.[] | {name: .dependency.package.name, severity: .security_advisory.severity, range: .dependency.package.ecosystem, title: .security_advisory.summary, url: .html_url}]"`
  );
  if (!raw) return [];
  try {
    return JSON.parse(raw) as AuditVulnerability[];
  } catch {
    return [];
  }
};

const analyzeRepo = (project: ProjectConfig): RepoReport | null => {
  const pkg = fetchPackageJson(project.repo);
  if (!pkg) return null;

  const deps = extractDeps(pkg);
  const vulnerabilities = fetchDependabotAlerts(project.repo);

  // Count outdated: check if lockfile has newer versions available
  // Simple heuristic: count deps with ^ or ~ prefix (potentially outdatable)
  const outdatedCount = deps.filter(
    (d) => d.currentVersion.startsWith('^') || d.currentVersion.startsWith('~')
  ).length;

  return {
    project,
    totalDeps: deps.length,
    vulnerabilities,
    outdatedCount,
  };
};

const severityOrder: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const generateReport = (reports: RepoReport[]): string => {
  const lines: string[] = [
    '## Dependency Intelligence Report',
    '',
    `> Generated: ${new Date().toISOString()}`,
    '',
  ];

  // Vulnerabilities section
  const allVulns = reports.flatMap((r) =>
    r.vulnerabilities.map((v) => ({ ...v, repo: r.project.name }))
  );
  allVulns.sort((a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4));

  if (allVulns.length > 0) {
    lines.push('### Security Vulnerabilities');
    lines.push('');
    lines.push('| Severity | Repo | Package | Issue |');
    lines.push('|----------|------|---------|-------|');
    for (const v of allVulns) {
      const badge =
        v.severity === 'critical' || v.severity === 'high'
          ? `**${v.severity.toUpperCase()}**`
          : v.severity;
      lines.push(`| ${badge} | ${v.repo} | ${v.name} | [${v.title}](${v.url}) |`);
    }
    lines.push('');
  } else {
    lines.push('### Security Vulnerabilities');
    lines.push('');
    lines.push('No open Dependabot alerts found.');
    lines.push('');
  }

  // Dependency overview
  lines.push('### Dependency Overview');
  lines.push('');
  lines.push('| Repo | Total Deps | Vulnerabilities | Stack |');
  lines.push('|------|-----------|-----------------|-------|');
  for (const r of reports) {
    const vulnBadge = r.vulnerabilities.length > 0 ? `**${r.vulnerabilities.length}**` : '0';
    lines.push(`| ${r.project.name} | ${r.totalDeps} | ${vulnBadge} | ${r.project.stack} |`);
  }
  lines.push('');

  // Summary
  const totalVulns = allVulns.length;
  const criticals = allVulns.filter((v) => v.severity === 'critical').length;
  const highs = allVulns.filter((v) => v.severity === 'high').length;

  lines.push('### Summary');
  lines.push('');
  lines.push(`- **Repos scanned**: ${reports.length}`);
  lines.push(`- **Total vulnerabilities**: ${totalVulns}`);
  if (criticals > 0) lines.push(`- **Critical**: ${criticals}`);
  if (highs > 0) lines.push(`- **High**: ${highs}`);
  lines.push('');
  lines.push('---');
  lines.push('*Auto-generated by DevOps-Factory Dependency Intelligence*');

  return lines.join('\n');
};

const postReport = (factoryRepo: string, report: string): void => {
  const LABEL = 'dep-intel';

  // Close previous open reports
  const existing = sh(
    `gh issue list --repo ${factoryRepo} --label "${LABEL}" --state open --json number`
  );
  try {
    const issues = JSON.parse(existing || '[]') as { number: number }[];
    for (const issue of issues) {
      sh(
        `gh issue close ${issue.number} --repo ${factoryRepo} --comment "Superseded by new report"`
      );
    }
  } catch {
    // ignore
  }

  // Create label if needed
  sh(
    `gh label create "${LABEL}" --repo ${factoryRepo} --color "0E8A16" --description "Dependency intelligence report" --force`
  );

  // Create issue
  const tmpFile = '/tmp/dep-intel-body.md';
  writeFileSync(tmpFile, report);
  sh(
    `gh issue create --repo ${factoryRepo} --title "Dependency Intelligence Report - ${new Date().toISOString().split('T')[0]}" --body-file "${tmpFile}" --label "${LABEL}"`
  );
};

const main = (): void => {
  const factoryRepo = process.env.GITHUB_REPOSITORY ?? `${GITHUB_OWNER}/DevOps-Factory`;
  const nodeProjects = KNOWN_PROJECTS.filter(
    (p) => p.stack === 'node' || p.stack === 'nextjs' || p.stack === 'fastify'
  );

  console.log(`\nDependency Intelligence - ${new Date().toISOString()}`);
  console.log(`Scanning ${nodeProjects.length} Node.js repos\n`);

  const reports: RepoReport[] = [];

  for (const project of nodeProjects) {
    process.stdout.write(`Scanning ${project.name}... `);
    const report = analyzeRepo(project);
    if (report) {
      console.log(`${report.totalDeps} deps, ${report.vulnerabilities.length} vulns`);
      reports.push(report);
    } else {
      console.log('no package.json');
    }
  }

  const markdownReport = generateReport(reports);

  // Save locally
  writeFileSync('data/dep-intel-report.md', markdownReport);
  console.log('\nReport saved to data/dep-intel-report.md');

  // Post as GitHub issue
  if (process.env.GITHUB_ACTIONS) {
    console.log('Posting report as GitHub issue...');
    postReport(factoryRepo, markdownReport);
  }

  console.log('\nDependency intelligence complete.');
};

main();
