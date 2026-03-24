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

import { execSync } from 'node:child_process';
import { getCached, setCache } from './cache-manager.js';
import { devNull } from './shell-utils.js';

const gh = (cmd: string): string => {
  try {
    return execSync(`gh ${cmd}`, { encoding: 'utf-8', timeout: 30_000 }).trim();
  } catch {
    return '';
  }
};

/**
 * Check if a path contains wildcard characters that can't be resolved via GraphQL.
 */
const isWildcard = (path: string): boolean => path.includes('*');

/**
 * Check a single file via REST API (fallback for wildcards).
 */
const restFileExists = (repo: string, path: string): boolean => {
  const jqExpr = process.platform === 'win32' ? '".name"' : "'.name'";
  const result = gh(`api repos/${repo}/contents/${path} --jq ${jqExpr} 2>${devNull}`);
  return result.length > 0;
};

/**
 * Build a GraphQL query to check multiple files in one request.
 * Uses repository object expressions: "HEAD:path/to/file"
 */
export const buildGraphQLQuery = (owner: string, repo: string, paths: string[]): string => {
  const fields = paths
    .map((p, i) => `f${i}: object(expression: "HEAD:${p}") { ... on Blob { byteSize } }`)
    .join('\n    ');

  return `query {
  repository(owner: "${owner}", name: "${repo}") {
    ${fields}
  }
}`;
};

/**
 * Parse GraphQL response into a Map of path -> exists.
 */
export const parseGraphQLResponse = (response: string, paths: string[]): Map<string, boolean> => {
  const results = new Map<string, boolean>();

  try {
    const data = JSON.parse(response);
    const repoData = data?.data?.repository ?? {};

    for (let i = 0; i < paths.length; i++) {
      const field = `f${i}`;
      results.set(paths[i], repoData[field] !== null && repoData[field] !== undefined);
    }
  } catch {
    // If parse fails, mark all as unknown (false)
    for (const p of paths) {
      results.set(p, false);
    }
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
    const cacheKey = `file-exists-${repo}-${p}`;
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
    setCache(`file-exists-${repo}-${p}`, exists);
    results.set(p, exists);
  }

  // 3. Batch check remaining via GraphQL
  if (uncached.length > 0) {
    const [owner, repoName] = repo.split('/');
    const query = buildGraphQLQuery(owner, repoName, uncached);

    // Escape for shell: write query inline
    const escaped = query.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const response = gh(`api graphql -f query="${escaped}"`);

    const graphqlResults = parseGraphQLResponse(response, uncached);

    for (const [path, exists] of graphqlResults) {
      setCache(`file-exists-${repo}-${path}`, exists);
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
  const cacheKey = `file-exists-${repo}-${path}`;
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
