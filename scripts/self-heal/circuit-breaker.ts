import { findPendingAutomationPR } from '../automation-guard.js';

export const isCircuitBreakerOpen = (repo: string): boolean => {
  try {
    const pendingPR = findPendingAutomationPR(repo);
    if (pendingPR !== null) {
      console.log(`  [CIRCUIT BREAKER] ${repo}: PR #${pendingPR} awaits review`);
      return true;
    }
    return false;
  } catch {
    // Unknown is not permission to spend another agent run.
    console.error(`  [CIRCUIT BREAKER] Cannot verify pending work for ${repo}; skipping`);
    process.exitCode = 1;
    return true;
  }
};
