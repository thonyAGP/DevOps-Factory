import { expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';

vi.mock('node:fs', () => ({
  existsSync: () => true,
  readFileSync: () => JSON.stringify({ analyses: [] }),
  writeFileSync: vi.fn(),
}));
vi.mock('./activity-logger.js', () => ({ logActivity: vi.fn() }));
vi.mock('./shell-utils.js', () => ({ sh: vi.fn() }));

it('preserves the last cost report when inventory is empty', async () => {
  await expect(import('./cost-monitor.js')).rejects.toThrow('No monitored projects');
  expect(writeFileSync).not.toHaveBeenCalled();
});
