/**
 * security-registry.test.ts
 *
 * Unit tests for the security registry pure functions.
 */

import { describe, it, expect } from 'vitest';
import {
  severityWeight,
  gradeFromRisk,
  buildRepoRisk,
  buildRegistry,
  diffRegistries,
  type SecurityRegistry,
} from './security-registry.js';

const scanRepo = (over: Partial<Parameters<typeof buildRepoRisk>[0]> = {}) => ({
  name: 'X',
  repo: 'thonyAGP/X',
  cloned: true,
  scanners: [],
  ...over,
});

describe('severityWeight', () => {
  it('weights secrets and critical highest', () => {
    expect(severityWeight('SECRET')).toBe(10);
    expect(severityWeight('CRITICAL')).toBe(10);
  });
  it('weights high/error at 5, medium/warning at 1', () => {
    expect(severityWeight('HIGH')).toBe(5);
    expect(severityWeight('ERROR')).toBe(5);
    expect(severityWeight('WARNING')).toBe(1);
  });
  it('excludes duplication from risk points', () => {
    expect(severityWeight('DUPLICATION')).toBe(0);
  });
  it('is case-insensitive and defaults unknown to 1', () => {
    expect(severityWeight('high')).toBe(5);
    expect(severityWeight('mystery')).toBe(1);
  });
});

describe('gradeFromRisk', () => {
  it('maps risk bands to grades', () => {
    expect(gradeFromRisk(0)).toBe('A');
    expect(gradeFromRisk(5)).toBe('B');
    expect(gradeFromRisk(20)).toBe('C');
    expect(gradeFromRisk(50)).toBe('D');
    expect(gradeFromRisk(100)).toBe('F');
  });
});

describe('buildRepoRisk', () => {
  it('computes weighted risk from secrets, SAST errors and vulnerable deps', () => {
    const scan = scanRepo({
      scanners: [
        {
          scanner: 'gitleaks',
          status: 'findings',
          findings: 2,
          bySeverity: { SECRET: 2 },
          top: [],
        },
        {
          scanner: 'semgrep',
          status: 'findings',
          findings: 3,
          bySeverity: { ERROR: 1, WARNING: 2 },
          top: [],
        },
        {
          scanner: 'trivy',
          status: 'findings',
          findings: 4,
          bySeverity: { CRITICAL: 1, HIGH: 3 },
          top: [],
        },
        {
          scanner: 'jscpd',
          status: 'findings',
          findings: 5,
          bySeverity: { DUPLICATION: 5 },
          top: [],
          metrics: { duplicationPct: 12 },
        },
      ],
    });
    const r = buildRepoRisk(scan, 40, 70);
    // 2*10 (secrets) + 1*5 (ERROR) + 1*10 (CRITICAL) + 3*5 (HIGH) = 50
    expect(r.risk).toBe(50);
    expect(r.grade).toBe('D');
    expect(r.secrets).toBe(2);
    expect(r.criticalDeps).toBe(1);
    expect(r.highDeps).toBe(3);
    expect(r.duplicationPct).toBe(12);
    expect(r.coveragePct).toBe(40);
  });

  it('does not count WARNING/duplication toward risk', () => {
    const scan = scanRepo({
      scanners: [
        {
          scanner: 'semgrep',
          status: 'findings',
          findings: 5,
          bySeverity: { WARNING: 5 },
          top: [],
        },
        {
          scanner: 'jscpd',
          status: 'findings',
          findings: 9,
          bySeverity: { DUPLICATION: 9 },
          top: [],
          metrics: { duplicationPct: 20 },
        },
      ],
    });
    expect(buildRepoRisk(scan, null, null).risk).toBe(0);
  });

  it('produces a perfect scorecard for a clean repo', () => {
    const scan = scanRepo({
      scanners: [
        { scanner: 'gitleaks', status: 'clean', findings: 0, bySeverity: {}, top: [] },
        { scanner: 'semgrep', status: 'clean', findings: 0, bySeverity: {}, top: [] },
        { scanner: 'trivy', status: 'clean', findings: 0, bySeverity: {}, top: [] },
        {
          scanner: 'jscpd',
          status: 'clean',
          findings: 0,
          bySeverity: {},
          top: [],
          metrics: { duplicationPct: 1 },
        },
      ],
    });
    const r = buildRepoRisk(scan, 85, 90);
    expect(r.scorecard).toBe(10);
    expect(r.grade).toBe('A');
    expect(r.reasons).toEqual([]);
  });

  it('deducts scorecard points with explanatory reasons', () => {
    const scan = scanRepo({
      scanners: [
        {
          scanner: 'gitleaks',
          status: 'findings',
          findings: 1,
          bySeverity: { SECRET: 1 },
          top: [],
        },
        { scanner: 'trivy', status: 'findings', findings: 1, bySeverity: { CRITICAL: 1 }, top: [] },
        {
          scanner: 'jscpd',
          status: 'findings',
          findings: 1,
          bySeverity: { DUPLICATION: 1 },
          top: [],
          metrics: { duplicationPct: 8 },
        },
      ],
    });
    const r = buildRepoRisk(scan, 30, 50);
    // 10 - 4 (secret) - 2 (critical) - 1 (dup) - 1 (coverage) = 2
    expect(r.scorecard).toBe(2);
    expect(r.reasons).toHaveLength(4);
    expect(r.reasons.some((x) => x.includes('secret'))).toBe(true);
    expect(r.reasons.some((x) => x.includes('couverture'))).toBe(true);
  });

  it('floors the scorecard at zero when every weakness applies', () => {
    const scan = scanRepo({
      scanners: [
        {
          scanner: 'gitleaks',
          status: 'findings',
          findings: 9,
          bySeverity: { SECRET: 9 },
          top: [],
        },
        { scanner: 'semgrep', status: 'findings', findings: 9, bySeverity: { ERROR: 9 }, top: [] },
        { scanner: 'trivy', status: 'findings', findings: 9, bySeverity: { CRITICAL: 9 }, top: [] },
        {
          scanner: 'jscpd',
          status: 'findings',
          findings: 9,
          bySeverity: { DUPLICATION: 9 },
          top: [],
          metrics: { duplicationPct: 40 },
        },
      ],
    });
    // 10 - 4 - 2 - 2 - 1 (dup) - 1 (coverage) = 0, and never negative
    expect(buildRepoRisk(scan, 0, 0).scorecard).toBe(0);
  });
});

