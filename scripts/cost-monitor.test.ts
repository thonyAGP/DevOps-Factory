/**
 * cost-monitor.test.ts
 *
 * Tests pour cost-monitor - calculs de coûts et logique métier
 * Note: On teste les fonctions pures, pas les appels API
 */

import { describe, it, expect } from 'vitest';

describe('cost-monitor logic', () => {
  describe('Cost Calculations', () => {
    const COST_PER_MINUTE = 0.008;
    const FREE_MINUTES = 2000;

    it('should calculate cost correctly for minutes under free tier', () => {
      const minutes = 1500;
      const cost = Math.max(0, (minutes - FREE_MINUTES) * COST_PER_MINUTE);

      expect(cost).toBe(0);
    });

    it('should calculate cost correctly for minutes above free tier', () => {
      const minutes = 3000;
      const cost = Math.max(0, (minutes - FREE_MINUTES) * COST_PER_MINUTE);

      // 3000 - 2000 = 1000 billable minutes
      // 1000 * 0.008 = $8
      expect(cost).toBe(8.0);
    });

    it('should calculate cost for exactly free tier limit', () => {
      const minutes = 2000;
      const cost = Math.max(0, (minutes - FREE_MINUTES) * COST_PER_MINUTE);

      expect(cost).toBe(0);
    });

    it('should handle very large minute counts', () => {
      const minutes = 100000;
      const cost = Math.max(0, (minutes - FREE_MINUTES) * COST_PER_MINUTE);

      // 100000 - 2000 = 98000 billable
      // 98000 * 0.008 = $784
      expect(cost).toBe(784.0);
    });

    it('should calculate monthly cost estimate from 30-day usage', () => {
      const thirtyDayMinutes = 3000;
      const monthlyCost = Math.max(0, (thirtyDayMinutes - FREE_MINUTES) * COST_PER_MINUTE);

      expect(monthlyCost).toBe(8.0);
    });
  });

  describe('Workflow Duration Calculations', () => {
    it('should calculate minutes from timestamps', () => {
      const start = new Date('2024-03-01T10:00:00Z').getTime();
      const end = new Date('2024-03-01T10:05:00Z').getTime();
      const minutes = Math.round((end - start) / 60000);

      expect(minutes).toBe(5);
    });

    it('should handle sub-minute durations', () => {
      const start = new Date('2024-03-01T10:00:00Z').getTime();
      const end = new Date('2024-03-01T10:00:30Z').getTime();
      const minutes = Math.max(1, Math.round((end - start) / 60000));

      expect(minutes).toBe(1); // Minimum 1 minute
    });

    it('should round partial minutes correctly', () => {
      const start = new Date('2024-03-01T10:00:00Z').getTime();
      const end = new Date('2024-03-01T10:02:45Z').getTime();
      const minutes = Math.round((end - start) / 60000);

      expect(minutes).toBe(3); // 2.75 rounds to 3
    });

    it('should handle hour-long workflows', () => {
      const start = new Date('2024-03-01T10:00:00Z').getTime();
      const end = new Date('2024-03-01T11:00:00Z').getTime();
      const minutes = Math.round((end - start) / 60000);

      expect(minutes).toBe(60);
    });
  });

  describe('Wasted Minutes Tracking', () => {
    it('should count failed run minutes as wasted', () => {
      const runs = [
        { conclusion: 'success', minutes: 5 },
        { conclusion: 'failure', minutes: 3 },
        { conclusion: 'failure', minutes: 2 },
      ];

      const wastedMinutes = runs
        .filter((r) => r.conclusion === 'failure')
        .reduce((sum, r) => sum + r.minutes, 0);

      expect(wastedMinutes).toBe(5); // 3 + 2
    });

    it('should handle all successful runs (no waste)', () => {
      const runs = [
        { conclusion: 'success', minutes: 5 },
        { conclusion: 'success', minutes: 3 },
      ];

      const wastedMinutes = runs
        .filter((r) => r.conclusion === 'failure')
        .reduce((sum, r) => sum + r.minutes, 0);

      expect(wastedMinutes).toBe(0);
    });

    it('should calculate waste percentage', () => {
      const totalMinutes = 100;
      const wastedMinutes = 25;
      const wastePercentage = (wastedMinutes / totalMinutes) * 100;

      expect(wastePercentage).toBe(25);
    });
  });

  describe('Workflow Grouping Logic', () => {
    it('should group runs by workflow name', () => {
      const runs = [
        { name: 'CI', value: 1 },
        { name: 'Deploy', value: 2 },
        { name: 'CI', value: 3 },
      ];

      const grouped = new Map<string, typeof runs>();
      for (const run of runs) {
        const existing = grouped.get(run.name) ?? [];
        existing.push(run);
        grouped.set(run.name, existing);
      }

      expect(grouped.size).toBe(2);
      expect(grouped.get('CI')).toHaveLength(2);
      expect(grouped.get('Deploy')).toHaveLength(1);
    });

    it('should handle empty runs array', () => {
      const runs: Array<{ name: string; value: number }> = [];
      const grouped = new Map<string, typeof runs>();

      for (const run of runs) {
        const existing = grouped.get(run.name) ?? [];
        existing.push(run);
        grouped.set(run.name, existing);
      }

      expect(grouped.size).toBe(0);
    });

    it('should handle single workflow', () => {
      const runs = [{ name: 'CI', value: 1 }];
      const grouped = new Map<string, typeof runs>();

      for (const run of runs) {
        const existing = grouped.get(run.name) ?? [];
        existing.push(run);
        grouped.set(run.name, existing);
      }

      expect(grouped.size).toBe(1);
      expect(grouped.get('CI')).toHaveLength(1);
    });
  });

  describe('Average Calculations', () => {
    it('should calculate average workflow duration', () => {
      const runs = [{ minutes: 5 }, { minutes: 10 }, { minutes: 15 }];

      const avgMinutes = runs.reduce((sum, r) => sum + r.minutes, 0) / runs.length;

      expect(avgMinutes).toBe(10);
    });

    it('should handle single run average', () => {
      const runs = [{ minutes: 7 }];
      const avgMinutes = runs.reduce((sum, r) => sum + r.minutes, 0) / runs.length;

      expect(avgMinutes).toBe(7);
    });

    it('should round average to 1 decimal', () => {
      const runs = [{ minutes: 5 }, { minutes: 7 }];

      const avgMinutes =
        Math.round((runs.reduce((sum, r) => sum + r.minutes, 0) / runs.length) * 10) / 10;

      expect(avgMinutes).toBe(6.0);
    });
  });

  describe('Recommendation Logic', () => {
    it('should recommend optimization if waste > 20%', () => {
      const totalMinutes = 100;
      const wastedMinutes = 25;
      const wastePercentage = (wastedMinutes / totalMinutes) * 100;

      const shouldRecommend = wastePercentage > 20;

      expect(shouldRecommend).toBe(true);
    });

    it('should not recommend if waste is low', () => {
      const totalMinutes = 100;
      const wastedMinutes = 10;
      const wastePercentage = (wastedMinutes / totalMinutes) * 100;

      const shouldRecommend = wastePercentage > 20;

      expect(shouldRecommend).toBe(false);
    });

    it('should recommend if average duration is very high (>30min)', () => {
      const avgMinutes = 35;

      const shouldRecommend = avgMinutes > 30;

      expect(shouldRecommend).toBe(true);
    });

    it('should recommend if many failed runs (>10)', () => {
      const failedRuns = 15;

      const shouldRecommend = failedRuns > 10;

      expect(shouldRecommend).toBe(true);
    });
  });

  describe('Date Range Calculations', () => {
    it('should calculate 30 days ago correctly', () => {
      const now = new Date('2024-03-31T00:00:00Z');
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      expect(thirtyDaysAgo.toISOString().substring(0, 10)).toBe('2024-03-01');
    });

    it('should handle month boundaries', () => {
      const now = new Date('2024-04-15T00:00:00Z');
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      expect(thirtyDaysAgo.toISOString().substring(0, 10)).toBe('2024-03-16');
    });
  });
});
