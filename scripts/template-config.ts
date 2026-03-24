/**
 * template-config.ts
 *
 * Per-repo template parameterization.
 * Loads .devops-config.json from each repo and renders {{placeholders}} in templates.
 *
 * Usage:
 *   import { loadRepoConfig, renderTemplate } from './template-config.js';
 *
 *   const config = loadRepoConfig('owner/repo');
 *   const rendered = renderTemplate(templateContent, config);
 */

import { getCached, setCache } from './cache-manager.js';
import { devNull } from './shell-utils.js';
import { execSync } from 'node:child_process';

export interface DevOpsConfig {
  nodeVersion: string;
  pnpmVersion: string;
  dotnetVersion: string;
  coverageThreshold: number;
  bundleBudgetKB: number;
  testTimeout: number;
}

export const DEFAULT_CONFIG: DevOpsConfig = {
  nodeVersion: '22',
  pnpmVersion: '9',
  dotnetVersion: '8.0.x',
  coverageThreshold: 80,
  bundleBudgetKB: 500,
  testTimeout: 60000,
};

const gh = (cmd: string): string => {
  try {
    return execSync(`gh ${cmd}`, { encoding: 'utf-8', timeout: 15_000 }).trim();
  } catch {
    return '';
  }
};

export const loadRepoConfig = (repo: string): DevOpsConfig => {
  const cacheKey = `devops-config-${repo}`;
  const cached = getCached<Partial<DevOpsConfig>>(cacheKey);

  if (cached !== null) {
    return { ...DEFAULT_CONFIG, ...cached };
  }

  const raw = gh(`api repos/${repo}/contents/.devops-config.json --jq ".content" 2>${devNull}`);

  if (!raw) {
    setCache(cacheKey, {});
    return { ...DEFAULT_CONFIG };
  }

  try {
    const decoded = Buffer.from(raw.replace(/\n/g, ''), 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded) as Partial<DevOpsConfig>;
    setCache(cacheKey, parsed);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    setCache(cacheKey, {});
    return { ...DEFAULT_CONFIG };
  }
};

export const renderTemplate = (template: string, config: DevOpsConfig): string => {
  const replacements: Record<string, string> = {
    '{{nodeVersion}}': config.nodeVersion,
    '{{pnpmVersion}}': config.pnpmVersion,
    '{{dotnetVersion}}': config.dotnetVersion,
    '{{coverageThreshold}}': String(config.coverageThreshold),
    '{{bundleBudgetKB}}': String(config.bundleBudgetKB),
    '{{testTimeout}}': String(config.testTimeout),
  };

  let result = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    result = result.replaceAll(placeholder, value);
  }
  return result;
};
