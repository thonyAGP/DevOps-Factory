/**
 * security-registry.ts
 *
 * Single source of truth for the fleet's security & quality posture.
 * Aggregates the findings the Factory already produces — central-scan
 * (secrets / SAST / deps / duplication), coverage, quality score — into one
 * deduplicated, time-tracked registry with a risk score and an OpenSSF-style
 * grade per repo, plus fleet deltas (new / resolved / regressed).
 *
 * Pure functions do all the computation (fully unit-tested); main() only does
 * IO. Defensive throughout: missing or malformed inputs degrade to empty
 * rather than throwing, so a partial data set never breaks the dashboard.
 *
 * Reads:  data/central-scan-latest.json, data/coverage-history.json,
 *         dashboard/quality-scores.json, data/security-registry.json (prior)
 * Writes: data/security-registry.json (current), data/security-registry-history.json
 *
 * Run: pnpm security-registry
 * Cron: daily via dashboard-build.yml (after central-scan / coverage)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { logActivity } from './activity-logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface RepoRisk {
  name: string;
  repo: string;
  /** Weighted risk points (higher = worse) */
  risk: number;
  /** OpenSSF-style posture score, 0 (worst) – 10 (best) */
  scorecard: number;
  grade: Grade;
  secrets: number;
  sastErrors: number;
  criticalDeps: number;
  highDeps: number;
  duplicationPct: number | null;
  coveragePct: number | null;
  /** Human-readable reasons the scorecard was reduced */
  reasons: string[];
}

export interface SecurityRegistry {
  date: string;
  repos: RepoRisk[];
  summary: {
    avgScorecard: number;
    totalRisk: number;
    reposWithSecrets: number;
    reposOverDuplication: number;
    gradeDistribution: Record<Grade, number>;
  };
}

export interface RegistryDelta {
  repo: string;
  metric: string;
  from: number;
  to: number;
  direction: 'new' | 'resolved' | 'worse' | 'better';
}

// Scanner inputs (shape of committed central-scan-latest.json — counts only)
interface ScanScanner {
  scanner: string;
  status: string;
  findings: number;
  bySeverity: Record<string, number>;
  metrics?: Record<string, number>;
}
interface ScanRepo {
  name: string;
  repo: string;
  cloned: boolean;
  scanners: ScanScanner[];
}
interface CentralScan {
  date: string;
  repos: ScanRepo[];
}
interface CoverageHistory {
  entries: {
    date: string;
    repos: { repo: string; status: string; coverage?: { lines: number } }[];
  }[];
}
interface QualityScores {
  scores: { repo: string; score: number }[];
}

// ---------------------------------------------------------------------------
// Pure scoring functions
// ---------------------------------------------------------------------------

/** Weight of one finding by its reported severity/kind. */
export const severityWeight = (severity: string): number => {
  switch (severity.toUpperCase()) {
    case 'SECRET':
    case 'CRITICAL':
      return 10;
    case 'HIGH':
    case 'ERROR':
      return 5;
    case 'MEDIUM':
    case 'WARNING':
      return 1;
    case 'DUPLICATION':
      return 0; // maintainability, tracked via duplicationPct not risk points
    default:
      return 1;
  }
};

const DUPLICATION_THRESHOLD_PCT = 3;
const COVERAGE_THRESHOLD_PCT = 60;

export const gradeFromRisk = (risk: number): Grade => {
  if (risk === 0) return 'A';
  if (risk < 10) return 'B';
  if (risk < 30) return 'C';
  if (risk < 75) return 'D';
  return 'F';
};

const findScanner = (repo: ScanRepo, name: string): ScanScanner | undefined =>
  repo.scanners.find((s) => s.scanner === name);

const severityCount = (sc: ScanScanner | undefined, sev: string): number =>
  sc?.status === 'findings' ? (sc.bySeverity[sev] ?? 0) : 0;

/** Build one repo's risk row from its scan entry + coverage + quality. */
export const buildRepoRisk = (
  scan: ScanRepo,
  coveragePct: number | null,
  _qualityScore: number | null
): RepoRisk => {
  const gitleaks = findScanner(scan, 'gitleaks');
  const semgrep = findScanner(scan, 'semgrep');
  const trivy = findScanner(scan, 'trivy');
  const jscpd = findScanner(scan, 'jscpd');

  const secrets = gitleaks?.status === 'findings' ? gitleaks.findings : 0;
  const sastErrors = severityCount(semgrep, 'ERROR');
  const criticalDeps = severityCount(trivy, 'CRITICAL');
  const highDeps = severityCount(trivy, 'HIGH');
  const duplicationPct =
    jscpd?.metrics?.duplicationPct !== undefined ? jscpd.metrics.duplicationPct : null;

  // Weighted risk — only security-bearing signals, not raw noise
  const risk =
    secrets * severityWeight('SECRET') +
    sastErrors * severityWeight('ERROR') +
    criticalDeps * severityWeight('CRITICAL') +
    highDeps * severityWeight('HIGH');

  // OpenSSF-style scorecard: start at 10, deduct for concrete weaknesses
  const reasons: string[] = [];
  let scorecard = 10;
  if (secrets > 0) {
    scorecard -= 4;
    reasons.push(`${secrets} secret(s) exposé(s)`);
  }
  if (criticalDeps > 0) {
    scorecard -= 2;
    reasons.push(`${criticalDeps} dépendance(s) CRITICAL`);
  }
  if (sastErrors > 0) {
    scorecard -= 2;
    reasons.push(`${sastErrors} erreur(s) SAST`);
  }
  if (duplicationPct !== null && duplicationPct >= DUPLICATION_THRESHOLD_PCT) {
    scorecard -= 1;
    reasons.push(`duplication ${duplicationPct}%`);
  }
  if (coveragePct !== null && coveragePct < COVERAGE_THRESHOLD_PCT) {
    scorecard -= 1;
    reasons.push(`couverture ${coveragePct}%`);
  }
  scorecard = Math.max(0, scorecard);

  return {
    name: scan.name,
    repo: scan.repo,
    risk,
    scorecard,
    grade: gradeFromRisk(risk),
    secrets,
    sastErrors,
    criticalDeps,
    highDeps,
    duplicationPct,
    coveragePct,
    reasons,
  };
};

