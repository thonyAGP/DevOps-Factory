/**
 * feedback-collector.test.ts
 *
 * Tests pour feedback-collector - logique de classification et scoring
 */

import { describe, it, expect } from 'vitest';

describe('feedback-collector logic', () => {
  describe('PR Outcome Classification', () => {
    type Outcome = 'merged' | 'closed' | 'modified' | 'open';

    it('should classify merged PR', () => {
      const pr = { state: 'closed', merged: true };
      const outcome: Outcome = pr.merged ? 'merged' : 'closed';

      expect(outcome).toBe('merged');
    });

    it('should classify closed without merge', () => {
      const pr = { state: 'closed', merged: false };
      const outcome: Outcome = pr.merged ? 'merged' : 'closed';

      expect(outcome).toBe('closed');
    });

    it('should classify open PR', () => {
      const outcome: Outcome = 'open';

      expect(outcome).toBe('open');
    });

    it('should detect modified PR (multiple commits)', () => {
      const prData = { commits: 3 };
      const wasModified = prData.commits > 1;

      expect(wasModified).toBe(true);
    });

    it('should detect unmodified PR (single commit)', () => {
      const prData = { commits: 1 };
      const wasModified = prData.commits > 1;

      expect(wasModified).toBe(false);
    });
  });

  describe('Source Detection from Labels', () => {
    type Source = 'self-heal' | 'test-scaffold' | 'ai-test-writer' | 'prettier-fix' | 'unknown';

    it('should detect self-heal from label', () => {
      const labels = ['self-heal', 'automated'];
      const source: Source = labels.includes('self-heal')
        ? 'self-heal'
        : labels.includes('test-scaffold')
          ? 'test-scaffold'
          : 'unknown';

      expect(source).toBe('self-heal');
    });

    it('should detect test-scaffold from label', () => {
      const labels = ['test-scaffold'];
      const source: Source = labels.includes('self-heal')
        ? 'self-heal'
        : labels.includes('test-scaffold')
          ? 'test-scaffold'
          : 'unknown';

      expect(source).toBe('test-scaffold');
    });

    it('should default to unknown if no matching label', () => {
      const labels = ['bug', 'enhancement'];
      const source: Source = labels.includes('self-heal')
        ? 'self-heal'
        : labels.includes('test-scaffold')
          ? 'test-scaffold'
          : 'unknown';

      expect(source).toBe('unknown');
    });

    it('should handle empty labels', () => {
      const labels: string[] = [];
      const source: Source = labels.includes('self-heal')
        ? 'self-heal'
        : labels.includes('test-scaffold')
          ? 'test-scaffold'
          : 'unknown';

      expect(source).toBe('unknown');
    });
  });

  describe('Pattern Confidence Adjustment', () => {
    it('should increase confidence when PR merged directly', () => {
      const currentConfidence = 0.7;
      const outcome = 'merged';
      const wasModified = false;

      const delta = outcome === 'merged' && !wasModified ? 0.1 : 0;
      const newConfidence = Math.min(1.0, currentConfidence + delta);

      expect(newConfidence).toBeCloseTo(0.8, 1);
    });

    it('should slightly increase confidence when merged after modifications', () => {
      const currentConfidence = 0.7;
      const outcome = 'merged';
      const wasModified = true;

      const delta = outcome === 'merged' ? (wasModified ? 0.05 : 0.1) : 0;
      const newConfidence = Math.min(1.0, currentConfidence + delta);

      expect(newConfidence).toBe(0.75);
    });

    it('should decrease confidence when PR closed', () => {
      const currentConfidence = 0.7;
      const outcome = 'closed';

      const delta = outcome === 'closed' ? -0.15 : 0;
      const newConfidence = Math.max(0.0, currentConfidence + delta);

      expect(newConfidence).toBeCloseTo(0.55, 1);
    });

    it('should not change confidence for open PRs', () => {
      const currentConfidence = 0.7;
      const outcome: string = 'open';

      const delta = outcome === 'merged' ? 0.1 : outcome === 'closed' ? -0.15 : 0;
      const newConfidence = currentConfidence + delta;

      expect(newConfidence).toBe(0.7);
    });

    it('should cap confidence at 1.0', () => {
      const currentConfidence = 0.95;
      const delta = 0.1;

      const newConfidence = Math.min(1.0, currentConfidence + delta);

      expect(newConfidence).toBe(1.0);
    });

    it('should cap confidence at 0.0', () => {
      const currentConfidence = 0.1;
      const delta = -0.15;

      const newConfidence = Math.max(0.0, currentConfidence + delta);

      expect(newConfidence).toBe(0.0);
    });
  });

  describe('Feedback Filtering', () => {
    interface Feedback {
      date: string;
      outcome: string;
      source: string;
    }

    it('should filter by outcome', () => {
      const feedbacks: Feedback[] = [
        { date: '2024-03-01', outcome: 'merged', source: 'self-heal' },
        { date: '2024-03-02', outcome: 'closed', source: 'prettier-fix' },
        { date: '2024-03-03', outcome: 'merged', source: 'test-scaffold' },
      ];

      const merged = feedbacks.filter((f) => f.outcome === 'merged');

      expect(merged).toHaveLength(2);
    });

    it('should filter by source', () => {
      const feedbacks: Feedback[] = [
        { date: '2024-03-01', outcome: 'merged', source: 'self-heal' },
        { date: '2024-03-02', outcome: 'closed', source: 'prettier-fix' },
        { date: '2024-03-03', outcome: 'merged', source: 'self-heal' },
      ];

      const selfHeal = feedbacks.filter((f) => f.source === 'self-heal');

      expect(selfHeal).toHaveLength(2);
    });

    it('should filter by date range', () => {
      const feedbacks: Feedback[] = [
        { date: '2024-02-01', outcome: 'merged', source: 'self-heal' },
        { date: '2024-03-15', outcome: 'closed', source: 'prettier-fix' },
        { date: '2024-03-20', outcome: 'merged', source: 'test-scaffold' },
      ];

      const afterMarch10 = feedbacks.filter((f) => f.date >= '2024-03-10');

      expect(afterMarch10).toHaveLength(2);
    });
  });

  describe('Success Rate Calculation', () => {
    it('should calculate success rate', () => {
      const total = 10;
      const merged = 7;

      const successRate = (merged / total) * 100;

      expect(successRate).toBe(70);
    });

    it('should handle 100% success', () => {
      const total = 5;
      const merged = 5;

      const successRate = (merged / total) * 100;

      expect(successRate).toBe(100);
    });

    it('should handle 0% success', () => {
      const total = 5;
      const merged = 0;

      const successRate = (merged / total) * 100;

      expect(successRate).toBe(0);
    });

    it('should round to 1 decimal', () => {
      const total = 3;
      const merged = 2;

      const successRate = Math.round((merged / total) * 100 * 10) / 10;

      expect(successRate).toBe(66.7);
    });
  });
});
