import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  files: new Map<string, string>(), prs: [] as unknown[], fail: false,
  command: vi.fn(),
}));
vi.mock('node:fs', () => ({
  existsSync: (path: string) => fixture.files.has(path),
  readFileSync: (path: string) => fixture.files.get(path),
  writeFileSync: (path: string, data: string) => fixture.files.set(path, data),
}));
vi.mock('node:child_process', () => ({
  execFileSync: () => {
    if (fixture.fail) throw new Error('GitHub unavailable');
    return JSON.stringify(fixture.prs);
  },
  execSync: fixture.command,
}));
vi.mock('../factory.config.js', () => ({
  KNOWN_PROJECTS: [{ repo: 'owner/project', name: 'project', stack: 'node' }],
  GITHUB_OWNER: 'owner',
}));

const observedPR = {
  number: 5, title: 'fix: CI fix [pattern:compile]', state: 'MERGED',
  labels: [{ name: 'ai-fix' }], mergedAt: '2026-10-18T00:00:00Z',
  headRefName: 'ai-fix/compile',
};

describe('feedback collector persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    fixture.files.clear();
    fixture.prs = [observedPR];
    fixture.fail = false;
    fixture.command.mockClear();
    process.exitCode = 0;
    vi.stubEnv('GITHUB_ACTIONS', 'false');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    process.exitCode = 0;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it('saves a tracked open PR becoming merged instead of reloading the old log', async () => {
    fixture.files.set('data/feedback-log.json', JSON.stringify({
      version: 1, lastUpdated: null, feedbacks: [{
        date: '2026-10-01', repo: 'owner/project', prNumber: 5,
        prTitle: observedPR.title, outcome: 'open', patternId: 'compile', source: 'self-heal',
      }],
    }));
    await import('./feedback-collector.js');
    const saved = JSON.parse(fixture.files.get('data/feedback-log.json') ?? '{}');
    expect(saved.feedbacks).toHaveLength(1);
    expect(saved.feedbacks[0]).toMatchObject({ outcome: 'merged', sourceVerified: true });
  });
  it('does not record a normal feature PR as an automation success', async () => {
    fixture.prs = [{ ...observedPR, title: 'feat: navigation', labels: [], headRefName: 'feature/ui' }];
    await import('./feedback-collector.js');
    const saved = JSON.parse(fixture.files.get('data/feedback-log.json') ?? '{}');
    expect(saved.feedbacks).toEqual([]);
  });
  it('fails visibly and does not publish a success report on API failure', async () => {
    fixture.fail = true;
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    await import('./feedback-collector.js');
    expect(process.exitCode).toBe(1);
    expect(fixture.command).not.toHaveBeenCalled();
  });
});
