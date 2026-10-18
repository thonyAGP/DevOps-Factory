import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { getCached, setCache } from './cache-manager.js';
import {
  isRepositoryActive,
  listAccessibleRepositories,
  parseRepositoryPages,
} from './repository-discovery.js';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('./cache-manager.js', () => ({ getCached: vi.fn(), setCache: vi.fn() }));

const repo = {
  name: 'app',
  full_name: 'owner/app',
  default_branch: 'main',
  archived: false,
  fork: false,
  private: true,
  language: 'TypeScript',
  pushed_at: '2026-10-18T00:00:00Z',
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCached).mockReturnValue(null);
});

describe('repository inventory with installation and personal authentication', () => {
  it('flattens App pages without dropping repositories after the first page', () => {
    const other = { ...repo, name: 'other', full_name: 'owner/other' };
    expect(parseRepositoryPages(JSON.stringify([{ repositories: [repo] }, { repositories: [other] }])))
      .toEqual([repo, other]);
  });

  it('uses the App endpoint and shares the unfiltered inventory', () => {
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify([{ repositories: [repo] }]));
    expect(listAccessibleRepositories()).toEqual([repo]);
    expect(execFileSync).toHaveBeenCalledWith(
      'gh',
      ['api', 'installation/repositories?per_page=100', '--paginate', '--slurp'],
      expect.any(Object)
    );
    expect(setCache).toHaveBeenCalledWith('accessible-repositories-v2', [repo]);
  });

  it('supports personal CLI authentication when the App endpoint rejects the token', () => {
    vi.mocked(execFileSync)
      .mockImplementationOnce(() => { throw new Error('HTTP 403'); })
      .mockReturnValueOnce(JSON.stringify([[repo]]));
    expect(listAccessibleRepositories()).toEqual([repo]);
    expect(execFileSync).toHaveBeenLastCalledWith(
      'gh', ['api', 'user/repos?per_page=100', '--paginate', '--slurp'], expect.any(Object)
    );
  });

  it('propagates permission failures and never caches an empty successful inventory', () => {
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('HTTP 403'); });
    expect(() => listAccessibleRepositories()).toThrow('HTTP 403');
    expect(setCache).not.toHaveBeenCalled();
  });

  it('ignores the empty cache left by a failed scan and refetches', () => {
    vi.mocked(getCached).mockReturnValue([]);
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify([{ repositories: [repo] }]));
    expect(listAccessibleRepositories()).toEqual([repo]);
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });

  it('uses a valid shared inventory without another API call', () => {
    vi.mocked(getCached).mockReturnValue([repo]);
    expect(listAccessibleRepositories()).toEqual([repo]);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it.each(['[]', '[[]]', '[{"repositories":[]}]', '{}', '[{"message":"Forbidden"}]'])
    ('rejects an empty or malformed inventory: %s', (raw) => {
      expect(() => parseRepositoryPages(raw)).toThrow();
    });

  it('uses pushed_at from the inventory instead of one API request per repo', () => {
    const now = Date.parse('2026-10-18T12:00:00Z');
    expect(isRepositoryActive(repo, now)).toBe(true);
    expect(isRepositoryActive({ ...repo, pushed_at: '2026-01-01T00:00:00Z' }, now)).toBe(false);
    expect(isRepositoryActive({ ...repo, pushed_at: null }, now)).toBe(false);
    expect(execFileSync).not.toHaveBeenCalled();
  });
});
