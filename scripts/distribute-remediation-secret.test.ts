/**
 * distribute-remediation-secret.test.ts
 *
 * The IO (gh secret set) is not unit-tested, but target selection — which
 * repos receive the secret — is pure and covered here.
 */

import { describe, it, expect } from 'vitest';
import { selectSecretTargets } from './distribute-remediation-secret.js';
import type { ProjectConfig } from '../factory.config.js';

const p = (name: string, hidden = false): ProjectConfig =>
  ({
    name,
    repo: `thonyAGP/${name}`,
    hasCI: false,
    stack: 'node',
    hasQodo: false,
    hasClaude: false,
    hasSelfHealing: false,
    hasHusky: false,
    hasRenovate: false,
    hasGitleaks: false,
    hasLighthouse: false,
    hasLinkChecker: false,
    vercel: false,
    ...(hidden ? { hidden: true } : {}),
  }) as ProjectConfig;

const projects = [p('Alpha'), p('Beta'), p('Secret', true)];

describe('selectSecretTargets', () => {
  it('returns all non-hidden repos by default', () => {
    expect(selectSecretTargets(projects).map((r) => r.name)).toEqual(['Alpha', 'Beta']);
  });

  it('includes hidden repos when asked', () => {
    expect(selectSecretTargets(projects, { includeHidden: true }).map((r) => r.name)).toEqual([
      'Alpha',
      'Beta',
      'Secret',
    ]);
  });

  it('restricts to --only by short name (case-insensitive)', () => {
    expect(selectSecretTargets(projects, { only: ['alpha'] }).map((r) => r.name)).toEqual([
      'Alpha',
    ]);
  });

  it('restricts to --only by full owner/name', () => {
    expect(selectSecretTargets(projects, { only: ['thonyAGP/Beta'] }).map((r) => r.name)).toEqual([
      'Beta',
    ]);
  });

  it('empty --only behaves as no filter', () => {
    expect(selectSecretTargets(projects, { only: [] }).map((r) => r.name)).toEqual([
      'Alpha',
      'Beta',
    ]);
  });

  it('--only does not resurrect a hidden repo unless includeHidden', () => {
    expect(selectSecretTargets(projects, { only: ['Secret'] })).toEqual([]);
    expect(
      selectSecretTargets(projects, { only: ['Secret'], includeHidden: true }).map((r) => r.name)
    ).toEqual(['Secret']);
  });
});
