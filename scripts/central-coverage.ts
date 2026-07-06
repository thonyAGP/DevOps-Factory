/**
 * central-coverage.ts
 *
 * Measures real test coverage for the managed repos, centrally — same
 * architecture as central-scan: runs from the public Factory repo (free
 * Actions minutes), clones each node-stack repo that has vitest tests,
 * installs its dependencies and runs `vitest run --coverage`.
 *
 * Results land in data/coverage-history.json in the exact format
 * coverage-baseline.ts maintains and quality-score.ts reads — so scores and
 * the dashboard update with zero further changes. coverage-baseline (daily)
 * carries the last measured values forward between weekly runs.
 *
 * Two phases so the slow measurement never races the hourly crons that
 * push to master (the workflow resets onto fresh origin/master between them):
 *   --measure --out FILE   clone + test + write raw measurements
 *   --apply FILE           merge measurements into data/coverage-history.json
 *
 * Usage: pnpm central-coverage -- --measure --out /tmp/m.json
 *        pnpm central-coverage -- --apply /tmp/m.json
 *        pnpm central-coverage                      (both, for local runs)
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  mkdirSync,
  appendFileSync,
} from 'node:fs';
import { KNOWN_PROJECTS, type ProjectConfig } from '../factory.config.js';
import { logActivity } from './activity-logger.js';
import { sh, tmpDir } from './shell-utils.js';

export interface Coverage {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}

export interface CoverageMeasurement {
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
  entries: { date: string; repos: CoverageMeasurement[] }[];
}

const NODE_STACKS = new Set(['nextjs', 'fastify', 'node', 'astro']);
const HISTORY_PATH = 'data/coverage-history.json';
const INSTALL_TIMEOUT_MS = 300_000;
const TEST_TIMEOUT_MS = 600_000;
const BUFFER = 64 * 1024 * 1024;

/** Parse a vitest/istanbul coverage-summary.json into our Coverage shape. */
export const parseCoverageSummary = (json: string): Coverage | null => {
  try {
    const data = JSON.parse(json) as { total?: Record<string, { pct?: number }> };
    const total = data.total;
    if (!total?.lines) return null;
    const pct = (k: string): number => Math.round((total[k]?.pct ?? 0) * 100) / 100;
    return {
      lines: pct('lines'),
      branches: pct('branches'),
      functions: pct('functions'),
      statements: pct('statements'),
    };
  } catch {
    return null;
  }
};

/**
 * Merge measurements into the history: upsert today's entry, measured repos
 * win over whatever the daily baseline wrote, unmeasured repos keep their
 * existing entry for the day.
 */
export const applyMeasurements = (
  history: CoverageHistory,
  measurements: CoverageMeasurement[],
  date: string
): CoverageHistory => {
  const entries = [...history.entries];
  const idx = entries.findIndex((e) => e.date === date);
  const existingRepos = idx >= 0 ? entries[idx].repos : [];

  const measured = new Map(measurements.map((m) => [m.repo, m]));
  const merged: CoverageMeasurement[] = existingRepos.map((r) => measured.get(r.repo) ?? r);
  for (const m of measurements) {
    if (!merged.some((r) => r.repo === m.repo)) merged.push(m);
  }

  const entry = { date, repos: merged };
  if (idx >= 0) entries[idx] = entry;
  else entries.push(entry);

  return { ...history, lastUpdated: new Date().toISOString(), entries };
};

const detectPackageManager = (dir: string): 'pnpm' | 'yarn' | 'npm' => {
  if (existsSync(`${dir}/pnpm-lock.yaml`)) return 'pnpm';
  if (existsSync(`${dir}/yarn.lock`)) return 'yarn';
  return 'npm';
};

const countTestFiles = (dir: string): number => {
  const out = sh(
    `find . -type f \\( -name "*.test.*" -o -name "*.spec.*" \\) -not -path "*/node_modules/*" | wc -l`,
    { cwd: dir }
  );
  return parseInt(out || '0', 10);
};

