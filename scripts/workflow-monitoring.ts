import { execFileSync } from 'node:child_process';
import type { WorkflowRun } from './types.js';

export interface ReferenceRun extends WorkflowRun {
  event: string;
}

const DECISIVE_CONCLUSIONS = new Set(['success', 'failure', 'timed_out', 'action_required', 'startup_failure']);

/** PR checks, skipped jobs and cancellations are not production incidents or recoveries. */
export const selectReferenceRun = (runs: ReferenceRun[], branch: string): ReferenceRun | null =>
  runs.find((run) =>
    run.head_branch === branch &&
    run.event !== 'pull_request' && run.event !== 'pull_request_target' &&
    run.status === 'completed' && DECISIVE_CONCLUSIONS.has(run.conclusion ?? '')
  ) ?? null;

const read = (endpoint: string): string => execFileSync('gh', ['api', endpoint], {
  encoding: 'utf-8', timeout: 30_000, maxBuffer: 5 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
});

export const getReferenceWorkflowRuns = (repo: string): WorkflowRun[] => {
  const { default_branch: branch } = JSON.parse(read(`repos/${repo}`));
  if (typeof branch !== 'string' || !branch) throw new Error('Missing default branch');
  const workflows = JSON.parse(execFileSync('gh', [
    'api', `repos/${repo}/actions/workflows?per_page=100`, '--paginate', '--slurp',
  ], { encoding: 'utf-8', timeout: 30_000, maxBuffer: 5 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
  if (!Array.isArray(workflows) || workflows.some((p) => !Array.isArray(p.workflows))) {
    throw new Error('Invalid workflow inventory');
  }
  const runs: WorkflowRun[] = [];
  for (const workflow of workflows.flatMap((p) => p.workflows)) {
    if (workflow.state !== 'active' || workflow.name === 'Factory Watchdog') continue;
    const run = getReferenceWorkflowRun(repo, workflow.id, branch);
    if (run) runs.push(run);
  }
  return runs;
};

export const getReferenceWorkflowRun = (repo: string, workflow: string | number, branch: string): ReferenceRun | null => {
  for (let page = 1; ; page++) {
    const response = JSON.parse(read(`repos/${repo}/actions/workflows/${encodeURIComponent(String(workflow))}/runs?branch=${encodeURIComponent(branch)}&status=completed&per_page=100&page=${page}`));
    if (!Array.isArray(response.workflow_runs)) throw new Error('Invalid workflow runs');
    const run = selectReferenceRun(response.workflow_runs, branch);
    if (run) return run;
    if (response.workflow_runs.length < 100) return null;
  }
};

/** Disabled repair workflows require an operator decision, never repeated dispatch attempts. */
export const isSelfHealEnabled = (repo: string): boolean => {
  const workflow = JSON.parse(read(`repos/${repo}/actions/workflows/self-heal.yml`));
  return workflow.state === 'active';
};
