import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { getReferenceWorkflowRuns, isSelfHealEnabled, selectReferenceRun, type ReferenceRun } from './workflow-monitoring.js';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
const run = (overrides: Partial<ReferenceRun> = {}): ReferenceRun => ({
  id: 1, name: 'CI', conclusion: 'failure', status: 'completed', html_url: '',
  created_at: '2026-10-19T00:00:00Z', head_branch: 'master', event: 'push', ...overrides,
});
beforeEach(() => vi.resetAllMocks());

describe('reference workflow monitoring', () => {
  it('ignores PR probes even on a matching branch name', () => {
    expect(selectReferenceRun([run({ event: 'pull_request' }), run({ head_branch: 'fix/probe' })], 'master')).toBeNull();
  });
  it('does not turn skipped/cancelled runs into failures or recoveries', () => {
    const failure = run();
    expect(selectReferenceRun([run({ conclusion: 'skipped' }), run({ conclusion: 'cancelled' }), failure], 'master')).toBe(failure);
    expect(selectReferenceRun([run({ conclusion: 'skipped' })], 'master')).toBeNull();
  });
  it('uses an actual successful reference run as recovery', () => {
    expect(selectReferenceRun([run({ conclusion: 'success', event: 'schedule' })], 'master')?.conclusion).toBe('success');
  });
  it('retains actionable timeouts', () => {
    expect(selectReferenceRun([run({ conclusion: 'timed_out' })], 'master')?.conclusion).toBe('timed_out');
  });
  it('checks each active workflow rather than the last 30 global runs', () => {
    vi.mocked(execFileSync)
      .mockReturnValueOnce(JSON.stringify({ default_branch: 'master' }))
      .mockReturnValueOnce(JSON.stringify([{ workflows: [
        { id: 1, name: 'CI', state: 'active' }, { id: 2, name: 'Old', state: 'disabled_manually' },
      ] }]))
      .mockReturnValueOnce(JSON.stringify({ workflow_runs: [run()] }));
    expect(getReferenceWorkflowRuns('owner/repo')).toHaveLength(1);
    expect(vi.mocked(execFileSync).mock.calls[2][1]?.[1]).toContain('/workflows/1/runs?branch=master');
    expect(execFileSync).toHaveBeenCalledTimes(3);
  });
  it('does not dispatch disabled repairs', () => {
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify({ state: 'disabled_manually' }));
    expect(isSelfHealEnabled('owner/repo')).toBe(false);
  });
  it('propagates denied access rather than reporting a healthy empty inventory', () => {
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('denied'); });
    expect(() => getReferenceWorkflowRuns('owner/repo')).toThrow('denied');
  });
});
