/**
 * remediation-dispatch.test.ts
 *
 * Unit tests for the remediation target-selection policy. The guardrails are
 * the whole point, so they are tested explicitly.
 */

import { describe, it, expect } from 'vitest';
import { selectRemediationTargets } from './remediation-dispatch.js';
import type { RemediationConfig } from '../factory.config.js';

type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

const repo = (name: string, grade: Grade, risk: number) => ({
  name,
  repo: `thonyAGP/${name}`,
  risk,
  grade,
  reasons: [],
});

const registry = {
  date: 'd',
  repos: [repo('F1', 'F', 300), repo('F2', 'F', 100), repo('D1', 'D', 50), repo('A1', 'A', 0)],
};

const config = (over: Partial<RemediationConfig> = {}): RemediationConfig => ({
  enabled: true,
  enabledRepos: ['thonyAGP/F1', 'thonyAGP/F2', 'thonyAGP/D1'],
  minGrade: 'F',
  maxPerDay: 2,
  workflowFile: 'ai-remediation.yml',
  ...over,
});

describe('selectRemediationTargets — guardrails', () => {
  it('returns nothing when remediation is disabled', () => {
    expect(selectRemediationTargets(registry, config({ enabled: false }), 5)).toEqual([]);
  });

  it('returns nothing when the allowlist is empty (opt-in safety)', () => {
    expect(selectRemediationTargets(registry, config({ enabledRepos: [] }), 5)).toEqual([]);
  });

  it('never selects a repo outside the allowlist', () => {
    const cfg = config({ enabledRepos: ['thonyAGP/F1'] });
    const got = selectRemediationTargets(registry, cfg, 5);
    expect(got.map((r) => r.name)).toEqual(['F1']);
  });

  it('respects the grade threshold (F only by default)', () => {
    const got = selectRemediationTargets(registry, config(), 5);
    // D1 is allowlisted but grade D < F threshold → excluded
    expect(got.map((r) => r.name)).toEqual(['F1', 'F2']);
  });

  it('includes D when the threshold is lowered to D', () => {
    const got = selectRemediationTargets(registry, config({ minGrade: 'D' }), 5);
    expect(got.map((r) => r.name)).toContain('D1');
  });

  it('orders worst-risk first', () => {
    const got = selectRemediationTargets(registry, config({ minGrade: 'D' }), 5);
    expect(got.map((r) => r.risk)).toEqual([300, 100, 50]);
  });

  it('caps at the remaining daily quota', () => {
    expect(selectRemediationTargets(registry, config(), 1).map((r) => r.name)).toEqual(['F1']);
  });

  it('returns nothing when the quota is exhausted', () => {
    expect(selectRemediationTargets(registry, config(), 0)).toEqual([]);
  });
});
