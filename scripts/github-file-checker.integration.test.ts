import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { getCached, setCache } from './cache-manager.js';
import { batchFileExists } from './github-file-checker.js';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('./cache-manager.js', () => ({ getCached: vi.fn(), setCache: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCached).mockReturnValue(null);
});

describe('real file checker CLI boundary', () => {
  it('passes real GraphQL newlines in a single argument', () => {
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify({ data: { repository: { f0: { byteSize: 1 }, f1: null } } }));
    const result = batchFileExists('owner/repo', ['package.json', 'missing.txt']);
    const [command, args] = vi.mocked(execFileSync).mock.calls[0];
    expect(command).toBe('gh');
    expect(args).toEqual(['api', 'graphql', '-f', expect.stringContaining('query=query {\n')]);
    expect(args?.[3]).not.toContain('\\n');
    expect(result.get('package.json')).toBe(true);
    expect(result.get('missing.txt')).toBe(false);
  });

  it('never caches transport errors as absence', () => {
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('access denied'); });
    expect(() => batchFileExists('owner/repo', ['package.json'])).toThrow('access denied');
    expect(setCache).not.toHaveBeenCalled();
  });

  it('rejects partial GraphQL errors without caching partial data', () => {
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify({ data: { repository: { f0: null } }, errors: [{ message: 'permission' }] }));
    expect(() => batchFileExists('owner/repo', ['package.json'])).toThrow();
    expect(setCache).not.toHaveBeenCalled();
  });

  it('lists the directory for .NET globs and ignores matching directories', () => {
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify([{ name: 'App.csproj', type: 'file' }]));
    expect(batchFileExists('owner/repo', ['*.csproj']).get('*.csproj')).toBe(true);
    expect(vi.mocked(execFileSync).mock.calls[0][1]).toEqual(['api', 'repos/owner/repo/contents/']);
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify([{ name: 'App.csproj', type: 'dir' }]));
    expect(batchFileExists('owner/repo', ['*.csproj']).get('*.csproj')).toBe(false);
  });
});
