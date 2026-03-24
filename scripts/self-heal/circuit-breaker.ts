import { sh as _sh } from '../shell-utils.js';
import { MAX_OPEN_HEALING_PRS } from './constants.js';

const sh = (cmd: string, timeout = 60_000) => _sh(cmd, { timeout });

export const isCircuitBreakerOpen = (repo: string): boolean => {
  try {
    const raw = sh(
      `gh pr list --repo ${repo} --state open --label ai-fix --limit 10 --json number,title`,
      60_000
    );
    if (!raw) return false;
    const openPRs = JSON.parse(raw) as Array<{ number: number; title: string }>;
    if (openPRs.length >= MAX_OPEN_HEALING_PRS) {
      console.log(
        `  [CIRCUIT BREAKER] ${repo} has ${openPRs.length} open ai-fix PRs (max ${MAX_OPEN_HEALING_PRS}) — pausing self-heal`
      );
      return true;
    }
    return false;
  } catch {
    return false;
  }
};
