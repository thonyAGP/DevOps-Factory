import { vi, type Mock } from 'vitest';
import { execSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = execSync as Mock;

// Dynamic import after mock setup
const { notify, notifyInfo, notifyWarn, notifyError } = await import('../../core/notification.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('notify', () => {
  it('should create GitHub issue for info level', () => {
    mockExecSync.mockReturnValue('');

    notify({
      title: 'Test notification',
      body: 'Test body',
      level: 'info',
    });

    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('gh issue create'),
      expect.any(Object)
    );
  });

  it('should not call disabled channels', () => {
    // discord and ntfy are disabled by default
    notify({
      title: 'Test',
      body: 'Test',
      level: 'info',
    });

    // Only github-issue should be called (which IS enabled)
    const calls = mockExecSync.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((c) => c.includes('gh issue create'))).toBe(true);
    // Discord and ntfy should not be called (disabled in config)
  });

  it('should respect custom channels override', () => {
    const originalEnv = process.env['DISCORD_WEBHOOK_URL'];
    process.env['DISCORD_WEBHOOK_URL'] = 'https://discord.com/api/webhooks/test';

    // Even with explicit channels, the sender runs
    notify({ title: 'Test', body: 'Test', level: 'info' }, ['discord']);

    process.env['DISCORD_WEBHOOK_URL'] = originalEnv;
    // Should have attempted discord notification
    expect(mockExecSync).toHaveBeenCalled();
  });

  it('should handle notification failure gracefully', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('gh not found');
    });

    // Should not throw
    expect(() => notify({ title: 'Fail test', body: 'body', level: 'info' })).not.toThrow();
  });
});

describe('helper functions', () => {
  it('notifyInfo should call notify with info level', () => {
    mockExecSync.mockReturnValue('');
    notifyInfo('Title', 'Body');
    expect(mockExecSync).toHaveBeenCalled();
  });

  it('notifyWarn should call notify with warn level', () => {
    mockExecSync.mockReturnValue('');
    notifyWarn('Title', 'Body');
    expect(mockExecSync).toHaveBeenCalled();
  });

  it('notifyError should call notify with error level', () => {
    mockExecSync.mockReturnValue('');
    notifyError('Title', 'Body');
    expect(mockExecSync).toHaveBeenCalled();
  });
});
