import { execFileSync } from 'node:child_process';

interface PullRequest {
  number: number;
  title: string;
  head: { ref: string };
  labels: Array<{ name: string }>;
}

const readPages = (endpoint: string): unknown[] => {
  const raw = execFileSync('gh', ['api', endpoint, '--paginate', '--slurp'], {
    encoding: 'utf-8',
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const pages: unknown = JSON.parse(raw);
  if (!Array.isArray(pages)) throw new Error('Invalid GitHub pagination response');
  return pages;
};

/** A prepared fix must be reviewed before another agent works on the same repo. */
export const findPendingAutomationPR = (repo: string): number | null => {
  const pages = readPages(`repos/${repo}/pulls?state=open&per_page=100`);
  for (const page of pages) {
    if (!Array.isArray(page)) throw new Error('Invalid open PR response');
    for (const value of page) {
      const pr = value as PullRequest;
      if (
        !pr ||
        typeof pr.number !== 'number' ||
        typeof pr.title !== 'string' ||
        typeof pr.head?.ref !== 'string' ||
        !Array.isArray(pr.labels) ||
        !pr.labels.every((label) => typeof label?.name === 'string')
      ) {
        throw new Error('Invalid open PR entry');
      }
      if (
        /^(ai-fix|ai-remediation|reparateur)\//.test(pr.head.ref) ||
        pr.labels.some((label) => ['ai-fix', 'ai-remediation'].includes(label.name)) ||
        pr.title.toLowerCase().includes('(central-scan)')
      ) {
        return pr.number;
      }
    }
  }
  return null;
};

/** Include queued and approval-waiting runs: concurrency queues still consume later. */
export const getRemediationBlocker = (repo: string, workflowFile: string): string | null => {
  const pendingPR = findPendingAutomationPR(repo);
  if (pendingPR !== null) return `PR #${pendingPR} awaits review`;

  for (const status of ['in_progress', 'queued', 'waiting', 'pending', 'requested']) {
    const pages = readPages(`repos/${repo}/actions/runs?status=${status}&per_page=100`);
    for (const page of pages) {
      const runs = (page as { workflow_runs?: unknown[] } | null)?.workflow_runs;
      if (!Array.isArray(runs)) throw new Error('Invalid workflow runs response');
      for (const value of runs) {
        const run = value as { id: number; path: string };
        if (!run || typeof run.id !== 'number' || typeof run.path !== 'string') {
          throw new Error('Invalid workflow run entry');
        }
        if (run.path.split('@')[0] === `.github/workflows/${workflowFile}`) {
          return `Remediation run #${run.id} is ${status}`;
        }
      }
    }
  }
  return null;
};
