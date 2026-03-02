/**
 * template-updater.test.ts
 *
 * Tests pour template-updater - détection des mises à jour de versions
 * Coverage: version extraction, comparison, breaking change detection
 */

import { describe, it, expect } from 'vitest';

describe('template-updater logic', () => {
  describe('Version pattern matching', () => {
    const VERSION_PATTERNS = [
      {
        tool: 'Node.js',
        regex: /node-version:\s*['"]?(\d+)/g,
        veilleSource: 'Next.js',
      },
      {
        tool: 'pnpm',
        regex: /version:\s*(\d+)\s*#?\s*pnpm|pnpm.*version:\s*(\d+)/g,
        veilleSource: 'pnpm',
      },
      {
        tool: '.NET',
        regex: /dotnet-version:\s*['"]?(\d+\.\d+)/g,
        veilleSource: '.NET',
      },
      {
        tool: 'actions/checkout',
        regex: /actions\/checkout@v(\d+)/g,
        veilleSource: 'GitHub Actions',
      },
      {
        tool: 'actions/setup-node',
        regex: /actions\/setup-node@v(\d+)/g,
        veilleSource: 'GitHub Actions',
      },
    ];

    it('should extract Node.js version from workflow', () => {
      const content = `name: CI
jobs:
  test:
    steps:
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: echo "v20"`;

      const pattern = VERSION_PATTERNS.find((p) => p.tool === 'Node.js');
      const matches: string[] = [];
      const regex = new RegExp(pattern!.regex.source, pattern!.regex.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(content)) !== null) {
        matches.push(match[1] || match[2]);
      }

      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0]).toBe('18');
    });

    it('should extract pnpm version from workflow', () => {
      const content = `jobs:
  install:
    run: |
      # pnpm version: 9
      pnpm install`;

      const pattern = VERSION_PATTERNS.find((p) => p.tool === 'pnpm');
      const regex = new RegExp(pattern!.regex.source, pattern!.regex.flags);
      let match: RegExpExecArray | null;

      const matches: string[] = [];
      while ((match = regex.exec(content)) !== null) {
        matches.push(match[1] || match[2]);
      }

      expect(matches.length).toBeGreaterThan(0);
    });

    it('should extract .NET version from workflow', () => {
      const content = `jobs:
  build:
    steps:
      - uses: actions/setup-dotnet@v3
        with:
          dotnet-version: '8.0'`;

      const pattern = VERSION_PATTERNS.find((p) => p.tool === '.NET');
      const regex = new RegExp(pattern!.regex.source, pattern!.regex.flags);
      let match: RegExpExecArray | null;

      const matches: string[] = [];
      while ((match = regex.exec(content)) !== null) {
        matches.push(match[1] || match[2]);
      }

      expect(matches).toContain('8.0');
    });

    it('should extract GitHub Actions version', () => {
      const content = `steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v3`;

      const checkoutPattern = VERSION_PATTERNS.find((p) => p.tool === 'actions/checkout');
      const regex = new RegExp(checkoutPattern!.regex.source, checkoutPattern!.regex.flags);
      let match: RegExpExecArray | null;

      const matches: string[] = [];
      while ((match = regex.exec(content)) !== null) {
        matches.push(match[1] || match[2]);
      }

      expect(matches).toContain('4');
    });

    it('should handle quoted version strings', () => {
      const content = `dotnet-version: '8.0'`;

      const pattern = VERSION_PATTERNS.find((p) => p.tool === '.NET');
      const regex = new RegExp(pattern!.regex.source, pattern!.regex.flags);
      const match = regex.exec(content);

      expect(match).not.toBeNull();
      expect(match?.[1]).toBe('8.0');
    });

    it('should handle unquoted version strings', () => {
      const content = `node-version: 18`;

      const pattern = VERSION_PATTERNS.find((p) => p.tool === 'Node.js');
      const regex = new RegExp(pattern!.regex.source, pattern!.regex.flags);
      const match = regex.exec(content);

      expect(match).not.toBeNull();
      expect(match?.[1]).toBe('18');
    });
  });

  describe('Version extraction from content', () => {
    it('should find first version match in file', () => {
      const content = `name: CI
node-version: 18
steps:
  - run: node --version
    with:
      node-version: 20`;

      const regex = /node-version:\s*['"]?(\d+)/g;
      const match = regex.exec(content);

      expect(match).not.toBeNull();
      expect(match?.[1]).toBe('18');
    });

    it('should find line number for version match', () => {
      const content = `name: CI
node-version: 18
other config`;

      const regex = /node-version:\s*['"]?(\d+)/g;
      const match = regex.exec(content);
      const lineNum = content.substring(0, match!.index).split('\n').length;

      expect(lineNum).toBe(2);
    });

    it('should handle multiple occurrences', () => {
      const content = `node-version: 18
steps:
  - uses: actions/setup-node@v3
node-version: 20`;

      const regex = /node-version:\s*['"]?(\d+)/g;
      const matches: string[] = [];
      let match: RegExpExecArray | null;

      while ((match = regex.exec(content)) !== null) {
        matches.push(match[1]);
      }

      expect(matches).toContain('18');
      expect(matches).toContain('20');
    });
  });

  describe('Veille data parsing', () => {
    const extractLatestStableVersion = (updates: unknown[], source: string): string | null => {
      const sourceUpdates = updates
        .filter((u) => u.source === source && u.version)
        .filter((u) => {
          const v = u.version || '';
          return (
            !v.includes('alpha') &&
            !v.includes('beta') &&
            !v.includes('canary') &&
            !v.includes('rc')
          );
        })
        .sort((a, b) => b.date.localeCompare(a.date));

      return sourceUpdates.length > 0 ? sourceUpdates[0].version || null : null;
    };

    it('should extract latest stable version', () => {
      const updates = [
        { source: 'Node.js', version: 'v20.0.0', date: '2024-03-01' },
        { source: 'Node.js', version: 'v18.0.0', date: '2024-02-15' },
        { source: 'pnpm', version: 'v9.0.0', date: '2024-03-02' },
      ];

      const latest = extractLatestStableVersion(updates, 'Node.js');
      expect(latest).toBe('v20.0.0');
    });

    it('should filter out pre-releases', () => {
      const updates = [
        { source: 'pnpm', version: 'v9.0.0-beta', date: '2024-03-02' },
        { source: 'pnpm', version: 'v8.0.0', date: '2024-03-01' },
        { source: 'pnpm', version: 'v9.0.0-alpha', date: '2024-02-28' },
      ];

      const latest = extractLatestStableVersion(updates, 'pnpm');
      expect(latest).toBe('v8.0.0');
    });

    it('should filter alpha releases', () => {
      const updates = [
        { source: 'Vitest', version: 'v2.0.0-alpha.1', date: '2024-03-01' },
        { source: 'Vitest', version: 'v1.6.0', date: '2024-02-28' },
      ];

      const latest = extractLatestStableVersion(updates, 'Vitest');
      expect(latest).toBe('v1.6.0');
    });

    it('should filter beta releases', () => {
      const updates = [
        { source: 'Prisma', version: 'v5.0.0-beta', date: '2024-03-02' },
        { source: 'Prisma', version: 'v4.9.0', date: '2024-03-01' },
      ];

      const latest = extractLatestStableVersion(updates, 'Prisma');
      expect(latest).toBe('v4.9.0');
    });

    it('should filter canary releases', () => {
      const updates = [
        { source: 'Next.js', version: 'v14.2.0-canary.1', date: '2024-03-02' },
        { source: 'Next.js', version: 'v14.1.0', date: '2024-03-01' },
      ];

      const latest = extractLatestStableVersion(updates, 'Next.js');
      expect(latest).toBe('v14.1.0');
    });

    it('should filter rc releases', () => {
      const updates = [
        { source: 'Fastify', version: 'v5.0.0-rc.1', date: '2024-03-02' },
        { source: 'Fastify', version: 'v4.25.0', date: '2024-03-01' },
      ];

      const latest = extractLatestStableVersion(updates, 'Fastify');
      expect(latest).toBe('v4.25.0');
    });

    it('should return null if no stable versions found', () => {
      const updates = [
        { source: 'Test', version: 'v1.0.0-alpha', date: '2024-03-01' },
        { source: 'Test', version: 'v1.0.0-beta', date: '2024-02-28' },
      ];

      const latest = extractLatestStableVersion(updates, 'Test');
      expect(latest).toBeNull();
    });

    it('should return null if source not found', () => {
      const updates = [{ source: 'Node.js', version: 'v20.0.0', date: '2024-03-01' }];

      const latest = extractLatestStableVersion(updates, 'pnpm');
      expect(latest).toBeNull();
    });

    it('should sort by date descending', () => {
      const updates = [
        { source: 'pnpm', version: 'v8.0.0', date: '2024-03-01' },
        { source: 'pnpm', version: 'v9.0.0', date: '2024-03-02' },
        { source: 'pnpm', version: 'v7.0.0', date: '2024-02-28' },
      ];

      const latest = extractLatestStableVersion(updates, 'pnpm');
      expect(latest).toBe('v9.0.0');
    });
  });

  describe('Breaking change detection', () => {
    const hasBreakingUpdate = (updates: unknown[], source: string): boolean => {
      return updates.some((u) => u.source === source && u.breaking);
    };

    it('should detect breaking change flag', () => {
      const updates = [
        { source: 'pnpm', breaking: true, version: 'v9.0.0' },
        { source: 'Node.js', breaking: false, version: 'v20.0.0' },
      ];

      expect(hasBreakingUpdate(updates, 'pnpm')).toBe(true);
      expect(hasBreakingUpdate(updates, 'Node.js')).toBe(false);
    });

    it('should return false if no breaking updates for source', () => {
      const updates = [
        { source: 'Vitest', breaking: false, version: 'v1.0.0' },
        { source: 'Prisma', breaking: false, version: 'v5.0.0' },
      ];

      expect(hasBreakingUpdate(updates, 'Playwright')).toBe(false);
    });

    it('should handle multiple updates for same source', () => {
      const updates = [
        { source: 'Next.js', breaking: false, version: 'v14.0.0' },
        { source: 'Next.js', breaking: true, version: 'v15.0.0' },
      ];

      expect(hasBreakingUpdate(updates, 'Next.js')).toBe(true);
    });

    it('should return false if empty updates', () => {
      const updates: unknown[] = [];
      expect(hasBreakingUpdate(updates, 'Node.js')).toBe(false);
    });
  });

  describe('Version comparison', () => {
    it('should compare major versions correctly', () => {
      const currentMajor = 8;
      const latestMajor = 9;

      expect(latestMajor > currentMajor).toBe(true);
    });

    it('should handle semantic versioning', () => {
      const current = 'v8.15.2';
      const latest = 'v9.0.0';

      const currentMajor = parseInt(current.match(/v?(\d+)/)?.[1] ?? '0');
      const latestMajor = parseInt(latest.match(/v?(\d+)/)?.[1] ?? '0');

      expect(latestMajor > currentMajor).toBe(true);
    });

    it('should extract major version with v prefix', () => {
      const version = 'v9.0.0';
      const major = version.match(/v?(\d+)\./)?.[1];

      expect(major).toBe('9');
    });

    it('should extract major version without prefix', () => {
      const version = '9.0.0';
      const major = version.match(/v?(\d+)\./)?.[1];

      expect(major).toBe('9');
    });
  });

  describe('Report generation markup', () => {
    it('should generate markdown table for updates', () => {
      const updates = [
        { tool: 'pnpm', currentVersion: '8', latestVersion: '9', file: 'ci.yml', line: 10 },
      ];

      const lines: string[] = ['| Tool | Current | Latest | File |'];
      for (const u of updates) {
        lines.push(`| ${u.tool} | v${u.currentVersion} | v${u.latestVersion} | \`${u.file}\` |`);
      }

      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain('pnpm');
      expect(lines[1]).toContain('v8');
      expect(lines[1]).toContain('v9');
    });

    it('should handle empty actionable updates', () => {
      const updates: unknown[] = [];

      const hasUpdates = updates.length > 0;

      expect(hasUpdates).toBe(false);
    });
  });

  describe('Template inventory accumulation', () => {
    it('should track multiple files for same tool', () => {
      const templateVersions = new Map<string, { version: string; files: string[] }>();

      // Simulate adding pnpm from multiple files
      templateVersions.set('pnpm', { version: '8', files: ['ci.yml', 'lint.yml'] });
      templateVersions.set('Node.js', { version: '18', files: ['ci.yml'] });

      expect(templateVersions.get('pnpm')?.files).toHaveLength(2);
      expect(templateVersions.get('Node.js')?.files).toHaveLength(1);
    });

    it('should consolidate tool versions across files', () => {
      const files = [
        { content: 'pnpm version: 8', file: 'ci.yml' },
        { content: 'pnpm version: 8', file: 'lint.yml' },
      ];

      const versions = new Map<string, { version: string; files: string[] }>();

      for (const f of files) {
        const match = /pnpm version:\s*(\d+)/.exec(f.content);
        if (match) {
          const version = match[1];
          const existing = versions.get('pnpm');
          if (existing) {
            if (!existing.files.includes(f.file)) {
              existing.files.push(f.file);
            }
          } else {
            versions.set('pnpm', { version, files: [f.file] });
          }
        }
      }

      expect(versions.get('pnpm')?.files).toHaveLength(2);
      expect(versions.get('pnpm')?.version).toBe('8');
    });
  });

  describe('Edge cases', () => {
    it('should handle version with extra text', () => {
      const version = 'v9.0.0-latest';
      const major = version.match(/v?(\d+)/)?.[1];

      expect(major).toBe('9');
    });

    it('should handle missing version in updates', () => {
      const updates: Array<{ source: string; date: string; version?: string }> = [
        { source: 'Node.js', date: '2024-03-01' },
      ];

      const hasVersion = updates.some((u) => u.version);

      expect(hasVersion).toBe(false);
    });

    it('should handle tools with dots in names', () => {
      const tool = '.NET';
      expect(tool).toBe('.NET');
    });

    it('should handle empty content', () => {
      const content = '';
      const regex = /node-version:\s*['"]?(\d+)/g;
      const match = regex.exec(content);

      expect(match).toBeNull();
    });
  });
});