export const buildRegistry = (
  scan: CentralScan,
  coverageByRepo: Map<string, number>,
  qualityByRepo: Map<string, number>
): SecurityRegistry => {
  const repos = scan.repos
    .filter((r) => r.cloned)
    .map((r) =>
      buildRepoRisk(r, coverageByRepo.get(r.repo) ?? null, qualityByRepo.get(r.repo) ?? null)
    )
    .sort((a, b) => b.risk - a.risk || a.scorecard - b.scorecard);

  const gradeDistribution: Record<Grade, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const r of repos) gradeDistribution[r.grade]++;

  const avgScorecard =
    repos.length > 0
      ? Math.round((repos.reduce((s, r) => s + r.scorecard, 0) / repos.length) * 10) / 10
      : 0;

  return {
    date: scan.date,
    repos,
    summary: {
      avgScorecard,
      totalRisk: repos.reduce((s, r) => s + r.risk, 0),
      reposWithSecrets: repos.filter((r) => r.secrets > 0).length,
      reposOverDuplication: repos.filter(
        (r) => r.duplicationPct !== null && r.duplicationPct >= DUPLICATION_THRESHOLD_PCT
      ).length,
      gradeDistribution,
    },
  };
};

/** Per-repo, per-metric changes between two registries. */
export const diffRegistries = (
  prev: SecurityRegistry | null,
  curr: SecurityRegistry
): RegistryDelta[] => {
  if (!prev) return [];
  const prevByRepo = new Map(prev.repos.map((r) => [r.repo, r]));
  const metrics: (keyof RepoRisk)[] = ['secrets', 'sastErrors', 'criticalDeps', 'highDeps'];
  const deltas: RegistryDelta[] = [];

  for (const r of curr.repos) {
    const before = prevByRepo.get(r.repo);
    if (!before) continue;
    for (const m of metrics) {
      const from = before[m] as number;
      const to = r[m] as number;
      if (from === to) continue;
      const direction: RegistryDelta['direction'] =
        from === 0 && to > 0
          ? 'new'
          : to === 0 && from > 0
            ? 'resolved'
            : to > from
              ? 'worse'
              : 'better';
      deltas.push({ repo: r.name, metric: m, from, to, direction });
    }
  }
  return deltas;
};

// ---------------------------------------------------------------------------
// IO helpers (defensive)
// ---------------------------------------------------------------------------

const readJson = <T>(path: string): T | null => {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
};

const latestCoverageByRepo = (history: CoverageHistory | null): Map<string, number> => {
  const map = new Map<string, number>();
  if (!history?.entries.length) return map;
  const latest = history.entries[history.entries.length - 1];
  for (const r of latest.repos) {
    if (r.status === 'collected' && r.coverage) map.set(r.repo, r.coverage.lines);
  }
  return map;
};

const qualityByRepoMap = (q: QualityScores | null): Map<string, number> => {
  const map = new Map<string, number>();
  for (const s of q?.scores ?? []) map.set(s.repo, s.score);
  return map;
};

const REGISTRY_PATH = 'data/security-registry.json';
const HISTORY_PATH = 'data/security-registry-history.json';
const MAX_HISTORY = 52; // ~one year of weekly snapshots

const main = (): void => {
  const scan = readJson<CentralScan>('data/central-scan-latest.json');
  if (!scan) {
    console.log('No central-scan-latest.json — run the central scan first. Skipping.');
    return;
  }
  const coverage = latestCoverageByRepo(readJson<CoverageHistory>('data/coverage-history.json'));
  const quality = qualityByRepoMap(readJson<QualityScores>('dashboard/quality-scores.json'));
  const prev = readJson<SecurityRegistry>(REGISTRY_PATH);

  const registry = buildRegistry(scan, coverage, quality);
  const deltas = diffRegistries(prev, registry);

  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));

  // Append a compact snapshot to the history for trend charts
  const history = readJson<{ snapshots: unknown[] }>(HISTORY_PATH) ?? { snapshots: [] };
  history.snapshots.push({
    date: registry.date,
    avgScorecard: registry.summary.avgScorecard,
    totalRisk: registry.summary.totalRisk,
    reposWithSecrets: registry.summary.reposWithSecrets,
    gradeDistribution: registry.summary.gradeDistribution,
  });
  if (history.snapshots.length > MAX_HISTORY) {
    history.snapshots = history.snapshots.slice(-MAX_HISTORY);
  }
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));

  const resolved = deltas.filter((d) => d.direction === 'resolved').length;
  const newOnes = deltas.filter((d) => d.direction === 'new').length;
  console.log(
    `Security registry: ${registry.repos.length} repos, avg scorecard ${registry.summary.avgScorecard}/10, ` +
      `${registry.summary.totalRisk} risk pts, +${newOnes} new / -${resolved} resolved`
  );
  logActivity(
    'security-registry',
    'registry-updated',
    `avg ${registry.summary.avgScorecard}/10, ${registry.summary.totalRisk} risk pts, +${newOnes}/-${resolved}`,
    newOnes > 0 ? 'warning' : 'success'
  );
};

const isDirectRun =
  !process.env.VITEST && process.argv[1]?.replace(/\\/g, '/').endsWith('security-registry.ts');
if (isDirectRun) main();
