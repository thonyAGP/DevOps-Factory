import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { REMEDIATION_CONFIG } from '../factory.config.js';
import { getRemediationBlocker } from './automation-guard.js';
import { sh } from './shell-utils.js';
import { runRemediationDispatch } from './remediation-dispatch.js';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));
vi.mock('./automation-guard.js', () => ({ getRemediationBlocker: vi.fn() }));
vi.mock('./shell-utils.js', () => ({ sh: vi.fn() }));
vi.mock('./activity-logger.js', () => ({ logActivity: vi.fn() }));

const originalArgv = process.argv;
const repos = REMEDIATION_CONFIG.enabledRepos.map((repo, index) => ({
  name: repo.split('/')[1], repo, grade: 'F', risk: 300 - index, reasons: [],
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.argv = ['node', 'remediation-dispatch.ts'];
  process.exitCode = 0;
  vi.mocked(readFileSync).mockImplementation((path) => JSON.stringify(
    String(path).includes('security-registry')
      ? { date: new Date().toISOString().slice(0, 10), repos }
      : { date: new Date().toISOString().slice(0, 10), count: REMEDIATION_CONFIG.maxPerDay - 1 }
  ));
  vi.mocked(getRemediationBlocker).mockReturnValue(null);
  vi.mocked(sh).mockImplementation((command) => command.includes('gh workflow run') ? 'DISPATCHED' : 'sha');
});

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = 0;
});

describe('remediation dispatch spends its quota on eligible work', () => {
  it('skips the first blocked candidate and dispatches the next within the same quota', () => {
    vi.mocked(getRemediationBlocker).mockReturnValueOnce('PR #42 awaits review');
    runRemediationDispatch();
    expect(getRemediationBlocker).toHaveBeenCalledTimes(2);
    const dispatches = vi.mocked(sh).mock.calls.filter(([command]) => command.includes('gh workflow run'));
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0][0]).toContain(repos[1].repo);
    expect(writeFileSync).toHaveBeenCalledWith(
      'data/remediation-quota.json',
      expect.stringContaining(`"count": ${REMEDIATION_CONFIG.maxPerDay}`)
    );
  });

  it('retains the quota for a launched agent when a later control fails', () => {
    vi.mocked(readFileSync).mockImplementation((path) => JSON.stringify(
      String(path).includes('security-registry')
        ? { date: new Date().toISOString().slice(0, 10), repos }
        : { date: new Date().toISOString().slice(0, 10), count: REMEDIATION_CONFIG.maxPerDay - 2 }
    ));
    vi.mocked(getRemediationBlocker)
      .mockReturnValueOnce(null)
      .mockImplementationOnce(() => { throw new Error('HTTP 403'); });
    runRemediationDispatch();
    expect(process.exitCode).toBe(1);
    expect(vi.mocked(sh).mock.calls.filter(([command]) => command.includes('gh workflow run')))
      .toHaveLength(1);
    expect(writeFileSync).toHaveBeenCalledWith(
      'data/remediation-quota.json',
      expect.stringContaining(`"count": ${REMEDIATION_CONFIG.maxPerDay - 1}`)
    );
  });

  it('does not consume quota or deploy workflows when all candidates are blocked', () => {
    vi.mocked(getRemediationBlocker).mockReturnValue('PR #42 awaits review');
    runRemediationDispatch();
    expect(sh).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('checks blockers in dry-run without dispatching or persisting state', () => {
    process.argv.push('--dry-run');
    runRemediationDispatch();
    expect(getRemediationBlocker).toHaveBeenCalledTimes(1);
    expect(sh).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('fails visibly when GitHub state cannot be verified and dispatches nothing', () => {
    vi.mocked(getRemediationBlocker).mockImplementation(() => { throw new Error('HTTP 403'); });
    runRemediationDispatch();
    expect(process.exitCode).toBe(1);
    expect(sh).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
