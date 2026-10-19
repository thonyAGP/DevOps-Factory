/**
 * github-file-checker.ts
 *
 * Batch file existence checks via GitHub GraphQL API.
 * Replaces N REST calls per repo with 1 GraphQL query.
 *
 * Usage:
 *   import { batchFileExists, fileExistsInRepo } from './github-file-checker.js';
 *
 *   const results = batchFileExists('owner/repo', ['package.json', '.husky/pre-commit']);
 *   // Map<string, boolean>
 *
 *   const exists = fileExistsInRepo('owner/repo', 'package.json');
 *   // boolean (uses batch internally, cached)
 */

import { execFileSync } from 'node:child_process';
import { getCached, setCache } from './cache-manager.js';
const gh = (args: string[]): string =>
  execFileSync('gh', args, {
    encoding: 'utf-8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

/**
 * Check if a path contains wildcard characters that can't be resolved via GraphQL.
 */
const isWildcard = (path: string): boolean => path.includes('*');

/**
 * Check a single file via REST API (fallback for wildcards).
 */
const restFileExists = (repo: string, path: string): boolean => {
  // Contents paths do not support globs. List their parent instead.
  const slash = path.lastIndexOf('/');
  const parent = slash < 0 ? '' : path.slice(0, slash);
  const name = path.slice(slash + 1);
  const pattern = new RegExp(`^${name.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  const entries: Array<{ name: string; type: string }> = JSON.parse(
    gh(['api', `repos/${repo}/contents/${parent}`])
  );
  if (!Array.isArray(entries)) throw new Error(`Invalid directory response for ${repo}`);
  return entries.some((entry) => entry.type === 'file' && pattern.test(entry.name));
};

/**
 * Build a GraphQL query to check multiple files in one request.
 * Uses repository object expressions: "HEAD:path/to/file"
 */
export const buildGraphQLQuery = (owner: string, repo: string, paths: string[]): string => {
  const fields = paths
    .map((p, i) => `f${i}: object(expression: ${JSON.stringify(`HEAD:${p}`)}) { ... on Blob { byteSize } }`)
    .join('\n    ');

  return `query {
  repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) {
    ${fields}
  }
}`;
};

/**
 * Parse GraphQL response into a Map of path -> exists.
 */
export const parseGraphQLResponse = (response: string, paths: string[]): Map<string, boolean> => {
  const results = new Map<string, boolean>();

  const data = JSON.parse(response);
  const repoData = data?.data?.repository;
  if (data.errors?.length || !repoData || typeof repoData !== 'object') {
    throw new Error('GitHub file query failed; file presence is unknown');
  }
  for (let i = 0; i < paths.length; i++) {
    const field = `f${i}`;
    if (!Object.prototype.hasOwnProperty.call(repoData, field)) {
      throw new Error('Incomplete GitHub file query; file presence is unknown');
    }
    results.set(paths[i], repoData[field] !== null);
  }

  return results;
};

/**
 * Batch check file existence via GraphQL.
 * Wildcards (*.csproj) fall back to REST API.
 * Results are cached individually.
 *
 * @returns Map<string, boolean> - path -> exists
 */
export const batchFileExists = (repo: string, paths: string[]): Map<string, boolean> => {
  const results = new Map<string, boolean>();
  const uncached: string[] = [];
  const wildcardPaths: string[] = [];

  // 1. Check cache + separate wildcards
  for (const p of paths) {
    const cacheKey = `file-exists-v2-${repo}-${p}`;
    const cached = getCached<boolean>(cacheKey);
    if (cached !== null) {
      results.set(p, cached);
    } else if (isWildcard(p)) {
      wildcardPaths.push(p);
    } else {
      uncached.push(p);
    }
  }

  // 2. Handle wildcards via REST (no GraphQL glob support)
  for (const p of wildcardPaths) {
    const exists = restFileExists(repo, p);
    setCache(`file-exists-v2-${repo}-${p}`, exists);
    results.set(p, exists);
  }

  // 3. Batch check remaining via GraphQL
  if (uncached.length > 0) {
    const [owner, repoName] = repo.split('/');
    const query = buildGraphQLQuery(owner, repoName, uncached);

    // Pass the original newlines as one argument, without a shell.
    const response = gh(['api', 'graphql', '-f', `query=${query}`]);

    const graphqlResults = parseGraphQLResponse(response, uncached);

    for (const [path, exists] of graphqlResults) {
      setCache(`file-exists-v2-${repo}-${path}`, exists);
      results.set(path, exists);
    }
  }

  return results;
};

/**
 * Check if a single file exists in a repo.
 * Uses cache, falls back to REST for wildcards or single-file checks.
 * For batch operations, prefer batchFileExists().
 */
export const fileExistsInRepo = (repo: string, path: string): boolean => {
  const cacheKey = `file-exists-v2-${repo}-${path}`;
  const cached = getCached<boolean>(cacheKey);
  if (cached !== null) return cached;

  if (isWildcard(path)) {
    const exists = restFileExists(repo, path);
    setCache(cacheKey, exists);
    return exists;
  }

  // Single file: use GraphQL batch of 1
  const results = batchFileExists(repo, [path]);
  return results.get(path) ?? false;
};

