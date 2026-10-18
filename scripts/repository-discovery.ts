import { execFileSync } from 'node:child_process';
import { getCached, setCache } from './cache-manager.js';

export interface Repository {
  name: string;
  full_name: string;
  default_branch: string;
  archived: boolean;
  fork: boolean;
  private: boolean;
  language: string | null;
  pushed_at: string | null;
}

const isRepository = (value: unknown): value is Repository => {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.name === 'string' &&
    typeof r.full_name === 'string' &&
    typeof r.default_branch === 'string' &&
    typeof r.archived === 'boolean' &&
    typeof r.fork === 'boolean' &&
    typeof r.private === 'boolean' &&
    (r.language === null || typeof r.language === 'string') &&
    (r.pushed_at === null ||
      (typeof r.pushed_at === 'string' && Number.isFinite(Date.parse(r.pushed_at))))
  );
};

/** gh --slurp keeps page boundaries: App pages are objects, user pages arrays. */
export const parseRepositoryPages = (raw: string): Repository[] => {
  const pages: unknown = JSON.parse(raw);
  if (!Array.isArray(pages)) throw new Error('Invalid repository inventory pages');
  const repos: unknown[] = pages.flatMap((page: unknown) => {
    const entries = Array.isArray(page)
      ? page
      : page && typeof page === 'object'
        ? (page as Record<string, unknown>).repositories
        : undefined;
    if (!Array.isArray(entries)) throw new Error('Invalid repository inventory page');
    return entries;
  });
  if (repos.length === 0 || !repos.every(isRepository)) {
    throw new Error('Repository inventory is empty or invalid; previous report preserved');
  }
  return repos;
};

/** Share the RAW inventory, never the scanner's filtered subset or an empty error. */
export const listAccessibleRepositories = (): Repository[] => {
  const cacheKey = 'accessible-repositories-v2';
  const cached = getCached<unknown>(cacheKey);
  if (Array.isArray(cached) && cached.length > 0 && cached.every(isRepository)) return cached;

  const read = (endpoint: string): string =>
    execFileSync('gh', ['api', endpoint, '--paginate', '--slurp'], {
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  let raw: string;
  try {
    raw = read('installation/repositories?per_page=100');
  } catch {
    // Personal CLI authentication does not have an installation endpoint.
    // If both fail, propagate the error instead of publishing a green empty scan.
    raw = read('user/repos?per_page=100');
  }
  const repos = parseRepositoryPages(raw);
  setCache(cacheKey, repos);
  return repos;
};

export const isRepositoryActive = (repo: Repository, now = Date.now()): boolean =>
  repo.pushed_at !== null && now - Date.parse(repo.pushed_at) < 90 * 86400000;
