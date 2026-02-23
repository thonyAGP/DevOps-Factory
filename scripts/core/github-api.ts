import { execSync } from 'node:child_process';

export interface GhExecOptions {
  timeout?: number;
  maxRetries?: number;
  dryRun?: boolean;
  silent?: boolean;
}

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

export class GhApiError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly exitCode?: number,
    public readonly isRateLimit?: boolean
  ) {
    super(message);
    this.name = 'GhApiError';
  }
}

const isRateLimitError = (stderr: string): boolean =>
  stderr.includes('API rate limit') ||
  stderr.includes('403') ||
  stderr.includes('429') ||
  stderr.includes('rate limit');

const sleep = (ms: number): void => {
  execSync(`node -e "setTimeout(()=>{},${ms})"`, { stdio: 'ignore' });
};

export const ghExec = (args: string, opts: GhExecOptions = {}): string => {
  const {
    timeout = DEFAULT_TIMEOUT,
    maxRetries = DEFAULT_MAX_RETRIES,
    dryRun = false,
    silent = false,
  } = opts;

  const command = `gh ${args}`;

  if (dryRun) {
    if (!silent) console.log(`[DRY-RUN] ${command}`);
    return '';
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = execSync(command, {
        encoding: 'utf-8',
        timeout,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return result.trim();
    } catch (err: unknown) {
      lastError = err;
      const stderr = (err as { stderr?: string }).stderr ?? '';
      const exitCode = (err as { status?: number }).status ?? undefined;

      if (isRateLimitError(stderr)) {
        if (attempt < maxRetries) {
          const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
          if (!silent) {
            console.warn(
              `[gh] Rate limit hit, retrying in ${backoff}ms (attempt ${attempt}/${maxRetries})`
            );
          }
          sleep(backoff);
          continue;
        }
        throw new GhApiError(
          `Rate limit exceeded after ${maxRetries} attempts`,
          command,
          exitCode,
          true
        );
      }

      if (attempt < maxRetries) {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
        if (!silent) {
          console.warn(
            `[gh] Command failed, retrying in ${backoff}ms (attempt ${attempt}/${maxRetries})`
          );
        }
        sleep(backoff);
        continue;
      }

      throw new GhApiError(
        `gh command failed: ${stderr || (err as Error).message}`,
        command,
        exitCode
      );
    }
  }

  throw lastError;
};

export const ghApi = <T = unknown>(endpoint: string, opts?: GhExecOptions): T => {
  const result = ghExec(`api ${endpoint}`, opts);
  return JSON.parse(result) as T;
};

export const ghRepoList = (owner: string, opts?: GhExecOptions): string[] => {
  const result = ghExec(`repo list ${owner} --json name --jq ".[].name" --limit 100`, opts);
  return result.split('\n').filter(Boolean);
};

export const ghWorkflowRuns = (
  repo: string,
  workflow: string,
  limit = 5,
  opts?: GhExecOptions
): string =>
  ghExec(
    `run list --repo ${repo} --workflow "${workflow}" --limit ${limit} --json conclusion,createdAt,headBranch,htmlUrl,databaseId,name`,
    opts
  );
