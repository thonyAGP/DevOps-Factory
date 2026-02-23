import { vi, type Mock } from 'vitest';
import { execSync } from 'node:child_process';
import { ghExec, ghApi, GhApiError } from '../../core/github-api.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = execSync as Mock;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ghExec', () => {
  it('should execute gh command and return trimmed output', () => {
    mockExecSync.mockReturnValue('  result output  \n');

    const result = ghExec('repo list', { maxRetries: 1 });
    expect(result).toBe('result output');
    expect(mockExecSync).toHaveBeenCalledWith(
      'gh repo list',
      expect.objectContaining({ encoding: 'utf-8' })
    );
  });

  it('should return empty string in dry-run mode', () => {
    const result = ghExec('repo list', { dryRun: true, silent: true });
    expect(result).toBe('');
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('should retry on failure', () => {
    // First call fails, then the sleep, then second call succeeds
    mockExecSync
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('timeout'), { stderr: 'timeout', status: 1 });
      })
      .mockReturnValueOnce('') // sleep call
      .mockReturnValueOnce('retry-success');

    const result = ghExec('repo list', { maxRetries: 2, silent: true });
    expect(result).toBe('retry-success');
  });

  it('should throw GhApiError after max retries', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.startsWith('gh ')) {
        throw Object.assign(new Error('fail'), { stderr: 'error', status: 1 });
      }
      return ''; // sleep calls
    });

    expect(() => ghExec('repo list', { maxRetries: 2, silent: true })).toThrow(GhApiError);
  });

  it('should detect rate limit errors', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.startsWith('gh ')) {
        throw Object.assign(new Error('rate limit'), {
          stderr: 'API rate limit exceeded',
          status: 403,
        });
      }
      return ''; // sleep calls
    });

    try {
      ghExec('api /repos', { maxRetries: 2, silent: true });
    } catch (err) {
      expect(err).toBeInstanceOf(GhApiError);
      expect((err as GhApiError).isRateLimit).toBe(true);
    }
  });

  it('should respect timeout option', () => {
    mockExecSync.mockReturnValue('ok');

    ghExec('api test', { timeout: 5000, maxRetries: 1 });
    expect(mockExecSync).toHaveBeenCalledWith(
      'gh api test',
      expect.objectContaining({ timeout: 5000 })
    );
  });
});

describe('ghApi', () => {
  it('should parse JSON response', () => {
    mockExecSync.mockReturnValue(JSON.stringify({ login: 'user' }));

    const result = ghApi<{ login: string }>('/user', { maxRetries: 1 });
    expect(result).toEqual({ login: 'user' });
  });

  it('should throw on invalid JSON', () => {
    mockExecSync.mockReturnValue('not-json');

    expect(() => ghApi('/user', { maxRetries: 1 })).toThrow();
  });
});
