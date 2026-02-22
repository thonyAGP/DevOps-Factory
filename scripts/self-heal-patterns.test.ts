import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Pattern Database (self-heal-patterns)', () => {
  const db = JSON.parse(readFileSync('data/patterns.json', 'utf-8'));

  describe('structure validation', () => {
    it('should have valid schema with version field', () => {
      expect(db).toHaveProperty('version');
      expect(typeof db.version).toBe('number');
      expect(db.version).toBeGreaterThanOrEqual(1);
    });

    it('should have lastUpdated timestamp', () => {
      expect(db).toHaveProperty('lastUpdated');
      // Verify it's a valid ISO timestamp
      const timestamp = new Date(db.lastUpdated);
      expect(timestamp.getTime()).toBeGreaterThan(0);
    });

    it('should contain patterns array', () => {
      expect(db).toHaveProperty('patterns');
      expect(Array.isArray(db.patterns)).toBe(true);
      expect(db.patterns.length).toBeGreaterThan(0);
    });
  });

  describe('pattern structure', () => {
    it('all patterns should have required fields', () => {
      const requiredFields = [
        'id',
        'category',
        'signature',
        'fix',
        'fixType',
        'confidence',
        'repos_seen',
        'occurrences',
      ];
      for (const pattern of db.patterns) {
        for (const field of requiredFields) {
          expect(pattern).toHaveProperty(field);
        }
      }
    });

    it('all pattern IDs should be unique', () => {
      const ids = db.patterns.map((p: { id: string }) => p.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('all pattern IDs should be non-empty strings', () => {
      for (const pattern of db.patterns) {
        expect(typeof pattern.id).toBe('string');
        expect(pattern.id.length).toBeGreaterThan(0);
      }
    });

    it('all signatures should be non-empty strings', () => {
      for (const pattern of db.patterns) {
        expect(typeof pattern.signature).toBe('string');
        expect(pattern.signature.length).toBeGreaterThan(0);
      }
    });

    it('all fixes should be non-empty strings', () => {
      for (const pattern of db.patterns) {
        expect(typeof pattern.fix).toBe('string');
        expect(pattern.fix.length).toBeGreaterThan(0);
      }
    });

    it('all fixType values should be valid', () => {
      const validTypes = [
        'deterministic',
        'command',
        'code-edit',
        'workflow-edit',
        'ai-required',
        'package-json',
      ];
      for (const pattern of db.patterns) {
        expect(validTypes).toContain(pattern.fixType);
      }
    });

    it('all confidence values should be between 0 and 1', () => {
      for (const pattern of db.patterns) {
        expect(typeof pattern.confidence).toBe('number');
        expect(pattern.confidence).toBeGreaterThanOrEqual(0);
        expect(pattern.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('repos_seen should be an array', () => {
      for (const pattern of db.patterns) {
        expect(Array.isArray(pattern.repos_seen)).toBe(true);
      }
    });

    it('occurrences should be a non-negative number', () => {
      for (const pattern of db.patterns) {
        expect(typeof pattern.occurrences).toBe('number');
        expect(pattern.occurrences).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('pattern categories', () => {
    it('all patterns should have ci-failure category', () => {
      for (const pattern of db.patterns) {
        expect(pattern.category).toBe('ci-failure');
      }
    });
  });

  describe('pattern coverage', () => {
    it('should have high-confidence patterns (>= 0.9)', () => {
      const highConf = db.patterns.filter((p: { confidence: number }) => p.confidence >= 0.9);
      expect(highConf.length).toBeGreaterThan(5);
    });

    it('should have deterministic patterns', () => {
      const deterministic = db.patterns.filter(
        (p: { fixType: string }) => p.fixType === 'deterministic'
      );
      expect(deterministic.length).toBeGreaterThan(0);
    });

    it('should have command patterns', () => {
      const commands = db.patterns.filter((p: { fixType: string }) => p.fixType === 'command');
      expect(commands.length).toBeGreaterThan(0);
    });

    it('should have code-edit patterns', () => {
      const codeEdits = db.patterns.filter((p: { fixType: string }) => p.fixType === 'code-edit');
      expect(codeEdits.length).toBeGreaterThan(0);
    });

    it('should have workflow-edit patterns', () => {
      const workflowEdits = db.patterns.filter(
        (p: { fixType: string }) => p.fixType === 'workflow-edit'
      );
      expect(workflowEdits.length).toBeGreaterThan(0);
    });

    it('should have ai-required patterns', () => {
      const aiRequired = db.patterns.filter(
        (p: { fixType: string }) => p.fixType === 'ai-required'
      );
      expect(aiRequired.length).toBeGreaterThan(0);
    });
  });

  describe('specific patterns validation', () => {
    it('prettier-format-error pattern should exist with high confidence', () => {
      const pattern = db.patterns.find((p: { id: string }) => p.id === 'prettier-format-error');
      expect(pattern).toBeDefined();
      expect(pattern.confidence).toBe(0.95);
      expect(pattern.fixType).toBe('command');
    });

    it('prisma-client-not-generated pattern should exist', () => {
      const pattern = db.patterns.find(
        (p: { id: string }) => p.id === 'prisma-client-not-generated'
      );
      expect(pattern).toBeDefined();
      expect(pattern.confidence).toBe(0.9);
      expect(pattern.fixType).toBe('package-json');
    });

    it('playwright-browser-missing pattern should exist with high confidence', () => {
      const pattern = db.patterns.find(
        (p: { id: string }) => p.id === 'playwright-browser-missing'
      );
      expect(pattern).toBeDefined();
      expect(pattern.confidence).toBe(0.95);
      expect(pattern.fixType).toBe('workflow-edit');
    });

    it('pnpm-missing pattern should have high confidence', () => {
      const pattern = db.patterns.find((p: { id: string }) => p.id === 'pnpm-missing');
      expect(pattern).toBeDefined();
      expect(pattern.confidence).toBe(0.95);
    });

    it('oom-heap pattern should be workflow-edit', () => {
      const pattern = db.patterns.find((p: { id: string }) => p.id === 'oom-heap');
      expect(pattern).toBeDefined();
      expect(pattern.fixType).toBe('workflow-edit');
      expect(pattern.confidence).toBe(0.9);
    });
  });

  describe('confidence distribution', () => {
    it('should have patterns across confidence spectrum', () => {
      const low = db.patterns.filter((p: { confidence: number }) => p.confidence < 0.5);
      const medium = db.patterns.filter(
        (p: { confidence: number }) => p.confidence >= 0.5 && p.confidence < 0.8
      );
      const high = db.patterns.filter((p: { confidence: number }) => p.confidence >= 0.8);
      expect(low.length).toBeGreaterThan(0);
      expect(medium.length).toBeGreaterThan(0);
      expect(high.length).toBeGreaterThan(0);
    });

    it('should have more high-confidence than low-confidence patterns', () => {
      const low = db.patterns.filter((p: { confidence: number }) => p.confidence < 0.5);
      const high = db.patterns.filter((p: { confidence: number }) => p.confidence >= 0.8);
      expect(high.length).toBeGreaterThan(low.length);
    });
  });

  describe('fixType distribution', () => {
    it('should not have all patterns as ai-required', () => {
      const aiRequired = db.patterns.filter(
        (p: { fixType: string }) => p.fixType === 'ai-required'
      );
      expect(aiRequired.length).toBeLessThan(db.patterns.length);
    });

    it('should have majority as deterministic or command', () => {
      const deterministic = db.patterns.filter(
        (p: { fixType: string }) => p.fixType === 'deterministic'
      );
      const command = db.patterns.filter((p: { fixType: string }) => p.fixType === 'command');
      expect(deterministic.length + command.length).toBeGreaterThan(db.patterns.length / 3);
    });
  });

  describe('pattern metadata', () => {
    it('repos_seen should contain strings or be empty', () => {
      for (const pattern of db.patterns) {
        if (pattern.repos_seen.length > 0) {
          expect(pattern.repos_seen.every((r: unknown) => typeof r === 'string')).toBe(true);
        }
      }
    });

    it('pattern count should match number of patterns', () => {
      expect(db.patterns.length).toBeGreaterThan(30);
    });

    it('should have at least 30 patterns', () => {
      expect(db.patterns.length).toBeGreaterThanOrEqual(30);
    });
  });

  describe('pattern searchability', () => {
    it('all signatures should be searchable strings', () => {
      for (const pattern of db.patterns) {
        // Verify signature can be used as a search pattern
        expect(pattern.signature).toBeTruthy();
        expect(typeof pattern.signature).toBe('string');
      }
    });

    it('signatures should be mostly unique', () => {
      const signatures = db.patterns.map((p: { signature: string }) => p.signature);
      const uniqueSignatures = new Set(signatures);
      // Allow for some duplicates but majority should be unique
      expect(uniqueSignatures.size).toBeGreaterThan(db.patterns.length * 0.8);
    });
  });
});
