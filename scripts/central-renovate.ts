/**
 * central-renovate.ts
 *
 * Generates the global config for the self-hosted Renovate run
 * (.github/workflows/renovate.yml). Renovate runs FROM the public Factory
 * repo (free Actions minutes) against every managed repo with FACTORY_PAT —
 * no Mend app install and no per-repo renovate.json required
 * (requireConfig: optional — a repo-level renovate.json still wins if present).
 *
 * Repo defaults are inherited from templates/renovate.json so per-repo and
 * central behavior stay identical (grouping, automerge, security alerts).
 *
 * Usage: pnpm renovate-config [-- --out /tmp/renovate-config.json]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { KNOWN_PROJECTS, type ProjectConfig } from '../factory.config.js';

const TEMPLATE_PATH = 'templates/renovate.json';

export interface RenovateGlobalConfig {
  platform: string;
  onboarding: boolean;
  requireConfig: string;
  repositories: string[];
  gitAuthor: string;
  osvVulnerabilityAlerts: boolean;
  [key: string]: unknown;
}

/** All managed repos — hidden ones included: their dependencies rot too. */
export const renovateRepositories = (projects: ProjectConfig[]): string[] =>
  projects.map((p) => p.repo);

export const buildRenovateConfig = (
  projects: ProjectConfig[],
  templateJson: string
): RenovateGlobalConfig => {
  const defaults = JSON.parse(templateJson) as Record<string, unknown>;
  delete defaults['$schema'];

  return {
    // Admin/self-hosted options
    platform: 'github',
    onboarding: false,
    requireConfig: 'optional',
    repositories: renovateRepositories(projects),
    gitAuthor: 'DevOps Factory Bot <devops-factory[bot]@users.noreply.github.com>',
    // Security updates from the OSV database, independent of GitHub
    // Dependabot alerts (which private repos may not have enabled)
    osvVulnerabilityAlerts: true,
    // Repo-config defaults inherited from the per-repo template
    ...defaults,
  };
};

const main = (): void => {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : '/tmp/renovate-config.json';

  const config = buildRenovateConfig(KNOWN_PROJECTS, readFileSync(TEMPLATE_PATH, 'utf-8'));
  writeFileSync(outPath, JSON.stringify(config, null, 2));
  console.log(`Renovate config written to ${outPath} (${config.repositories.length} repos)`);
};

const isDirectRun =
  !process.env.VITEST && process.argv[1]?.replace(/\\/g, '/').endsWith('central-renovate.ts');
if (isDirectRun) main();
