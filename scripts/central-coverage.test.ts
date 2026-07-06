/**
 * central-coverage.test.ts
 *
 * Unit tests for the central coverage measurement helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  parseCoverageSummary,
  applyMeasurements,
  type CoverageMeasurement,
} from './central-coverage.js';

describe('parseCoverageSummary', () => {
  it('extracts rounded percentages from a vitest json-summary', () => {
    const json = JSON.stringify({
      total: {
        lines: { pct: 72.345 },
        branches: { pct: 61.5 },
        functions: { pct: 80 },
        statements: { pct: 72.345 },
      },
    });
    expect(parseCoverageSummary(json)).toEqual({
      lines: 72.35,
      branches: 61.5,
      functions: 80,
      statements: 72.35,
    });
  });

  it('returns null on missing total or invalid JSON', () => {
    expect(parseCoverageSummary('{}')).toBeNull();
    expect(parseCoverageSummary('not json')).toBeNull();
  });
});

describe('applyMeasurements', () => {
  const measurement = (repo: string, lines: number): CoverageMeasurement => ({
    name: repo.split('/')[1],
    repo,
    stack: 'node',
    testFramework: 'vitest',
    hasTests: true,
    testFileCount: 10,
    coverage: { lines, branches: 50, functions: 50, statements: lines },
    status: 'collected',
  });

  const baselineEntry = (repo: string): CoverageMeasurement => ({
    name: repo.split('/')[1],
    repo,
    stack: 'node',
    hasTests: true,
    testFileCount: 10,
    status: 'no-coverage',
  });

  it('overrides the daily baseline entry for measured repos', () => {
    const history = {
      version: 1,
      lastUpdated: '',
      entries: [{ date: '2026-07-06', repos: [baselineEntry('o/a'), baselineEntry('o/b')] }],
    };
    const result = applyMeasurements(history, [measurement('o/a', 72)], '2026-07-06');
    const day = result.entries[0];
    expect(day.repos.find((r) => r.repo === 'o/a')?.status).toBe('collected');
    expect(day.repos.find((r) => r.repo === 'o/a')?.coverage?.lines).toBe(72);
    // unmeasured repo keeps its baseline entry
    expect(day.repos.find((r) => r.repo === 'o/b')?.status).toBe('no-coverage');
  });

  it('creates the day entry when none exists', () => {
    const history = { version: 1, lastUpdated: '', entries: [] };
    const result = applyMeasurements(history, [measurement('o/a', 60)], '2026-07-07');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].date).toBe('2026-07-07');
    expect(result.entries[0].repos).toHaveLength(1);
  });

  it('appends measured repos missing from the day entry', () => {
    const history = {
      version: 1,
      lastUpdated: '',
      entries: [{ date: '2026-07-06', repos: [baselineEntry('o/a')] }],
    };
    const result = applyMeasurements(history, [measurement('o/new', 55)], '2026-07-06');
    expect(result.entries[0].repos.map((r) => r.repo)).toEqual(['o/a', 'o/new']);
  });

  it('does not touch other days', () => {
    const history = {
      version: 1,
      lastUpdated: '',
      entries: [
        { date: '2026-07-01', repos: [baselineEntry('o/a')] },
        { date: '2026-07-06', repos: [baselineEntry('o/a')] },
      ],
    };
    const result = applyMeasurements(history, [measurement('o/a', 72)], '2026-07-06');
    expect(result.entries[0].repos[0].status).toBe('no-coverage');
    expect(result.entries[1].repos[0].status).toBe('collected');
  });
});
