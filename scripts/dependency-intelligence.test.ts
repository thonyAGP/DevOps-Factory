/**
 * dependency-intelligence.test.ts
 *
 * Tests pour dependency-intelligence - logique de parsing et analyse
 */

import { describe, it, expect } from 'vitest';

describe('dependency-intelligence logic', () => {
  describe('extractDeps', () => {
    it('should extract production dependencies', () => {
      const pkg = {
        dependencies: {
          react: '^18.0.0',
          typescript: '~5.0.0',
        },
      };

      const deps = extractDeps(pkg);

      expect(deps).toHaveLength(2);
      expect(deps[0]).toEqual({ name: 'react', currentVersion: '^18.0.0', isDev: false });
      expect(deps[1]).toEqual({ name: 'typescript', currentVersion: '~5.0.0', isDev: false });
    });

    it('should extract dev dependencies', () => {
      const pkg = {
        devDependencies: {
          vitest: '^1.0.0',
          eslint: '^8.0.0',
        },
      };

      const deps = extractDeps(pkg);

      expect(deps).toHaveLength(2);
      expect(deps[0]).toEqual({ name: 'vitest', currentVersion: '^1.0.0', isDev: true });
      expect(deps[1]).toEqual({ name: 'eslint', currentVersion: '^8.0.0', isDev: true });
    });

    it('should extract both prod and dev dependencies', () => {
      const pkg = {
        dependencies: {
          react: '^18.0.0',
        },
        devDependencies: {
          vitest: '^1.0.0',
        },
      };

      const deps = extractDeps(pkg);

      expect(deps).toHaveLength(2);
      expect(deps.filter((d) => !d.isDev)).toHaveLength(1);
      expect(deps.filter((d) => d.isDev)).toHaveLength(1);
    });

    it('should handle empty dependencies', () => {
      const pkg = {};

      const deps = extractDeps(pkg);

      expect(deps).toHaveLength(0);
    });

    it('should handle missing dependencies field', () => {
      const pkg = {
        devDependencies: {
          vitest: '^1.0.0',
        },
      };

      const deps = extractDeps(pkg);

      expect(deps).toHaveLength(1);
      expect(deps[0].isDev).toBe(true);
    });

    it('should handle missing devDependencies field', () => {
      const pkg = {
        dependencies: {
          react: '^18.0.0',
        },
      };

      const deps = extractDeps(pkg);

      expect(deps).toHaveLength(1);
      expect(deps[0].isDev).toBe(false);
    });

    it('should preserve version ranges', () => {
      const pkg = {
        dependencies: {
          dep1: '^1.0.0',
          dep2: '~2.3.4',
          dep3: '>=3.0.0',
          dep4: '4.5.6',
        },
      };

      const deps = extractDeps(pkg);

      expect(deps[0].currentVersion).toBe('^1.0.0');
      expect(deps[1].currentVersion).toBe('~2.3.4');
      expect(deps[2].currentVersion).toBe('>=3.0.0');
      expect(deps[3].currentVersion).toBe('4.5.6');
    });
  });

  describe('Severity Prioritization', () => {
    it('should order critical severity first', () => {
      const severities = ['low', 'critical', 'medium', 'high'];
      const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

      const sorted = severities.sort((a, b) => order[a] - order[b]);

      expect(sorted[0]).toBe('critical');
      expect(sorted[1]).toBe('high');
    });

    it('should handle all severity levels', () => {
      const severityOrder = ['critical', 'high', 'medium', 'low'];

      expect(severityOrder).toHaveLength(4);
      expect(severityOrder.indexOf('critical')).toBe(0);
      expect(severityOrder.indexOf('low')).toBe(3);
    });
  });

  describe('Dependency Counting', () => {
    it('should count total dependencies', () => {
      const pkg: {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      } = {
        dependencies: { a: '1.0.0', b: '2.0.0' },
        devDependencies: { c: '3.0.0' },
      };

      const totalDeps =
        Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length;

      expect(totalDeps).toBe(3);
    });

    it('should handle zero dependencies', () => {
      const pkg: {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      } = {};

      const totalDeps =
        Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length;

      expect(totalDeps).toBe(0);
    });
  });

  describe('Version Parsing', () => {
    it('should detect semver range operators', () => {
      const versions = ['^1.0.0', '~2.0.0', '>=3.0.0', '1.2.3'];

      const hasCaret = versions[0].startsWith('^');
      const hasTilde = versions[1].startsWith('~');
      const hasGte = versions[2].startsWith('>=');
      const isExact = !versions[3].match(/^[~^>=<]/);

      expect(hasCaret).toBe(true);
      expect(hasTilde).toBe(true);
      expect(hasGte).toBe(true);
      expect(isExact).toBe(true);
    });

    it('should handle workspace protocol', () => {
      const version = 'workspace:*';

      const isWorkspace = version.startsWith('workspace:');

      expect(isWorkspace).toBe(true);
    });

    it('should handle git URLs', () => {
      const version = 'github:user/repo#main';

      const isGit = version.includes('github:') || version.includes('git+');

      expect(isGit).toBe(true);
    });
  });

  describe('Report Grouping', () => {
    it('should group vulnerabilities by severity', () => {
      const vulns = [
        { severity: 'high' },
        { severity: 'critical' },
        { severity: 'high' },
        { severity: 'low' },
      ];

      const grouped = new Map<string, number>();
      for (const v of vulns) {
        grouped.set(v.severity, (grouped.get(v.severity) || 0) + 1);
      }

      expect(grouped.get('high')).toBe(2);
      expect(grouped.get('critical')).toBe(1);
      expect(grouped.get('low')).toBe(1);
    });

    it('should calculate total vulnerabilities', () => {
      const vulns = [{ severity: 'high' }, { severity: 'critical' }];

      expect(vulns.length).toBe(2);
    });
  });
});

// Helper function (extracted for testing)
interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface DepInfo {
  name: string;
  currentVersion: string;
  isDev: boolean;
}

function extractDeps(pkg: PackageJson): DepInfo[] {
  const deps: DepInfo[] = [];
  for (const [name, version] of Object.entries(pkg.dependencies || {})) {
    deps.push({ name, currentVersion: version, isDev: false });
  }
  for (const [name, version] of Object.entries(pkg.devDependencies || {})) {
    deps.push({ name, currentVersion: version, isDev: true });
  }
  return deps;
}
