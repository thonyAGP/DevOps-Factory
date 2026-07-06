import { readFileSync, existsSync } from 'node:fs';

interface CoverageRepo {
  name: string;
  repo: string;
  hasTests: boolean;
  testFileCount: number;
  coverage?: { lines: number; branches: number; functions: number; statements: number };
  status: string;
}

interface CoverageHistory {
  lastUpdated: string;
  entries: { date: string; repos: CoverageRepo[] }[];
}

const GLOBAL_THRESHOLD = 60;

const bar = (pct: number): string => {
  const color = pct >= 80 ? '#22c55e' : pct >= GLOBAL_THRESHOLD ? '#f59e0b' : '#ef4444';
  return `<div class="cov-bar"><span style="width:${Math.min(pct, 100)}%;background:${color}"></span></div>`;
};

export const getCoverageSection = (): string => {
  const path = 'data/coverage-history.json';
  if (!existsSync(path)) return '';

  let history: CoverageHistory;
  try {
    history = JSON.parse(readFileSync(path, 'utf-8')) as CoverageHistory;
  } catch {
    return '';
  }
  const latest = history.entries[history.entries.length - 1];
  if (!latest) return '';

  const measured = latest.repos.filter((r) => r.status === 'collected' && r.coverage);
  const withTestsNoData = latest.repos.filter((r) => r.hasTests && r.status !== 'collected');
  if (measured.length === 0 && withTestsNoData.length === 0) return '';

  const avg =
    measured.length > 0
      ? Math.round(measured.reduce((s, r) => s + (r.coverage?.lines ?? 0), 0) / measured.length)
      : 0;
  const aboveThreshold = measured.filter((r) => (r.coverage?.lines ?? 0) >= GLOBAL_THRESHOLD).length;

  const rows = measured
    .sort((a, b) => (b.coverage?.lines ?? 0) - (a.coverage?.lines ?? 0))
    .map(
      (r) =>
        `<tr><td>${r.name}</td><td class="cov-pct">${r.coverage?.lines ?? 0}%</td><td>${bar(r.coverage?.lines ?? 0)}</td><td class="cov-files">${r.testFileCount}</td></tr>`
    )
    .join('\n');

  const pending = withTestsNoData
    .map((r) => `<span class="cov-pending">${r.name} (${r.testFileCount} tests)</span>`)
    .join(' ');

  return `
  <div class="coverage-section">
    <h2>Test Coverage</h2>
    <div class="coverage-summary">
      <span><strong>${avg}%</strong> couverture moyenne (lignes)</span>
      <span><strong>${aboveThreshold}/${measured.length}</strong> repo(s) &ge; ${GLOBAL_THRESHOLD}%</span>
      <span class="coverage-date">Mesuré le ${latest.date} — hebdomadaire</span>
    </div>
    ${
      measured.length > 0
        ? `<table class="coverage-table">
        <thead><tr><th>Repo</th><th>Lignes</th><th></th><th>Fichiers de test</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>`
        : ''
    }
    ${pending ? `<div class="coverage-pending-list">En attente de mesure : ${pending}</div>` : ''}
  </div>`;
};
