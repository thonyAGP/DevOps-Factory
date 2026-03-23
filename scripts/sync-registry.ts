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
import { getCached, setCache } from './cache-manager.js';
import { logActivity } from './activity-logger.js';

interface GHRepo {
  name: string;
  full_name: string;
  default_branch: string;
  archived: boolean;
  fork: boolean;
  language: string | null;
}

const IGNORED_REPOS = [
  'DevOps-Factory',
  'Livret_accueil_Au-Marais', // legacy name, tracked as livret-au-marais
  ...SCAN_CONFIG.ignoredRepos,
];

const INACTIVE_THRESHOLD_DAYS = 90;

const gh = (cmd: string): string => {
  try {
    return execSync(`gh ${cmd}`, { encoding: 'utf-8', timeout: 30_000 }).trim();
  } catch {
    return '';
  }
};

const ghJson = <T>(cmd: string): T => {
  const result = gh(cmd);
  return JSON.parse(result || '[]') as T;
};

const isActive = (repo: GHRepo): boolean => {
  const cacheKey = `active-${repo.name}`;
  const cached = getCached<boolean>(cacheKey);
  if (cached !== null) return cached;

  const lastPush = gh(`api repos/${repo.full_name} --jq .pushed_at`);
  if (!lastPush) {
    setCache(cacheKey, false);
    return false;
  }

  const daysSince = (Date.now() - new Date(lastPush).getTime()) / 86400000;
  const active = daysSince < INACTIVE_THRESHOLD_DAYS;
  setCache(cacheKey, active);
  return active;
};

const fileExistsInRepo = (repo: string, path: string): boolean => {
  const cacheKey = `file-exists-${repo}-${path}`;
  const cached = getCached<boolean>(cacheKey);
  if (cached !== null) return cached;

  const result = gh(`api repos/${repo}/contents/${path} --jq ${jq('.name')} 2>${devNull}`);
  const exists = result.length > 0;
  setCache(cacheKey, exists);
  return exists;
};

type Stack = 'nextjs' | 'node' | 'dotnet' | 'astro' | 'unknown';

const detectStack = (repo: GHRepo): Stack => {
  const hasPackageJson = fileExistsInRepo(repo.full_name, 'package.json');

  if (hasPackageJson) {
    const hasNextConfig =
      fileExistsInRepo(repo.full_name, 'next.config.js') ||
      fileExistsInRepo(repo.full_name, 'next.config.mjs') ||
      fileExistsInRepo(repo.full_name, 'next.config.ts');

    if (hasNextConfig) return 'nextjs';

    const hasAstroConfig =
      fileExistsInRepo(repo.full_name, 'astro.config.mjs') ||
      fileExistsInRepo(repo.full_name, 'astro.config.ts');

    if (hasAstroConfig) return 'astro';

    return 'node';
  }

  if (repo.language === 'C#' || fileExistsInRepo(repo.full_name, '*.csproj')) {
    return 'dotnet';
  }

  return 'unknown';
};

const detectFeatures = (repo: GHRepo) => {
  const workflows = gh(
    `api repos/${repo.full_name}/contents/.github/workflows --jq ${jq('.[].name')} 2>${devNull}`
  );

  const hasCI =
    workflows.includes('ci.yml') ||
    workflows.includes('CI') ||
    workflows.includes('build') ||
    workflows.includes('test');

  const hasSelfHealing = workflows.includes('self-healing');
  const hasHusky = fileExistsInRepo(repo.full_name, '.husky/pre-commit');
  const hasRenovate =
    fileExistsInRepo(repo.full_name, 'renovate.json') ||
    fileExistsInRepo(repo.full_name, '.github/renovate.json');
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

  const cacheKey = 'repos-list';
  let repos = getCached<GHRepo[]>(cacheKey);

  if (!repos) {
    console.log('📡 Fetching repos from GitHub API...');
    repos = ghJson<GHRepo[]>(
      'api user/repos --paginate --jq "[.[] | {name, full_name, default_branch, archived, fork, language}]"'
    );
    setCache(cacheKey, repos);
  }

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
    if (!isActive(repo)) {
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

  // Find the last entry closing brace + comma before ];
  const closingPattern = /(\n\];)\s*\n\nexport const GITHUB_OWNER/;
  const match = content.match(closingPattern);

  if (!match) {
    // Fallback: find the KNOWN_PROJECTS closing ];
    const fallbackPattern = /^];\s*$/m;
    const fallbackMatch = content.match(fallbackPattern);
    if (!fallbackMatch || fallbackMatch.index === undefined) {
      console.error('❌ Cannot find KNOWN_PROJECTS closing bracket in factory.config.ts');
      return;
    }

    const insertPos = fallbackMatch.index;
    const newContent =
      content.slice(0, insertPos) +
      newEntries.map((e) => e + ',').join('\n') +
      '\n' +
      content.slice(insertPos);

    writeFileSync(configPath, newContent);
  } else {
    const insertPos = match.index ?? 0;
    const newContent =
      content.slice(0, insertPos) +
      '\n' +
      newEntries.map((e) => e + ',').join('\n') +
      content.slice(insertPos);

    writeFileSync(configPath, newContent);
  }

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
