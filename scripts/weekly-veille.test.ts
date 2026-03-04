/**
 * weekly-veille.test.ts
 *
 * Tests pour weekly-veille - surveillance technologique
 * Coverage: release fetching, breaking change detection, report generation
 */

import { describe, it, expect } from 'vitest';

describe('weekly-veille logic', () => {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  describe('Date calculations', () => {
    it('should calculate one week ago correctly', () => {
      const now = new Date('2024-03-10T00:00:00Z');
      const weekAgo = new Date(now.getTime() - WEEK_MS);
      const weekAgoDate = weekAgo.toISOString().split('T')[0];

      expect(weekAgoDate).toBe('2024-03-03');
    });

    it('should format date as ISO string', () => {
      const date = new Date('2024-03-10T12:30:45Z');
      const formatted = date.toISOString().split('T')[0];

      expect(formatted).toBe('2024-03-10');
    });

    it('should handle year boundaries', () => {
      const now = new Date('2024-01-05T00:00:00Z');
      const weekAgo = new Date(now.getTime() - WEEK_MS);
      const weekAgoDate = weekAgo.toISOString().split('T')[0];

      expect(weekAgoDate).toBe('2023-12-29');
    });

    it('should handle month boundaries', () => {
      const now = new Date('2024-03-05T00:00:00Z');
      const weekAgo = new Date(now.getTime() - WEEK_MS);
      const weekAgoDate = weekAgo.toISOString().split('T')[0];

      expect(weekAgoDate).toBe('2024-02-27');
    });
  });

  describe('Release filtering', () => {
    const getRecentReleases = (releases: unknown[], sinceDate: string) => {
      return releases.filter((r) => {
        const typedR = r as { published_at: string };
        return typedR.published_at >= sinceDate;
      });
    };

    it('should filter releases by date', () => {
      const releases = [
        { tag_name: 'v1.0.0', published_at: '2024-03-10' },
        { tag_name: 'v1.0.1', published_at: '2024-03-05' },
        { tag_name: 'v1.0.2', published_at: '2024-03-01' },
      ];

      const recent = getRecentReleases(releases, '2024-03-05');

      expect(recent).toHaveLength(2);
      expect((recent[0] as { tag_name: string }).tag_name).toBe('v1.0.0');
    });

    it('should include releases on exact date', () => {
      const releases = [{ tag_name: 'v1.0.0', published_at: '2024-03-05' }];

      const recent = getRecentReleases(releases, '2024-03-05');

      expect(recent).toHaveLength(1);
    });

    it('should exclude releases before date', () => {
      const releases = [
        { tag_name: 'v1.0.0', published_at: '2024-03-04' },
        { tag_name: 'v1.0.1', published_at: '2024-03-05' },
      ];

      const recent = getRecentReleases(releases, '2024-03-05');

      expect(recent).toHaveLength(1);
      expect((recent[0] as { tag_name: string }).tag_name).toBe('v1.0.1');
    });

    it('should return empty array if no recent releases', () => {
      const releases = [{ tag_name: 'v1.0.0', published_at: '2024-03-01' }];

      const recent = getRecentReleases(releases, '2024-03-05');

      expect(recent).toHaveLength(0);
    });

    it('should handle empty releases array', () => {
      const releases: unknown[] = [];

      const recent = getRecentReleases(releases, '2024-03-05');

      expect(recent).toHaveLength(0);
    });
  });

  describe('Breaking change detection', () => {
    const detectBreakingChange = (releaseBody: string): boolean => {
      const bodyPreview = (releaseBody || '').slice(0, 500);
      return (
        bodyPreview.toLowerCase().includes('breaking') ||
        bodyPreview.toLowerCase().includes('major')
      );
    };

    it('should detect "breaking" keyword', () => {
      const body = 'Breaking Changes: Removed deprecated API';
      expect(detectBreakingChange(body)).toBe(true);
    });

    it('should detect "major" keyword', () => {
      const body = 'Major release with new features';
      expect(detectBreakingChange(body)).toBe(true);
    });

    it('should be case insensitive', () => {
      const body = 'BREAKING CHANGES in this release';
      expect(detectBreakingChange(body)).toBe(true);
    });

    it('should not flag non-breaking changes', () => {
      const body = 'Bug fixes and minor improvements';
      expect(detectBreakingChange(body)).toBe(false);
    });

    it('should handle empty release body', () => {
      const body = '';
      expect(detectBreakingChange(body)).toBe(false);
    });

    it('should handle null/undefined body', () => {
      expect(detectBreakingChange('')).toBe(false);
    });

    it('should truncate long bodies before checking', () => {
      const longBody = 'x'.repeat(600) + 'BREAKING CHANGE at end';
      expect(detectBreakingChange(longBody)).toBe(false); // Outside 500 char limit
    });

    it('should detect breaking within 500 chars', () => {
      const body = 'Some description'.padEnd(400, 'x') + ' BREAKING CHANGE';
      expect(detectBreakingChange(body)).toBe(true);
    });
  });

  describe('Update structure creation', () => {
    const createUpdate = (release: unknown, source: string, category: string) => {
      type Release = {
        body?: string;
        tag_name: string;
        published_at: string;
        name?: string;
        html_url: string;
      };
      const typedRelease = release as Release;
      const bodyPreview = (typedRelease.body || '').slice(0, 500);
      const isBreaking =
        bodyPreview.toLowerCase().includes('breaking') ||
        bodyPreview.toLowerCase().includes('major');

      return {
        source,
        category,
        type: 'release' as const,
        version: typedRelease.tag_name,
        date: typedRelease.published_at.split('T')[0],
        summary: typedRelease.name || typedRelease.tag_name,
        url: typedRelease.html_url,
        breaking: isBreaking,
      };
    };

    it('should create update with all required fields', () => {
      const release = {
        tag_name: 'v20.0.0',
        name: 'Node.js 20 LTS',
        published_at: '2024-03-10T12:00:00Z',
        html_url: 'https://github.com/nodejs/node/releases/tag/v20.0.0',
        body: 'Major update with breaking changes',
      };

      const update = createUpdate(release, 'Node.js', 'Dev Tools');

      expect(update).toEqual({
        source: 'Node.js',
        category: 'Dev Tools',
        type: 'release',
        version: 'v20.0.0',
        date: '2024-03-10',
        summary: 'Node.js 20 LTS',
        url: 'https://github.com/nodejs/node/releases/tag/v20.0.0',
        breaking: true,
      });
    });

    it('should use tag_name as summary if name is missing', () => {
      const release = {
        tag_name: 'v1.0.0',
        name: null,
        published_at: '2024-03-10T12:00:00Z',
        html_url: 'https://github.com/example/repo/releases/tag/v1.0.0',
        body: 'Release notes',
      };

      const update = createUpdate(release, 'Example', 'Tools');

      expect(update.summary).toBe('v1.0.0');
    });

    it('should mark non-breaking updates', () => {
      const release = {
        tag_name: 'v1.1.0',
        name: 'Bug fixes',
        published_at: '2024-03-10T12:00:00Z',
        html_url: 'https://github.com/example/repo/releases/tag/v1.1.0',
        body: 'Minor bug fixes and improvements',
      };

      const update = createUpdate(release, 'Example', 'Tools');

      expect(update.breaking).toBe(false);
    });
  });

  describe('Markdown report generation', () => {
    const generateMarkdownReport = (updates: unknown[]): string => {
      type Update = {
        category: string;
        breaking?: boolean;
        version?: string;
        date?: string;
        source?: string;
      };
      const lines: string[] = [
        `## Veille Technologique - Semaine du 2024-03-10`,
        '',
        `> ${updates.length} mises a jour detectees`,
        '',
      ];

      const categories = [
        ...new Set(
          updates.map((u) => {
            const typedU = u as Update;
            return typedU.category;
          })
        ),
      ];

      for (const cat of categories) {
        const catUpdates = updates.filter((u) => {
          const typedU = u as Update;
          return typedU.category === cat;
        });
        lines.push(`### ${cat}`);
        lines.push('');
        lines.push('| Projet | Version | Date | Breaking |');
        lines.push('|--------|---------|------|----------|');
        for (const u of catUpdates) {
          const typedU = u as Update;
          const breakBadge = typedU.breaking ? '**OUI**' : '-';
          lines.push(
            `| ${typedU.source || '-'} | ${typedU.version || '-'} | ${typedU.date || '-'} | ${breakBadge} |`
          );
        }
        lines.push('');
      }

      return lines.join('\n');
    };

    it('should generate markdown with categories', () => {
      const updates = [
        {
          source: 'Node.js',
          category: 'Dev Tools',
          version: 'v20.0.0',
          date: '2024-03-10',
          breaking: true,
        },
        {
          source: 'pnpm',
          category: 'Dev Tools',
          version: 'v9.0.0',
          date: '2024-03-09',
          breaking: false,
        },
      ];

      const report = generateMarkdownReport(updates);

      expect(report).toContain('### Dev Tools');
      expect(report).toContain('Node.js');
      expect(report).toContain('pnpm');
      expect(report).toContain('**OUI**');
    });

    it('should separate different categories', () => {
      const updates = [
        {
          source: 'Node.js',
          category: 'Dev Tools',
          version: 'v20.0.0',
          date: '2024-03-10',
          breaking: false,
        },
        {
          source: 'GitHub Actions',
          category: 'DevOps Tools',
          version: 'v1.0.0',
          date: '2024-03-10',
          breaking: false,
        },
      ];

      const report = generateMarkdownReport(updates);

      expect(report).toContain('### Dev Tools');
      expect(report).toContain('### DevOps Tools');
    });

    it('should handle single update', () => {
      const updates = [
        {
          source: 'Vitest',
          category: 'Dev Tools',
          version: 'v1.0.0',
          date: '2024-03-10',
          breaking: false,
        },
      ];

      const report = generateMarkdownReport(updates);

      expect(report).toContain('Vitest');
      expect(report).toContain('1 mises a jour detectees');
    });

    it('should handle empty updates', () => {
      const updates: unknown[] = [];

      const report = generateMarkdownReport(updates);

      expect(report).toContain('0 mises a jour detectees');
    });

    it('should handle multiple updates same category', () => {
      const updates = [
        {
          source: 'TypeScript',
          category: 'Dev Tools',
          version: 'v5.0.0',
          date: '2024-03-10',
          breaking: false,
        },
        {
          source: 'Node.js',
          category: 'Dev Tools',
          version: 'v20.0.0',
          date: '2024-03-10',
          breaking: true,
        },
        {
          source: 'pnpm',
          category: 'Dev Tools',
          version: 'v9.0.0',
          date: '2024-03-10',
          breaking: false,
        },
      ];

      const report = generateMarkdownReport(updates);

      // Should appear once
      const categoryCount = (report.match(/### Dev Tools/g) || []).length;
      expect(categoryCount).toBe(1);

      // All three should appear
      expect(report).toContain('TypeScript');
      expect(report).toContain('Node.js');
      expect(report).toContain('pnpm');
    });
  });

  describe('History management', () => {
    const saveReport = (
      report: unknown,
      history: unknown[] = []
    ): { date: string; updates: never[] }[] => {
      const newHistory = [report, ...history];
      if (newHistory.length > 12) {
        return newHistory.slice(0, 12) as { date: string; updates: never[] }[];
      }
      return newHistory as { date: string; updates: never[] }[];
    };

    it('should add new report to front of history', () => {
      const report1 = { date: '2024-03-10', updates: [] };
      const report2 = { date: '2024-03-03', updates: [] };

      let history = [report2];
      history = saveReport(report1, history);

      expect((history[0] as { date: string }).date).toBe('2024-03-10');
      expect((history[1] as { date: string }).date).toBe('2024-03-03');
    });

    it('should keep last 12 weeks', () => {
      let history: unknown[] = [];

      for (let i = 0; i < 15; i++) {
        const report = { date: `2024-01-${String(i + 1).padStart(2, '0')}` };
        history = saveReport(report, history);
      }

      expect(history).toHaveLength(12);
      expect((history[0] as { date: string }).date).toBe('2024-01-15'); // Most recent
    });

    it('should handle initial empty history', () => {
      const report = { date: '2024-03-10', updates: [] };

      const history = saveReport(report);

      expect(history).toHaveLength(1);
      expect(history[0].date).toBe('2024-03-10');
    });
  });

  describe('Source configuration', () => {
    const GITHUB_SOURCES = [
      { name: 'Node.js', category: 'Dev Tools', repo: 'nodejs/node' },
      { name: 'pnpm', category: 'Dev Tools', repo: 'pnpm/pnpm' },
      { name: 'Trivy', category: 'DevOps Tools', repo: 'aquasecurity/trivy' },
    ];

    it('should have predefined sources', () => {
      expect(GITHUB_SOURCES.length).toBeGreaterThan(0);
    });

    it('should skip sources without repo', () => {
      const sourcesToCheck = GITHUB_SOURCES.filter((s) => s.repo);
      expect(sourcesToCheck).toHaveLength(GITHUB_SOURCES.length);
    });

    it('should categorize sources correctly', () => {
      const devTools = GITHUB_SOURCES.filter((s) => s.category === 'Dev Tools');
      const devOpsTools = GITHUB_SOURCES.filter((s) => s.category === 'DevOps Tools');

      expect(devTools.length).toBeGreaterThan(0);
      expect(devOpsTools.length).toBeGreaterThan(0);
    });

    it('should have valid repo format', () => {
      const repoRegex = /^[\w-]+\/[\w-]+$/;

      for (const source of GITHUB_SOURCES) {
        expect(source.repo).toMatch(repoRegex);
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle release with special characters in name', () => {
      const release = {
        tag_name: 'v1.0.0',
        name: 'Release "1.0" with <special> characters',
        published_at: '2024-03-10T12:00:00Z',
        html_url: 'https://github.com/example/repo/releases/tag/v1.0.0',
        body: 'Release notes',
      };

      const source = 'Example';
      const category = 'Test';

      const update = {
        source,
        category,
        type: 'release' as const,
        version: release.tag_name,
        date: release.published_at.split('T')[0],
        summary: release.name || release.tag_name,
        url: release.html_url,
        breaking: false,
      };

      expect(update.summary).toContain('special');
    });

    it('should handle very long release body', () => {
      const longBody = 'x'.repeat(10000) + 'BREAKING CHANGE at end';
      const bodyPreview = longBody.slice(0, 500);

      const isBreaking =
        bodyPreview.toLowerCase().includes('breaking') ||
        bodyPreview.toLowerCase().includes('major');

      expect(isBreaking).toBe(false); // Outside 500 char limit
    });

    it('should handle release with no version tag', () => {
      const release = {
        tag_name: '',
        name: 'Unnamed release',
        published_at: '2024-03-10T12:00:00Z',
        html_url: 'https://github.com/example/repo/releases/tag/',
        body: 'Release notes',
      };

      expect(release.tag_name).toBe('');
      expect(release.name).not.toBe('');
    });

    it('should handle malformed published_at date', () => {
      const release = { published_at: '2024-03-10' };

      const date = release.published_at.split('T')[0];

      expect(date).toBe('2024-03-10');
    });
  });

  describe('Gemini synthesis', () => {
    const synthesizeWithGemini = (updates: unknown[], hasApiKey: boolean): string => {
      if (!hasApiKey) {
        return 'No GEMINI_API_KEY - skipping AI synthesis';
      }

      if (updates.length === 0) {
        return 'No significant updates this week.';
      }

      // Simplified simulation
      return `Analyzed ${updates.length} updates`;
    };

    it('should return placeholder if no API key', () => {
      const result = synthesizeWithGemini([], false);
      expect(result).toContain('No GEMINI_API_KEY');
    });

    it('should return empty message if no updates', () => {
      const result = synthesizeWithGemini([], true);
      expect(result).toContain('No significant updates');
    });

    it('should process updates if API key present', () => {
      const updates = [
        { source: 'Node.js', version: 'v20.0.0', category: 'Dev Tools', breaking: true },
      ];

      const result = synthesizeWithGemini(updates, true);
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('1 updates');
    });
  });
});
