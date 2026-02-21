/**
 * template-drift.ts
 *
 * Compares templates deployed in target repos with source templates
 * in DevOps-Factory/templates/. Detects manual modifications,
 * outdated versions, and missing templates.
 *
 * Outputs: dashboard/template-drift.json
 * Run: pnpm template-drift
 * Cron: weekly via GitHub Actions
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { jq, devNull } from './shell-utils.js';
import { logActivity } from './activity-logger.js';

interface TemplateDrift {
  template: string;
  repoPath: string;
  status: 'synced' | 'modified' | 'outdated' | 'missing';
  similarity: number; // 0-100%
}

interface RepoDriftReport {
  repo: string;
  fullName: string;
  templates: TemplateDrift[];
  driftScore: number; // 0 = all synced, 100 = all drifted
  totalTemplates: number;
  syncedCount: number;
  modifiedCount: number;
}

interface DriftReport {
  timestamp: string;
  repos: RepoDriftReport[];
  summary: {
    totalRepos: number;
    avgDriftScore: number;
    totalDrifted: number;
    totalSynced: number;
    mostDriftedRepo: string;
  };
}

// Templates to check and their target paths in repos
const TRACKED_TEMPLATES: Array<{ source: string; target: string; condition?: string }> = [
  { source: 'gitleaks.yml', target: '.github/workflows/gitleaks.yml' },
  { source: 'license-check.yml', target: '.github/workflows/license-check.yml' },
  { source: 'supply-chain-security.yml', target: '.github/workflows/supply-chain-security.yml' },
  { source: 'container-scan.yml', target: '.github/workflows/container-scan.yml' },
  { source: 'security-headers.yml', target: '.github/workflows/security-headers.yml' },
  { source: 'semgrep.yml', target: '.github/workflows/semgrep.yml' },
  { source: 'branch-cleanup.yml', target: '.github/workflows/branch-cleanup.yml' },
  { source: 'stale-bot.yml', target: '.github/workflows/stale-bot.yml' },
  { source: 'dead-code-detection.yml', target: '.github/workflows/dead-code-detection.yml' },
  { source: 'sbom-generation.yml', target: '.github/workflows/sbom-generation.yml' },
  { source: 'auto-label.yml', target: '.github/workflows/auto-label.yml' },
  { source: 'pr-size-limiter.yml', target: '.github/workflows/pr-size-limiter.yml' },
  { source: 'release-drafter.yml', target: '.github/workflows/release-drafter.yml' },
  { source: 'config-drift.yml', target: '.github/workflows/config-drift.yml' },
  { source: 'coderabbit.yaml', target: '.coderabbit.yaml' },
  { source: 'renovate.json', target: 'renovate.json' },
];

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30000 }).trim();
  } catch {
    return '';
  }
};

const getFileContentFromRepo = (repo: string, path: string): string | null => {
  const result = sh(`gh api "repos/${repo}/contents/${path}" --jq ${jq('.content')} 2>${devNull}`);
  if (!result) return null;
  try {
    return Buffer.from(result, 'base64').toString('utf-8');
  } catch {
    return null;
  }
};

const calculateSimilarity = (source: string, target: string): number => {
  const sourceLines = source
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const targetLines = target
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (sourceLines.length === 0 && targetLines.length === 0) return 100;
  if (sourceLines.length === 0 || targetLines.length === 0) return 0;

  const sourceSet = new Set(sourceLines);
  const targetSet = new Set(targetLines);

  let matches = 0;
  for (const line of sourceSet) {
    if (targetSet.has(line)) matches++;
  }

  const totalUnique = new Set([...sourceLines, ...targetLines]).size;
  return Math.round((matches / totalUnique) * 100);
};

const main = () => {
  console.log('Template Drift Detection\n');

  const reportPath = 'dashboard/scan-report.json';
  if (!existsSync(reportPath)) {
    console.log('No scan report found. Run scan first.');
    return;
  }

  const scanReport = JSON.parse(readFileSync(reportPath, 'utf-8')) as {
    analyses: Array<{ name: string; fullName: string; stack: string }>;
  };

  const activeRepos = scanReport.analyses.filter((a) => a.stack !== 'unknown');
  const repos: RepoDriftReport[] = [];

  for (const repo of activeRepos) {
    console.log(`Checking: ${repo.name}...`);
    const templates: TemplateDrift[] = [];

    for (const tracked of TRACKED_TEMPLATES) {
      const sourcePath = `templates/${tracked.source}`;
      if (!existsSync(sourcePath)) continue;

      const sourceContent = readFileSync(sourcePath, 'utf-8');
      const deployedContent = getFileContentFromRepo(repo.fullName, tracked.target);

      if (!deployedContent) {
        templates.push({
          template: tracked.source,
          repoPath: tracked.target,
          status: 'missing',
          similarity: 0,
        });
        continue;
      }

      const similarity = calculateSimilarity(sourceContent, deployedContent);

      let status: TemplateDrift['status'];
      if (similarity >= 95) {
        status = 'synced';
      } else if (similarity >= 70) {
        status = 'modified';
      } else {
        status = 'outdated';
      }

      templates.push({
        template: tracked.source,
        repoPath: tracked.target,
        status,
        similarity,
      });
    }

    const syncedCount = templates.filter((t) => t.status === 'synced').length;
    const modifiedCount = templates.filter(
      (t) => t.status === 'modified' || t.status === 'outdated'
    ).length;
    const deployedCount = templates.filter((t) => t.status !== 'missing').length;
    const driftScore = deployedCount > 0 ? Math.round((modifiedCount / deployedCount) * 100) : 0;

    repos.push({
      repo: repo.name,
      fullName: repo.fullName,
      templates,
      driftScore,
      totalTemplates: templates.length,
      syncedCount,
      modifiedCount,
    });

    console.log(
      `  ${syncedCount} synced, ${modifiedCount} drifted, ${templates.filter((t) => t.status === 'missing').length} missing`
    );
  }

  const totalDrifted = repos.reduce((s, r) => s + r.modifiedCount, 0);
  const totalSynced = repos.reduce((s, r) => s + r.syncedCount, 0);
  const mostDrifted = repos.reduce((max, r) => (r.driftScore > max.driftScore ? r : max), repos[0]);

  const report: DriftReport = {
    timestamp: new Date().toISOString(),
    repos,
    summary: {
      totalRepos: repos.length,
      avgDriftScore: Math.round(repos.reduce((s, r) => s + r.driftScore, 0) / repos.length),
      totalDrifted,
      totalSynced,
      mostDriftedRepo: mostDrifted?.repo ?? 'none',
    },
  };

  writeFileSync('dashboard/template-drift.json', JSON.stringify(report, null, 2));

  console.log(`\nDrift Report saved.`);
  console.log(`  Avg drift: ${report.summary.avgDriftScore}%`);
  console.log(`  Synced: ${totalSynced}, Drifted: ${totalDrifted}`);
  console.log(`  Most drifted: ${report.summary.mostDriftedRepo}`);

  logActivity(
    'build-dashboard',
    'template-drift',
    `Drift: ${report.summary.avgDriftScore}%, ${totalDrifted} drifted templates`,
    totalDrifted > 0 ? 'warning' : 'success'
  );
};

main();
