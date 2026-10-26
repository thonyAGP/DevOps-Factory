/**
 * sync-registry.ts
 *
 * Auto-discovers GitHub repos not yet in factory.config.ts
 * and adds them to KNOWN_PROJECTS. Runs after scan-and-configure.
 *
 * Run: pnpm sync-registry
 * Cron: wired into scan-repos.yml
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { KNOWN_PROJECTS, SCAN_CONFIG } from '../factory.config.js';
import { jq, devNull } from './shell-utils.js';
import {
  listAccessibleRepositories,
  isRepositoryActive,
  type Repository as GHRepo,
} from './repository-discovery.js';
import { logActivity } from './activity-logger.js';
import { batchFileExists } from './github-file-checker.js';
import { findKnownProjectsInsertPos } from './registry-insert.js';

const IGNORED_REPOS = [
  'DevOps-Factory',
  'Livret_accueil_Au-Marais', // legacy name, tracked as livret-au-marais
  ...SCAN_CONFIG.ignoredRepos,
];

const gh = (cmd: string): string => {
  try {
    return execSync(`gh ${cmd}`, { encoding: 'utf-8', timeout: 30_000 }).trim();
  } catch {
    return '';
  }
};

type Stack = 'nextjs' | 'node' | 'dotnet' | 'astro' | 'unknown';

const detectStack = (repo: GHRepo): Stack => {
  // Batch all file checks in 1 GraphQL query (instead of ~8 REST calls)
  const filePaths = [
    'package.json',
    'next.config.js',
    'next.config.mjs',
    'next.config.ts',
    'astro.config.mjs',
    'astro.config.ts',
  ];
  const batch = batchFileExists(repo.full_name, filePaths);
  const has = (p: string) => batch.get(p) ?? false;

  if (has('package.json')) {
    if (has('next.config.js') || has('next.config.mjs') || has('next.config.ts')) return 'nextjs';
    if (has('astro.config.mjs') || has('astro.config.ts')) return 'astro';
    return 'node';
  }

  if (repo.language === 'C#') return 'dotnet';

  // Wildcard *.csproj: falls back to REST inside batchFileExists
  const csprojBatch = batchFileExists(repo.full_name, ['*.csproj']);
  if (csprojBatch.get('*.csproj')) return 'dotnet';

  return 'unknown';
};

const detectFeatures = (repo: GHRepo) => {
  // Batch file checks in 1 GraphQL query (instead of 3 REST calls)
  const filePaths = ['.husky/pre-commit', 'renovate.json', '.github/renovate.json'];
  const batch = batchFileExists(repo.full_name, filePaths);
  const has = (p: string) => batch.get(p) ?? false;

  const workflows = gh(
    `api repos/${repo.full_name}/contents/.github/workflows --jq ${jq('.[].name')} 2>${devNull}`
  );

  const hasCI =
    workflows.includes('ci.yml') ||
    workflows.includes('CI') ||
    workflows.includes('build') ||
    workflows.includes('test');

  const hasSelfHealing = workflows.includes('self-healing');
  const hasHusky = has('.husky/pre-commit');
  const hasRenovate = has('renovate.json') || has('.github/renovate.json');
  const hasGitleaks = workflows.includes('gitleaks') || workflows.includes('secret');
  const hasLighthouse = workflows.includes('lighthouse');
  const hasLinkChecker = workflows.includes('link-checker');
  const hasQodo = workflows.includes('qodo');
  const hasClaude = workflows.includes('claude-review');

  return {
    hasCI,
    hasSelfHealing,
    hasHusky,
    hasRenovate,
    hasGitleaks,
    hasLighthouse,
    hasLinkChecker,
    hasQodo,
    hasClaude,
  };
};

const generateEntry = (
  repo: GHRepo,
  stack: Stack,
  features: ReturnType<typeof detectFeatures>
): string => {
  const lines = [
    `  {`,
    `    name: '${repo.name}',`,
    `    repo: '${repo.full_name}',`,
    `    hasCI: ${features.hasCI},`,
    `    stack: '${stack}',`,
    `    hasQodo: ${features.hasQodo},`,
    `    hasClaude: ${features.hasClaude},`,
    `    hasSelfHealing: ${features.hasSelfHealing},`,
    `    hasHusky: ${features.hasHusky},`,
    `    hasRenovate: ${features.hasRenovate},`,
    `    hasGitleaks: ${features.hasGitleaks},`,
    `    hasLighthouse: ${features.hasLighthouse},`,
    `    hasLinkChecker: ${features.hasLinkChecker},`,
    `    vercel: false,`,
    `    healingState: 'discovered',`,
    `  }`,
  ];
  return lines.join('\n');
};

const main = () => {
  console.log('🔄 sync-registry: Checking for new repos...\n');

  const knownRepoFullNames = new Set(KNOWN_PROJECTS.map((p) => p.repo.toLowerCase()));
  const knownNames = new Set(KNOWN_PROJECTS.map((p) => p.name.toLowerCase()));

  const repos = listAccessibleRepositories();

  const candidates = repos.filter(
    (r) =>
      !r.archived &&
      !r.fork &&
      !IGNORED_REPOS.includes(r.name) &&
      !knownRepoFullNames.has(r.full_name.toLowerCase()) &&
      !knownNames.has(r.name.toLowerCase())
  );

  if (candidates.length === 0) {
    console.log('✅ All repos already in factory.config.ts');
    return;
  }

  console.log(`🔍 Found ${candidates.length} repo(s) not in KNOWN_PROJECTS\n`);

  const newEntries: string[] = [];
  const addedNames: string[] = [];

  for (const repo of candidates) {
    if (!isRepositoryActive(repo)) {
      console.log(`  ⏭️  ${repo.name}: inactive (>90 days), skipping`);
      continue;
    }

    const stack = detectStack(repo);
    if (stack === 'unknown') {
      console.log(`  ⏭️  ${repo.name}: unknown stack, skipping`);
      continue;
    }

    const features = detectFeatures(repo);
    const entry = generateEntry(repo, stack, features);
    newEntries.push(entry);
    addedNames.push(repo.name);

    console.log(`  ✅ ${repo.name}: ${stack} → adding to registry`);
  }

  if (newEntries.length === 0) {
    console.log('\n✅ No active repos with known stack to add');
    return;
  }

  // Read factory.config.ts and insert new entries before the closing ];
  const configPath = 'factory.config.ts';
  const content = readFileSync(configPath, 'utf-8');

  const insertPos = findKnownProjectsInsertPos(content);
  if (insertPos === -1) {
    console.error('❌ Cannot find KNOWN_PROJECTS closing bracket in factory.config.ts');
    return;
  }

  writeFileSync(
    configPath,
    content.slice(0, insertPos) +
      newEntries.map((e) => e + ',').join('\n') +
      '\n' +
      content.slice(insertPos)
  );

  console.log(
    `\n🎉 Added ${newEntries.length} repo(s) to factory.config.ts: ${addedNames.join(', ')}`
  );

  logActivity(
    'scan-and-configure',
    'registry-sync',
    `Auto-added ${newEntries.length} repo(s): ${addedNames.join(', ')}`,
    'success'
  );
};

main();
