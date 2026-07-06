/**
 * central-scan.test.ts
 *
 * Unit tests for central-scan.ts parsers and report builder.
 */

import { describe, it, expect } from 'vitest';
import {
  parseGitleaks,
  parseSemgrep,
  parseTrivy,
  buildReport,
  totalFindings,
  semgrepConfigsForStack,
  type RepoScanResult,
} from './central-scan.js';

describe('semgrepConfigsForStack', () => {
  it('includes nextjs rulesets for nextjs stack', () => {
    expect(semgrepConfigsForStack('nextjs')).toContain('p/nextjs');
    expect(semgrepConfigsForStack('nextjs')).toContain('p/react');
  });

  it('includes csharp ruleset for dotnet stack', () => {
    expect(semgrepConfigsForStack('dotnet')).toContain('p/csharp');
  });

  it('falls back to owasp-top-ten for unknown stack', () => {
    expect(semgrepConfigsForStack('unknown')).toBe('--config p/owasp-top-ten');
  });

  it('always includes owasp-top-ten', () => {
    for (const stack of ['nextjs', 'fastify', 'astro', 'dotnet', 'node', 'unknown'] as const) {
      expect(semgrepConfigsForStack(stack)).toContain('p/owasp-top-ten');
    }
  });
});

describe('parseGitleaks', () => {
  it('reports clean on empty array', () => {
    const result = parseGitleaks('[]');
    expect(result.status).toBe('clean');
    expect(result.findings).toBe(0);
  });

  it('counts leaks and summarizes location', () => {
    const json = JSON.stringify([
      { RuleID: 'aws-access-key', File: 'src/config.ts', StartLine: 12 },
      { RuleID: 'generic-api-key', File: '.env.example', StartLine: 3 },
    ]);
    const result = parseGitleaks(json);
    expect(result.status).toBe('findings');
    expect(result.findings).toBe(2);
    expect(result.bySeverity).toEqual({ SECRET: 2 });
    expect(result.top[0]).toBe('aws-access-key in src/config.ts:12');
  });

  it('returns error on invalid JSON', () => {
    expect(parseGitleaks('not json').status).toBe('error');
  });

  it('returns error on non-array JSON', () => {
    expect(parseGitleaks('{"foo": 1}').status).toBe('error');
  });

  it('caps top findings at 5', () => {
    const leaks = Array.from({ length: 10 }, (_, i) => ({
      RuleID: 'key',
      File: `f${i}.ts`,
      StartLine: i,
    }));
    const result = parseGitleaks(JSON.stringify(leaks));
    expect(result.findings).toBe(10);
    expect(result.top).toHaveLength(5);
  });
});

describe('parseSemgrep', () => {
  it('reports clean when no results', () => {
    expect(parseSemgrep('{"results": []}').status).toBe('clean');
  });

  it('groups findings by severity', () => {
    const json = JSON.stringify({
      results: [
        {
          check_id: 'ts.sql-injection',
          path: 'src/db.ts',
          start: { line: 42 },
          extra: { severity: 'ERROR' },
        },
        {
          check_id: 'ts.weak-hash',
          path: 'src/auth.ts',
          start: { line: 7 },
          extra: { severity: 'WARNING' },
        },
        {
          check_id: 'ts.weak-hash',
          path: 'src/auth2.ts',
          start: { line: 9 },
          extra: { severity: 'WARNING' },
        },
      ],
    });
    const result = parseSemgrep(json);
    expect(result.status).toBe('findings');
    expect(result.findings).toBe(3);
    expect(result.bySeverity).toEqual({ ERROR: 1, WARNING: 2 });
    expect(result.top[0]).toBe('ts.sql-injection in src/db.ts:42');
  });

  it('returns error on invalid JSON', () => {
    expect(parseSemgrep('<html>').status).toBe('error');
  });
});

describe('parseTrivy', () => {
  it('reports clean on empty results', () => {
    expect(parseTrivy('{"Results": []}').status).toBe('clean');
  });

  it('counts vulnerabilities and misconfigurations', () => {
    const json = JSON.stringify({
      Results: [
        {
          Target: 'pnpm-lock.yaml',
          Vulnerabilities: [
            { VulnerabilityID: 'CVE-2024-1234', PkgName: 'lodash', Severity: 'HIGH' },
            { VulnerabilityID: 'CVE-2024-5678', PkgName: 'axios', Severity: 'CRITICAL' },
          ],
        },
        {
          Target: 'Dockerfile',
          Misconfigurations: [{ ID: 'DS002', Title: 'root user', Severity: 'HIGH' }],
        },
      ],
    });
    const result = parseTrivy(json);
    expect(result.status).toBe('findings');
    expect(result.findings).toBe(3);
    expect(result.bySeverity).toEqual({ HIGH: 2, CRITICAL: 1 });
    expect(result.top).toContain('CVE-2024-1234 lodash (HIGH)');
  });

  it('returns error on invalid JSON', () => {
    expect(parseTrivy('oops').status).toBe('error');
  });
});

describe('totalFindings / buildReport', () => {
  const results: RepoScanResult[] = [
    {
      name: 'CasaSync',
      repo: 'thonyAGP/CasaSync',
      stack: 'nextjs',
      cloned: true,
      scanners: [
        { scanner: 'gitleaks', status: 'clean', findings: 0, bySeverity: {}, top: [] },
        {
          scanner: 'semgrep',
          status: 'findings',
          findings: 2,
          bySeverity: { ERROR: 2 },
          top: ['ts.sql-injection in src/db.ts:42'],
        },
        { scanner: 'trivy', status: 'clean', findings: 0, bySeverity: {}, top: [] },
      ],
    },
    {
      name: 'Zentra',
      repo: 'thonyAGP/zentra',
      stack: 'nextjs',
      cloned: false,
      scanners: [],
    },
  ];

  it('sums findings across repos and scanners', () => {
    expect(totalFindings(results)).toBe(2);
  });

  it('builds a report with summary table and details', () => {
    const report = buildReport(results, '2026-07-06');
    expect(report).toContain('Central Security Scan - 2026-07-06');
    expect(report).toContain('**Total findings: 2**');
    expect(report).toContain('| CasaSync |');
    expect(report).toContain('🔴 2');
    expect(report).toContain('clone failed');
    expect(report).toContain('ts.sql-injection in src/db.ts:42');
  });

  it('omits details section for clean repos', () => {
    const clean: RepoScanResult[] = [
      {
        name: 'CleanRepo',
        repo: 'thonyAGP/CleanRepo',
        stack: 'node',
        cloned: true,
        scanners: [{ scanner: 'gitleaks', status: 'clean', findings: 0, bySeverity: {}, top: [] }],
      },
    ];
    const report = buildReport(clean, '2026-07-06');
    expect(report).not.toContain('<details>');
    expect(report).toContain('**Total findings: 0**');
  });
});