const measureRepo = (project: ProjectConfig): CoverageMeasurement => {
  const base: CoverageMeasurement = {
    name: project.name,
    repo: project.repo,
    stack: project.stack,
    hasTests: false,
    testFileCount: 0,
    status: 'no-coverage',
  };

  const dir = `${tmpDir}/central-coverage/${project.name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cloned = sh(`gh repo clone ${project.repo} "${dir}" -- --depth 1 2>&1 && echo OK`, {
    timeout: 300_000,
    maxBuffer: BUFFER,
    fallbackOnError: 'stdout',
  }).includes('OK');
  if (!cloned) return { ...base, status: 'error' };

  try {
    if (!existsSync(`${dir}/package.json`)) return base;
    const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const hasVitest =
      Boolean(deps['vitest']) ||
      existsSync(`${dir}/vitest.config.ts`) ||
      existsSync(`${dir}/vitest.config.mts`) ||
      existsSync(`${dir}/vitest.config.js`);
    const testFileCount = countTestFiles(dir);
    base.testFileCount = testFileCount;
    base.hasTests = testFileCount > 0;
    if (!hasVitest || !base.hasTests) return base; // jest & co: not supported yet
    base.testFramework = 'vitest';

    const pm = detectPackageManager(dir);
    const installCmd =
      pm === 'pnpm'
        ? 'pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile'
        : pm === 'yarn'
          ? 'yarn install --frozen-lockfile || yarn install'
          : existsSync(`${dir}/package-lock.json`)
            ? 'npm ci || npm install'
            : 'npm install';
    const installed = sh(`${installCmd} > /dev/null 2>&1 && echo OK`, {
      cwd: dir,
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: BUFFER,
      fallbackOnError: 'stdout',
    }).includes('OK');
    if (!installed) return { ...base, status: 'error' };

    // The clone is throwaway — adding the coverage provider without saving is fine
    if (!deps['@vitest/coverage-v8']) {
      const addCmd =
        pm === 'pnpm'
          ? 'pnpm add -D @vitest/coverage-v8'
          : pm === 'yarn'
            ? 'yarn add -D @vitest/coverage-v8'
            : 'npm i -D @vitest/coverage-v8';
      sh(`${addCmd} > /dev/null 2>&1`, {
        cwd: dir,
        timeout: INSTALL_TIMEOUT_MS,
        maxBuffer: BUFFER,
        fallbackOnError: 'stdout',
      });
    }

    sh(
      `npx vitest run --coverage --coverage.reporter=json-summary --coverage.reportsDirectory=.central-coverage --reporter=dot > /dev/null 2>&1`,
      { cwd: dir, timeout: TEST_TIMEOUT_MS, maxBuffer: BUFFER, fallbackOnError: 'stdout' }
    );

    const summaryPath = `${dir}/.central-coverage/coverage-summary.json`;
    if (!existsSync(summaryPath)) return { ...base, status: 'error' };
    const coverage = parseCoverageSummary(readFileSync(summaryPath, 'utf-8'));
    if (!coverage) return { ...base, status: 'error' };
    return { ...base, coverage, status: 'collected' };
  } catch {
    return { ...base, status: 'error' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const loadHistory = (): CoverageHistory => {
  if (!existsSync(HISTORY_PATH)) {
    return { version: 1, lastUpdated: new Date().toISOString(), entries: [] };
  }
  try {
    return JSON.parse(readFileSync(HISTORY_PATH, 'utf-8')) as CoverageHistory;
  } catch {
    return { version: 1, lastUpdated: new Date().toISOString(), entries: [] };
  }
};

const measure = (outPath: string): void => {
  const targets = KNOWN_PROJECTS.filter((p) => NODE_STACKS.has(p.stack));
  console.log(`Measuring coverage for ${targets.length} node-stack repo(s)...\n`);
  const results: CoverageMeasurement[] = [];
  for (const project of targets) {
    process.stdout.write(`${project.name} ... `);
    const m = measureRepo(project);
    results.push(m);
    console.log(m.status === 'collected' ? `${m.coverage?.lines}% lines` : m.status);
  }
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  const collected = results.filter((r) => r.status === 'collected');
  console.log(`\n${collected.length}/${results.length} repos measured → ${outPath}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    let md = `## Central Coverage\n\n| Repo | Lines | Status |\n|------|-------|--------|\n`;
    for (const r of results) {
      md += `| ${r.name} | ${r.coverage ? `${r.coverage.lines}%` : '—'} | ${r.status} |\n`;
    }
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }
};

const apply = (inPath: string): void => {
  const measurements = JSON.parse(readFileSync(inPath, 'utf-8')) as CoverageMeasurement[];
  const date = new Date().toISOString().split('T')[0];
  const history = applyMeasurements(loadHistory(), measurements, date);
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
  const collected = measurements.filter((m) => m.status === 'collected').length;
  console.log(`coverage-history.json updated (${collected} repos with fresh coverage)`);
  logActivity(
    'central-coverage',
    'coverage-measured',
    `${collected}/${measurements.length} repos measured`,
    collected > 0 ? 'success' : 'warning'
  );
};

const main = (): void => {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath =
    outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : '/tmp/coverage-measurements.json';
  const applyIdx = args.indexOf('--apply');

  if (args.includes('--measure')) {
    measure(outPath);
  } else if (applyIdx >= 0) {
    apply(args[applyIdx + 1] ?? outPath);
  } else {
    measure(outPath);
    apply(outPath);
  }
};

const isDirectRun =
  !process.env.VITEST && process.argv[1]?.replace(/\\/g, '/').endsWith('central-coverage.ts');
if (isDirectRun) main();