describe('buildRegistry', () => {
  const scan = {
    date: '2026-07-06',
    repos: [
      scanRepo({
        name: 'Risky',
        repo: 'o/risky',
        scanners: [
          {
            scanner: 'gitleaks',
            status: 'findings',
            findings: 3,
            bySeverity: { SECRET: 3 },
            top: [],
          },
        ],
      }),
      scanRepo({ name: 'Clean', repo: 'o/clean', scanners: [] }),
      scanRepo({ name: 'Skipped', repo: 'o/skipped', cloned: false, scanners: [] }),
    ],
  };

  it('excludes repos that failed to clone and sorts by risk', () => {
    const reg = buildRegistry(scan, new Map(), new Map());
    expect(reg.repos.map((r) => r.name)).toEqual(['Risky', 'Clean']);
    expect(reg.repos[0].risk).toBeGreaterThan(reg.repos[1].risk);
  });

  it('summarizes fleet posture', () => {
    const reg = buildRegistry(scan, new Map(), new Map());
    expect(reg.summary.reposWithSecrets).toBe(1);
    expect(reg.summary.gradeDistribution.A).toBe(1); // Clean
    expect(reg.summary.totalRisk).toBe(30);
    expect(reg.summary.avgScorecard).toBeLessThan(10);
  });
});

describe('diffRegistries', () => {
  const reg = (repo: string, secrets: number, criticalDeps: number): SecurityRegistry => ({
    date: 'd',
    repos: [
      {
        name: repo,
        repo,
        risk: 0,
        scorecard: 10,
        grade: 'A',
        secrets,
        sastErrors: 0,
        criticalDeps,
        highDeps: 0,
        duplicationPct: null,
        coveragePct: null,
        reasons: [],
      },
    ],
    summary: {
      avgScorecard: 10,
      totalRisk: 0,
      reposWithSecrets: 0,
      reposOverDuplication: 0,
      gradeDistribution: { A: 1, B: 0, C: 0, D: 0, F: 0 },
    },
  });

  it('returns no deltas without a previous registry', () => {
    expect(diffRegistries(null, reg('o/a', 1, 0))).toEqual([]);
  });

  it('flags newly introduced and resolved findings', () => {
    const deltas = diffRegistries(reg('o/a', 0, 2), reg('o/a', 3, 0));
    expect(deltas.find((d) => d.metric === 'secrets')?.direction).toBe('new');
    expect(deltas.find((d) => d.metric === 'criticalDeps')?.direction).toBe('resolved');
  });

  it('distinguishes worse from better on non-zero changes', () => {
    const deltas = diffRegistries(reg('o/a', 2, 0), reg('o/a', 5, 0));
    expect(deltas[0].direction).toBe('worse');
    const deltas2 = diffRegistries(reg('o/a', 5, 0), reg('o/a', 2, 0));
    expect(deltas2[0].direction).toBe('better');
  });
});
