import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { findPendingAutomationPR, getRemediationBlocker } from './automation-guard.js';
import { isCircuitBreakerOpen } from './self-heal/circuit-breaker.js';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

const pr = (ref: string, title = 'fix: build', labels: string[] = []) => ({
  number: 42, title, head: { ref }, labels: labels.map((name) => ({ name })),
});

beforeEach(() => {
  vi.resetAllMocks();
  process.exitCode = 0;
});

describe('no agent while prepared work is pending', () => {
  it.each(['ai-fix/build', 'ai-remediation/security', 'reparateur/pnpm'])
    ('recognizes an unlabelled automation branch: %s', (branch) => {
      vi.mocked(execFileSync).mockReturnValue(JSON.stringify([[pr(branch)]]));
      expect(getRemediationBlocker('owner/app', 'ai-remediation.yml')).toContain('#42');
      expect(execFileSync).toHaveBeenCalledTimes(1);
    });

  it('finds pending work on subsequent PR pages', () => {
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify([[pr('feature/other')], [pr('ai-fix/build')]]));
    expect(findPendingAutomationPR('owner/app')).toBe(42);
  });

  it('recognizes generated remediation PRs even with an arbitrary branch name', () => {
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify([[pr('security/fixes', 'fix: corrections (central-scan)')]]));
    expect(findPendingAutomationPR('owner/app')).toBe(42);
  });

  it('recognizes ai-fix labels without blocking unrelated dependency updates', () => {
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify([[pr('renovate/node', 'deps', ['dependencies']), pr('custom', 'fix', ['ai-fix'])]]));
    expect(findPendingAutomationPR('owner/app')).toBe(42);
  });

  it.each(['in_progress', 'queued', 'waiting', 'pending', 'requested'])
    ('blocks a remediation run that is %s', (activeStatus) => {
      vi.mocked(execFileSync).mockImplementation((_file, args) => {
        const endpoint = String((args as string[])[1]);
        if (endpoint.includes('/pulls?')) return '[[]]';
        const active = endpoint.includes(`status=${activeStatus}&`);
        return JSON.stringify([{ workflow_runs: active ? [{ id: 123, path: '.github/workflows/ai-remediation.yml' }] : [] }]);
      });
      expect(getRemediationBlocker('owner/app', 'ai-remediation.yml')).toContain('#123');
    });

  it('allows work when only unrelated workflows are active', () => {
    vi.mocked(execFileSync).mockReturnValueOnce('[[]]')
      .mockReturnValue(JSON.stringify([{ workflow_runs: [{ id: 123, path: '.github/workflows/ci.yml' }] }]));
    expect(getRemediationBlocker('owner/app', 'ai-remediation.yml')).toBeNull();
  });

  it('never treats a GitHub read failure as permission to dispatch', () => {
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('HTTP 403'); });
    expect(() => getRemediationBlocker('owner/app', 'ai-remediation.yml')).toThrow('HTTP 403');
    expect(isCircuitBreakerOpen('owner/app')).toBe(true);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it.each(['{}', '[{"message":"Forbidden"}]', '[[{"number":42}]]'])
    ('rejects invalid PR responses: %s', (raw) => {
      vi.mocked(execFileSync).mockReturnValue(raw);
      expect(() => findPendingAutomationPR('owner/app')).toThrow();
    });
});
