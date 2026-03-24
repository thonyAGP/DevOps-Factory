/**
 * shell-utils.ts
 *
 * Cross-platform shell helpers for gh CLI commands.
 * Fixes Windows incompatibility with single-quoted jq expressions
 * and /dev/null redirection.
 */

import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

/** Wrap a jq expression in platform-appropriate quotes. */
export const jq = (expr: string): string =>
  process.platform === 'win32' ? `"${expr.replace(/"/g, '\\"')}"` : `'${expr}'`;

/** Platform-appropriate null device for stderr suppression. */
export const devNull = process.platform === 'win32' ? 'NUL' : '/dev/null';

/** Cross-platform temp directory (prefers RUNNER_TEMP in CI). */
export const tmpDir = process.env.RUNNER_TEMP || tmpdir();

/** Options for sh() */
export interface ShOptions {
  timeout?: number;
  maxBuffer?: number;
  cwd?: string;
  fallbackOnError?: 'empty' | 'stdout';
}

const DEFAULT_SH_OPTIONS: Required<ShOptions> = {
  timeout: 30_000,
  maxBuffer: 1024 * 1024,
  cwd: '',
  fallbackOnError: 'empty',
};

/**
 * Execute a shell command and return trimmed stdout.
 * Returns empty string on failure by default.
 */
export const sh = (cmd: string, opts?: ShOptions): string => {
  const { timeout, maxBuffer, cwd, fallbackOnError } = { ...DEFAULT_SH_OPTIONS, ...opts };
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      timeout,
      maxBuffer,
      ...(cwd ? { cwd } : {}),
    }).trim();
  } catch (e: unknown) {
    if (fallbackOnError === 'stdout') {
      const err = e as { stdout?: string; stderr?: string };
      return err.stdout?.trim() || err.stderr?.trim() || '';
    }
    return '';
  }
};
