/**
 * shell-utils.ts
 *
 * Cross-platform shell helpers for gh CLI commands.
 * Fixes Windows incompatibility with single-quoted jq expressions
 * and /dev/null redirection.
 */

/** Wrap a jq expression in platform-appropriate quotes. */
export const jq = (expr: string): string =>
  process.platform === 'win32' ? `"${expr.replace(/"/g, '\\"')}"` : `'${expr}'`;

/** Platform-appropriate null device for stderr suppression. */
export const devNull = process.platform === 'win32' ? 'NUL' : '/dev/null';
