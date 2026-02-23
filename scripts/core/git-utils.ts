import { execSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  unlinkSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
} from 'node:fs';
import { dirname } from 'node:path';

const MAX_PUSH_RETRIES = 3;
const BASE_BACKOFF_MS = 2000;

export class GitPushError extends Error {
  constructor(
    message: string,
    public readonly attempts: number
  ) {
    super(message);
    this.name = 'GitPushError';
  }
}

const ensureDir = (filePath: string): void => {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
};

export const appendToLog = (filePath: string, entry: Record<string, unknown>): void => {
  ensureDir(filePath);
  const line = JSON.stringify(entry) + '\n';
  appendFileSync(filePath, line, 'utf-8');
};

export const readLogEntries = (filePath: string): Record<string, unknown>[] => {
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, 'utf-8').trim();
  if (!content) return [];

  return content
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null);
};

export const atomicCommitAndPush = (
  files: string[],
  message: string,
  maxRetries = MAX_PUSH_RETRIES
): void => {
  if (files.length === 0) return;

  for (const file of files) {
    execSync(`git add "${file}"`, { encoding: 'utf-8', stdio: 'pipe' });
  }

  try {
    execSync(`git diff --cached --quiet`, { stdio: 'pipe' });
    return; // nothing staged
  } catch {
    // there are staged changes, proceed
  }

  execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
    encoding: 'utf-8',
    stdio: 'pipe',
  });

  retryPush(maxRetries);
};

export const retryPush = (maxRetries = MAX_PUSH_RETRIES): void => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      execSync('git push', { encoding: 'utf-8', stdio: 'pipe', timeout: 30_000 });
      return;
    } catch (err) {
      lastError = err;

      if (attempt < maxRetries) {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
        console.warn(
          `[git] Push failed, pulling and retrying in ${backoff}ms (attempt ${attempt}/${maxRetries})`
        );

        try {
          execSync('git pull --rebase', { encoding: 'utf-8', stdio: 'pipe', timeout: 30_000 });
        } catch {
          // pull failed too, will retry push anyway
        }

        execSync(`node -e "setTimeout(()=>{},${backoff})"`, { stdio: 'ignore' });
      }
    }
  }

  throw new GitPushError(
    `Push failed after ${maxRetries} attempts: ${(lastError as Error).message}`,
    maxRetries
  );
};

const LOCK_TIMEOUT_MS = 30_000;

export const withFileLock = <T>(filePath: string, fn: () => T): T => {
  const lockPath = `${filePath}.lock`;
  const start = Date.now();

  while (existsSync(lockPath)) {
    if (Date.now() - start > LOCK_TIMEOUT_MS) {
      unlinkSync(lockPath); // stale lock
      break;
    }
    execSync('node -e "setTimeout(()=>{},100)"', { stdio: 'ignore' });
  }

  writeFileSync(lockPath, String(process.pid), 'utf-8');

  try {
    return fn();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // lock file already removed
    }
  }
};

export const safeWriteJSON = (filePath: string, data: unknown): void => {
  ensureDir(filePath);
  withFileLock(filePath, () => {
    writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  });
};
