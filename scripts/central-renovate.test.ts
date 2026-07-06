/**
 * central-renovate.test.ts
 *
 * Unit tests for the central Renovate config generator.
 */

import { describe, it, expect } from 'vitest';
import { buildRenovateConfig, renovateRepositories } from './central-renovate.js';
import type { ProjectConfig } from '../factory.config.js';

const project = (over: Partial<ProjectConfig>): ProjectConfig => ({
  name: 'X',
  repo: 'thonyAGP/X',
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
  ...over,
});

const TEMPLATE = JSON.stringify({
  $schema: 'https://docs.renovatebot.com/renovate-schema.json',
  extends: ['config:recommended'],
  automerge: false,
  packageRules: [{ matchUpdateTypes: ['patch'], automerge: true }],
});

describe('renovateRepositories', () => {
  it('includes every managed repo, hidden ones too', () => {
    const repos = renovateRepositories([
      project({ repo: 'thonyAGP/A' }),
      project({ repo: 'thonyAGP/B', hidden: true }),
    ]);
    expect(repos).toEqual(['thonyAGP/A', 'thonyAGP/B']);
  });
});

describe('buildRenovateConfig', () => {
  const config = buildRenovateConfig([project({ repo: 'thonyAGP/A' })], TEMPLATE);

  it('sets self-hosted admin options', () => {
    expect(config.platform).toBe('github');
    expect(config.onboarding).toBe(false);
    expect(config.requireConfig).toBe('optional');
    expect(config.repositories).toEqual(['thonyAGP/A']);
    expect(config.osvVulnerabilityAlerts).toBe(true);
  });

  it('inherits repo defaults from the template', () => {
    expect(config.extends).toEqual(['config:recommended']);
    expect(config.packageRules).toHaveLength(1);
  });

  it('strips the JSON schema pointer', () => {
    expect(config['$schema']).toBeUndefined();
  });
});
