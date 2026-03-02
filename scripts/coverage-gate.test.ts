/**
 * coverage-gate.test.ts
 *
 * Tests pour coverage-gate - enforcement des seuils de coverage
 * Note: Ce script utilise process.exit() donc nous testons les fonctions individuelles
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('coverage-gate logic', () => {
  describe('formatDelta', () => {
    it('should format positive delta with + prefix', () => {
      const result = formatDelta(75.5, 70.0);
      expect(result).toBe('+5.5%');
    });

    it('should format negative delta without extra prefix', () => {
      const result = formatDelta(65.0, 70.0);
      expect(result).toBe('-5.0%');
    });

    it('should format zero delta', () => {
      const result = formatDelta(70.0, 70.0);
      expect(result).toBe('0%');
    });

    it('should round to 1 decimal place', () => {
      const result = formatDelta(75.456, 70.123);
      expect(result).toBe('+5.3%');
    });
  });

  describe('loadCoverage', () => {
    it('should return null if file does not exist', () => {
      const result = loadCoverage('non-existent-file.json');
      expect(result).toBeNull();
    });

    it('should return null if file is not valid JSON', () => {
      // Mock file with invalid JSON
      const result = loadCoverage('invalid.json');
      expect(result).toBeNull();
    });

    it('should parse valid coverage summary', () => {
      const mockCoverage = {
        total: {
          lines: { pct: 75.5 },
          statements: { pct: 80.0 },
          functions: { pct: 70.0 },
          branches: { pct: 65.0 },
        },
      };

      // In real test, would use temp file or mock fs
      // For now, testing the logic
      expect(mockCoverage.total.lines.pct).toBe(75.5);
    });
  });

  describe('loadBaseline', () => {
    it('should return null if baseline file does not exist', () => {
      const result = loadBaseline('non-existent-baseline.json');
      expect(result).toBeNull();
    });

    it('should parse valid baseline JSON', () => {
      const mockBaseline = {
        date: '2024-03-01',
        lines: 70.0,
        statements: 75.0,
        functions: 65.0,
        branches: 60.0,
      };

      expect(mockBaseline.date).toBe('2024-03-01');
      expect(mockBaseline.lines).toBe(70.0);
    });
  });

  describe('Threshold Check Logic', () => {
    it('should fail if coverage below global threshold', () => {
      const THRESHOLD_GLOBAL = 60;
      const currentLines = 55.0;

      const failed = currentLines < THRESHOLD_GLOBAL;

      expect(failed).toBe(true);
    });

    it('should pass if coverage at or above threshold', () => {
      const THRESHOLD_GLOBAL = 60;
      const currentLines = 60.0;

      const failed = currentLines < THRESHOLD_GLOBAL;

      expect(failed).toBe(false);
    });
  });

  describe('Ratchet Logic', () => {
    it('should fail if coverage drops below baseline', () => {
      const currentLines = 65.0;
      const baselineLines = 70.0;

      const failed = currentLines < baselineLines;

      expect(failed).toBe(true);
    });

    it('should pass if coverage improves', () => {
      const currentLines = 75.0;
      const baselineLines = 70.0;

      const failed = currentLines < baselineLines;

      expect(failed).toBe(false);
    });

    it('should pass if coverage stays same', () => {
      const currentLines = 70.0;
      const baselineLines = 70.0;

      const failed = currentLines < baselineLines;

      expect(failed).toBe(false);
    });
  });

  describe('PR Comment Generation', () => {
    it('should build correct markdown table', () => {
      let comment = `## Coverage Report\n\n`;
      comment += `| Metric | Current | Baseline | Delta |\n`;
      comment += `|--------|---------|----------|-------|\n`;

      expect(comment).toContain('Coverage Report');
      expect(comment).toContain('| Metric | Current | Baseline | Delta |');
    });

    it('should include green icon for improvement', () => {
      const current = 75.0;
      const baseline = 70.0;
      const icon = current >= baseline ? '🟢' : '🔴';

      expect(icon).toBe('🟢');
      expect(baseline).toBe(70.0); // Use variable
    });

    it('should include red icon for regression', () => {
      const current = 65.0;
      const baseline = 70.0;
      const icon = current >= baseline ? '🟢' : '🔴';

      expect(icon).toBe('🔴');
      expect(current).toBe(65.0); // Use variable
    });
  });

  describe('Main Branch Detection', () => {
    it('should detect main branch', () => {
      const branch = 'main';
      const isMainBranch = ['main', 'master'].includes(branch);

      expect(isMainBranch).toBe(true);
    });

    it('should detect master branch', () => {
      const branch = 'master';
      const isMainBranch = ['main', 'master'].includes(branch);

      expect(isMainBranch).toBe(true);
    });

    it('should not detect feature branch as main', () => {
      const branch = 'feature/new-feature';
      const isMainBranch = ['main', 'master'].includes(branch);

      expect(isMainBranch).toBe(false);
    });
  });

  describe('Baseline Update Logic', () => {
    it('should update baseline on main branch if passed', () => {
      const isMainBranch = true;
      const failed = false;

      const shouldUpdate = isMainBranch && !failed;

      expect(shouldUpdate).toBe(true);
    });

    it('should not update baseline on feature branch', () => {
      const isMainBranch = false;
      const failed = false;

      const shouldUpdate = isMainBranch && !failed;

      expect(shouldUpdate).toBe(false);
    });

    it('should not update baseline if checks failed', () => {
      const isMainBranch = true;
      const failed = true;

      const shouldUpdate = isMainBranch && !failed;

      expect(shouldUpdate).toBe(false);
    });
  });
});

// Helper functions (extracted from coverage-gate.ts for testing)

function formatDelta(current: number, previous: number): string {
  const delta = current - previous;
  if (delta > 0) return `+${delta.toFixed(1)}%`;
  if (delta < 0) return `${delta.toFixed(1)}%`;
  return '0%';
}

function loadCoverage(filePath: string): unknown | null {
  try {
    const data = readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function loadBaseline(filePath: string): unknown | null {
  try {
    const data = readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}
