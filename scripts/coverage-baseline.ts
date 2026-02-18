/**
 * coverage-baseline.ts
 *
 * Scans GitHub repos to collect test coverage data.
 * Detects test frameworks, counts test files, and retrieves coverage artifacts from CI runs.
 * Stores results in data/coverage-history.json for trend analysis.
 *
 * Run: pnpm coverage
 * Cron: daily via GitHub Actions
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { KNOWN_PROJECTS } from '../factory.config.js';

interface Coverage {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}

interface CoverageEntry {
  name: string;
  repo: string;
  stack: string;
  testFramework?: string;
  hasTests: boolean;
  testFileCount: number;
  coverage?: Coverage;
  status: 'collected' | 'no-coverage' | 'error';
}

interface CoverageHistory {
  version: number;
  lastUpdated: string;
  entries: {
    date: string;
    repos: CoverageEntry[];
  }[];
}

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
};

const detectTestFramework = (repo: string, stack: string): string | undefined => {
  // For .NET projects, check xUnit first
  if (stack === 'dotnet') {
    const hasXunit = sh(
      `gh api "repos/${repo}/git/trees/HEAD?recursive=1" --jq '.tree[] | select(.path | test("\\\\.Tests\\\\.csproj$")) | .path' 2>/dev/null || echo ''`
    );
    if (hasXunit) return 'xunit';
    return undefined;
  }

  // For Node.js projects, check Vitest then Jest
  const hasVitest = sh(
    `gh api repos/${repo}/contents/vitest.config.ts --jq .size 2>/dev/null || echo 0`
  );
  if (hasVitest !== '0') return 'vitest';

  const hasJest = sh(
    `gh api "repos/${repo}/git/trees/HEAD?recursive=1" --jq '.tree[] | select(.path | test("jest\\\\.config")) | .path' 2>/dev/null || echo ''`
  );
  if (hasJest) return 'jest';

  return undefined;
};

const countTestFiles = (repo: string, testFramework?: string): number => {
  if (!testFramework) return 0;

  if (testFramework === 'xunit') {
    const result = sh(
      `gh api "repos/${repo}/git/trees/HEAD?recursive=1" --jq '[.tree[] | select(.type == "blob") | select(.path | test("\\\\.Tests\\\\.csproj$|Tests\\\\.cs$")) | .path] | length' 2>/dev/null || echo 0`
    );
    return parseInt(result || '0', 10);
  }

  // For Node.js test frameworks (jq needs \\\\. for literal dot in regex)
  const patterns =
    testFramework === 'vitest'
      ? '(\\\\.test\\\\.ts|\\\\.spec\\\\.ts|\\\\.test\\\\.tsx)$'
      : '(\\\\.test\\\\.js|\\\\.spec\\\\.js|\\\\.test\\\\.jsx)$';

  const result = sh(
    `gh api "repos/${repo}/git/trees/HEAD?recursive=1" --jq '[.tree[] | select(.type == "blob") | select(.path | test("${patterns}")) | .path] | length' 2>/dev/null || echo 0`
  );
  return parseInt(result || '0', 10);
};

const fetchCoverageArtifact = (repo: string): Coverage | undefined => {
  try {
    // Get latest CI workflow run
    const runResult = sh(
      `gh api "repos/${repo}/actions/runs?per_page=1" --jq '.workflow_runs[0] | {id, status}' 2>/dev/null || echo ''`
    );
    if (!runResult) return undefined;

    let runId: string;
    try {
      const run = JSON.parse(runResult) as { id: number; status: string };
      if (run.status !== 'completed') return undefined;
      runId = String(run.id);
    } catch {
      return undefined;
    }

    // Get artifacts for the run
    const artifactResult = sh(
      `gh api "repos/${repo}/actions/runs/${runId}/artifacts?per_page=5" --jq '.artifacts[] | select(.name | test("coverage")) | {id, name}' 2>/dev/null || echo ''`
    );

    if (!artifactResult) return undefined;

    // Parse artifact and look for coverage.json
    let artifactId: string | undefined;
    try {
      const artifact = JSON.parse(artifactResult) as { id: number; name: string };
      artifactId = String(artifact.id);
    } catch {
      return undefined;
    }

    if (!artifactId) return undefined;

    // Download and parse coverage.json from artifact
    const coverageJson = sh(
      `gh api "repos/${repo}/actions/artifacts/${artifactId}/zip" --jq . 2>/dev/null | unzip -p - coverage.json 2>/dev/null || echo ''`
    );

    if (!coverageJson) return undefined;

    try {
      const data = JSON.parse(coverageJson) as Record<string, unknown>;
      const total = (data.total as Record<string, { pct?: number }>) || {};

      return {
        lines: Math.round((total.lines?.pct || 0) * 100) / 100,
        branches: Math.round((total.branches?.pct || 0) * 100) / 100,
        functions: Math.round((total.functions?.pct || 0) * 100) / 100,
        statements: Math.round((total.statements?.pct || 0) * 100) / 100,
      };
    } catch {
      return undefined;
    }
  } catch {
    return undefined;
  }
};

const collectCoverageData = (): CoverageEntry[] => {
  const entries: CoverageEntry[] = [];

  for (const project of KNOWN_PROJECTS) {
    if (project.stack === 'unknown') continue;

    console.log(`Scanning ${project.name}...`);

    const testFramework = detectTestFramework(project.repo, project.stack);
    const testFileCount = countTestFiles(project.repo, testFramework);
    const hasTests = testFileCount > 0;

    const entry: CoverageEntry = {
      name: project.name,
      repo: project.repo,
      stack: project.stack,
      testFramework,
      hasTests,
      testFileCount,
      status: 'no-coverage',
    };

    if (hasTests && project.hasCI) {
      const coverage = fetchCoverageArtifact(project.repo);
      if (coverage) {
        entry.coverage = coverage;
        entry.status = 'collected';
        console.log(`  Coverage: ${coverage.lines}% lines`);
      } else {
        console.log(`  No coverage artifacts found`);
      }
    } else if (!hasTests) {
      console.log(`  No tests detected`);
    }

    entries.push(entry);
  }

  return entries;
};

const generateCoverageReport = (entries: CoverageEntry[]): string => {
  const withCoverage = entries.filter((e) => e.status === 'collected');
  const withoutCoverage = entries.filter((e) => e.status === 'no-coverage' && e.hasTests);
  const noTests = entries.filter((e) => !e.hasTests);

  let report = `## Coverage Baseline Report\n\n`;

  report += `**Summary**\n`;
  report += `- Total repos: ${entries.length}\n`;
  report += `- With coverage data: ${withCoverage.length}\n`;
  report += `- With tests but no data: ${withoutCoverage.length}\n`;
  report += `- No tests: ${noTests.length}\n\n`;

  if (withCoverage.length > 0) {
    report += `### Coverage Data Available (${withCoverage.length})\n\n`;
    report += `| Project | Stack | Framework | Lines | Branches | Functions | Statements |\n`;
    report += `|---------|-------|-----------|-------|----------|-----------|-------------|\n`;

    for (const entry of withCoverage.sort(
      (a, b) => (b.coverage?.lines || 0) - (a.coverage?.lines || 0)
    )) {
      const cov = entry.coverage || { lines: 0, branches: 0, functions: 0, statements: 0 };
      report += `| ${entry.name} | ${entry.stack} | ${entry.testFramework || '-'} | ${cov.lines}% | ${cov.branches}% | ${cov.functions}% | ${cov.statements}% |\n`;
    }
    report += `\n`;
  }

  if (withoutCoverage.length > 0) {
    report += `### Tests Found, No Coverage Data (${withoutCoverage.length})\n\n`;
    report += `| Project | Stack | Framework | Test Files |\n`;
    report += `|---------|-------|-----------|------------|\n`;

    for (const entry of withoutCoverage.sort((a, b) => b.testFileCount - a.testFileCount)) {
      report += `| ${entry.name} | ${entry.stack} | ${entry.testFramework || '-'} | ${entry.testFileCount} |\n`;
    }
    report += `\n`;
  }

  if (noTests.length > 0) {
    report += `### No Tests Detected (${noTests.length})\n\n`;
    for (const entry of noTests) {
      report += `- ${entry.name} (${entry.stack})\n`;
    }
    report += `\n`;
  }

  return report;
};

const updateCoverageHistory = (entries: CoverageEntry[]): void => {
  const historyPath = 'data/coverage-history.json';
  let history: CoverageHistory = { version: 1, lastUpdated: new Date().toISOString(), entries: [] };

  if (existsSync(historyPath)) {
    try {
      history = JSON.parse(readFileSync(historyPath, 'utf-8')) as CoverageHistory;
    } catch {
      history = { version: 1, lastUpdated: new Date().toISOString(), entries: [] };
    }
  }

  const today = new Date().toISOString().split('T')[0];
  const existingIdx = history.entries.findIndex((e) => e.date === today);

  const newEntry = { date: today, repos: entries };

  if (existingIdx >= 0) {
    history.entries[existingIdx] = newEntry;
  } else {
    history.entries.push(newEntry);
  }

  // Keep last 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  history.entries = history.entries.filter((e) => e.date >= cutoffStr);

  history.lastUpdated = new Date().toISOString();
  history.entries.sort((a, b) => a.date.localeCompare(b.date));

  writeFileSync(historyPath, JSON.stringify(history, null, 2));
  console.log(`\nCoverage history updated (${history.entries.length} days tracked)`);
};

const main = (): void => {
  console.log('Collecting coverage data from GitHub repos...\n');

  const entries = collectCoverageData();
  updateCoverageHistory(entries);

  const report = generateCoverageReport(entries);
  writeFileSync('data/coverage-report.md', report);
  console.log('Report written to data/coverage-report.md');

  // If running in GitHub Actions, create an issue
  if (process.env.GITHUB_ACTIONS === 'true') {
    const date = new Date().toISOString().split('T')[0];
    const title = `Coverage Baseline - ${date}`;

    try {
      execSync(
        `gh issue create --repo ${process.env.GITHUB_REPOSITORY} --title "${title}" --body-file data/coverage-report.md --label "coverage-baseline"`,
        { encoding: 'utf-8', stdio: 'inherit' }
      );
      console.log(`\nGitHub Issue created: ${title}`);
    } catch (e) {
      console.error('Failed to create issue:', e);
    }
  }
};

main();
