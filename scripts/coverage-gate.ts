/**
 * coverage-gate.ts
 *
 * Runs in target repo CI to enforce coverage thresholds.
 * Implements ratchet pattern: coverage can only go up.
 * Posts coverage delta as PR comment.
 *
 * Run: tsx scripts/coverage-gate.ts (from target repo)
 * This script is meant to be copied/referenced in target repos.
 *
 * Environment variables:
 * - COVERAGE_FILE: path to coverage-summary.json (default: coverage/coverage-summary.json)
 * - BASELINE_FILE: path to baseline coverage (default: .coverage-baseline.json)
 * - GITHUB_TOKEN: for PR comments
 * - GITHUB_REPOSITORY: owner/repo
 * - PR_NUMBER: pull request number
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

interface CoverageSummary {
  total: {
    lines: { pct: number };
    statements: { pct: number };
    functions: { pct: number };
    branches: { pct: number };
  };
}

interface BaselineCoverage {
  date: string;
  lines: number;
  statements: number;
  functions: number;
  branches: number;
}

const COVERAGE_FILE = process.env.COVERAGE_FILE || 'coverage/coverage-summary.json';
const BASELINE_FILE = process.env.BASELINE_FILE || '.coverage-baseline.json';
const THRESHOLD_GLOBAL = 60;
const RATCHET_ENABLED = true;

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 15_000 }).trim();
  } catch {
    return '';
  }
};

const loadCoverage = (): CoverageSummary | null => {
  if (!existsSync(COVERAGE_FILE)) {
    console.error(`Coverage file not found: ${COVERAGE_FILE}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(COVERAGE_FILE, 'utf-8')) as CoverageSummary;
  } catch {
    console.error('Failed to parse coverage file');
    return null;
  }
};

const loadBaseline = (): BaselineCoverage | null => {
  if (!existsSync(BASELINE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as BaselineCoverage;
  } catch {
    return null;
  }
};

const formatDelta = (current: number, previous: number): string => {
  const delta = current - previous;
  if (delta > 0) return `+${delta.toFixed(1)}%`;
  if (delta < 0) return `${delta.toFixed(1)}%`;
  return '0%';
};

const postPRComment = (comment: string): void => {
  const repo = process.env.GITHUB_REPOSITORY;
  const prNumber = process.env.PR_NUMBER;

  if (!repo || !prNumber) {
    console.log('No PR context - skipping comment');
    return;
  }

  try {
    const tmpFile = '/tmp/coverage-comment.md';
    writeFileSync(tmpFile, comment);
    sh(`gh pr comment ${prNumber} --repo ${repo} --body-file ${tmpFile}`);
    console.log('Coverage comment posted on PR');
  } catch {
    console.warn('Failed to post PR comment');
  }
};

const main = () => {
  console.log('Coverage Gate Check\n');

  const coverage = loadCoverage();
  if (!coverage) {
    console.log('No coverage data - skipping gate check');
    process.exit(0);
  }

  const current = {
    lines: coverage.total.lines.pct,
    statements: coverage.total.statements.pct,
    functions: coverage.total.functions.pct,
    branches: coverage.total.branches.pct,
  };

  const baseline = loadBaseline();
  let failed = false;
  const issues: string[] = [];

  console.log('Current coverage:');
  console.log(`  Lines:      ${current.lines}%`);
  console.log(`  Statements: ${current.statements}%`);
  console.log(`  Functions:  ${current.functions}%`);
  console.log(`  Branches:   ${current.branches}%`);

  // Check global threshold
  if (current.lines < THRESHOLD_GLOBAL) {
    issues.push(`Lines coverage ${current.lines}% is below threshold ${THRESHOLD_GLOBAL}%`);
    failed = true;
  }

  // Ratchet: check against baseline
  if (RATCHET_ENABLED && baseline) {
    console.log(`\nBaseline (${baseline.date}):`);
    console.log(`  Lines:      ${baseline.lines}%`);

    if (current.lines < baseline.lines) {
      issues.push(
        `Lines coverage dropped: ${baseline.lines}% → ${current.lines}% (${formatDelta(current.lines, baseline.lines)})`
      );
      failed = true;
    }
    if (current.branches < baseline.branches) {
      issues.push(
        `Branch coverage dropped: ${baseline.branches}% → ${current.branches}% (${formatDelta(current.branches, baseline.branches)})`
      );
      failed = true;
    }
  }

  // Build PR comment
  let comment = `## Coverage Report\n\n`;
  comment += `| Metric | Current |`;
  if (baseline) comment += ` Baseline | Delta |`;
  comment += `\n|--------|---------|`;
  if (baseline) comment += `----------|-------|`;
  comment += `\n`;

  const metrics: Array<{ name: string; key: keyof typeof current }> = [
    { name: 'Lines', key: 'lines' },
    { name: 'Statements', key: 'statements' },
    { name: 'Functions', key: 'functions' },
    { name: 'Branches', key: 'branches' },
  ];

  for (const m of metrics) {
    comment += `| ${m.name} | ${current[m.key]}% |`;
    if (baseline) {
      const prev = baseline[m.key];
      const delta = formatDelta(current[m.key], prev);
      const icon = current[m.key] >= prev ? '🟢' : '🔴';
      comment += ` ${prev}% | ${icon} ${delta} |`;
    }
    comment += `\n`;
  }

  if (issues.length > 0) {
    comment += `\n### Issues\n`;
    for (const issue of issues) {
      comment += `- ❌ ${issue}\n`;
    }
  } else {
    comment += `\n✅ All coverage checks passed\n`;
  }

  comment += `\n> Generated by DevOps-Factory Coverage Gate`;

  postPRComment(comment);

  // Update baseline if coverage improved (on main branch only)
  const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || '';
  const isMainBranch = ['main', 'master'].includes(branch);

  if (isMainBranch && !failed) {
    const newBaseline: BaselineCoverage = {
      date: new Date().toISOString().split('T')[0],
      ...current,
    };
    writeFileSync(BASELINE_FILE, JSON.stringify(newBaseline, null, 2));
    console.log('\nBaseline updated (main branch)');
  }

  if (failed) {
    console.error('\nCoverage gate FAILED');
    process.exit(1);
  }

  console.log('\nCoverage gate PASSED');
};

main();
