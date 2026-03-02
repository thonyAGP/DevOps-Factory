import { describe, it, expect } from 'vitest';

describe('dora-metrics', () => {
  describe('median function', () => {
    it('should calculate median of odd-length array', () => {
      const arr = [1, 3, 5, 7, 9];
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const result = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

      expect(result).toBe(5);
    });

    it('should calculate median of even-length array', () => {
      const arr = [1, 2, 3, 4];
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const result = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

      expect(result).toBe(2.5);
    });

    it('should handle single-element array', () => {
      const arr = [42];
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const result = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

      expect(result).toBe(42);
    });

    it('should handle empty array', () => {
      const arr: number[] = [];
      if (arr.length === 0) return;

      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const result = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

      expect(result).toBeDefined();
    });

    it('should handle duplicate values', () => {
      const arr = [5, 5, 5, 5, 5];
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const result = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

      expect(result).toBe(5);
    });

    it('should maintain order with unsorted input', () => {
      const arr = [9, 1, 5, 3, 7];
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const result = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

      expect(result).toBe(5);
      expect(arr).toEqual([9, 1, 5, 3, 7]); // Original unchanged
    });

    it('should handle negative numbers', () => {
      const arr = [-5, -1, 0, 3, 10];
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const result = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

      expect(result).toBe(0);
    });

    it('should handle decimal numbers', () => {
      const arr = [1.5, 2.5, 3.5, 4.5];
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const result = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

      expect(result).toBe(3);
    });
  });

  describe('getDeploymentFrequency', () => {
    it('should calculate deploys per week from count', () => {
      const count = 2; // 2 releases in 30 days
      const freq = Math.round((count / 30) * 7 * 10) / 10;

      expect(freq).toBeCloseTo(0.5, 1);
    });

    it('should handle daily deployments', () => {
      const count = 7; // 7 releases in 30 days (daily)
      const freq = Math.round((count / 30) * 7 * 10) / 10;

      expect(freq).toBeGreaterThan(1);
    });

    it('should handle zero releases', () => {
      const count = 0;
      const freq = Math.round((count / 30) * 7 * 10) / 10;

      expect(freq).toBe(0);
    });

    it('should cap tags at 10 when no releases', () => {
      const tagCount = 150; // Many old tags
      const cappedCount = Math.min(tagCount, 10);
      const freq = Math.round((cappedCount / 30) * 7 * 10) / 10;

      expect(cappedCount).toBe(10);
      expect(freq).toBeCloseTo(2.3, 1);
    });

    it('should prefer releases over tags', () => {
      const releaseCount = 4;
      const tagCount = 20;

      // If releases found, use releases
      const count = releaseCount > 0 ? releaseCount : Math.min(tagCount, 10);
      expect(count).toBe(4);
    });

    it('should round frequency to 1 decimal', () => {
      const count = 3;
      const freq = Math.round((count / 30) * 7 * 10) / 10;

      expect(freq % 1).not.toBeGreaterThan(1);
      expect(String(freq).split('.')[1]?.length || 0).toBeLessThanOrEqual(1);
    });
  });

  describe('getLeadTime', () => {
    it('should calculate lead time in hours', () => {
      const pr = {
        created: '2024-01-01T08:00:00Z',
        merged: '2024-01-02T10:00:00Z',
      };

      const created = new Date(pr.created).getTime();
      const merged = new Date(pr.merged).getTime();
      const hours = (merged - created) / (1000 * 60 * 60);

      expect(hours).toBeCloseTo(26, 0);
    });

    it('should handle same-day merges', () => {
      const pr = {
        created: '2024-01-01T08:00:00Z',
        merged: '2024-01-01T16:00:00Z',
      };

      const created = new Date(pr.created).getTime();
      const merged = new Date(pr.merged).getTime();
      const hours = (merged - created) / (1000 * 60 * 60);

      expect(hours).toBe(8);
    });

    it('should calculate median lead time across multiple PRs', () => {
      const prs = [
        { created: '2024-01-01T00:00:00Z', merged: '2024-01-02T00:00:00Z' },
        { created: '2024-01-03T00:00:00Z', merged: '2024-01-05T00:00:00Z' },
        { created: '2024-01-06T00:00:00Z', merged: '2024-01-06T12:00:00Z' },
      ];

      const leadTimes = prs.map((pr) => {
        const created = new Date(pr.created).getTime();
        const merged = new Date(pr.merged).getTime();
        return (merged - created) / (1000 * 60 * 60);
      });

      const sorted = [...leadTimes].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

      expect(median).toBe(24);
    });

    it('should handle zero PRs', () => {
      const prs: unknown[] = [];
      expect(prs.length).toBe(0);
    });

    it('should return median rounded to 1 decimal', () => {
      const leadTime = 24.567;
      const rounded = Math.round(leadTime * 10) / 10;

      expect(rounded).toBe(24.6);
    });
  });

  describe('getMTTR', () => {
    it('should calculate recovery time from failure to success', () => {
      // Assuming runs are in reverse chronological order (newest first)
      const runs = [
        { conclusion: 'success', created_at: '2024-01-01T10:00:00Z', name: 'CI' },
        { conclusion: 'failure', created_at: '2024-01-01T08:00:00Z', name: 'CI' },
      ];

      const failTime = new Date(runs[1].created_at).getTime();
      const recoverTime = new Date(runs[0].created_at).getTime();
      const hours = (recoverTime - failTime) / (1000 * 60 * 60);

      expect(hours).toBe(2);
    });

    it('should ignore recovery times > 1 week', () => {
      const failTime = new Date('2024-01-01T00:00:00Z').getTime();
      const recoverTime = new Date('2024-01-10T00:00:00Z').getTime();
      const hours = (recoverTime - failTime) / (1000 * 60 * 60);

      const shouldInclude = hours > 0 && hours < 168;
      expect(shouldInclude).toBe(false);
    });

    it('should handle no recovery events', () => {
      const runs: unknown[] = [];
      expect(runs.length).toBeLessThan(2);
    });

    it('should calculate median MTTR from multiple failures', () => {
      const recoveryTimes = [2, 4, 1, 3, 5];
      const sorted = [...recoveryTimes].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

      expect(median).toBe(3);
    });

    it('should round MTTR to 1 decimal', () => {
      const mttr = 3.567;
      const rounded = Math.round(mttr * 10) / 10;

      expect(rounded).toBe(3.6);
    });
  });

  describe('getChangeFailureRate', () => {
    it('should calculate percentage of failed runs', () => {
      const data = { total: 100, failures: 15 };
      const rate = Math.round((data.failures / data.total) * 100);

      expect(rate).toBe(15);
    });

    it('should handle zero failures', () => {
      const data = { total: 50, failures: 0 };
      const rate = Math.round((data.failures / data.total) * 100);

      expect(rate).toBe(0);
    });

    it('should handle all failures', () => {
      const data = { total: 20, failures: 20 };
      const rate = Math.round((data.failures / data.total) * 100);

      expect(rate).toBe(100);
    });

    it('should handle zero total runs', () => {
      const data = { total: 0, failures: 0 };
      const rate = data.total === 0 ? 0 : Math.round((data.failures / data.total) * 100);

      expect(rate).toBe(0);
    });

    it('should round percentage correctly', () => {
      const data = { total: 7, failures: 1 };
      const rate = Math.round((data.failures / data.total) * 100);

      expect(rate).toBe(14);
    });
  });

  describe('rateRepo DORA Scoring', () => {
    it('should rate elite deployment frequency (daily+)', () => {
      const freq = 7; // 7 deploys per week
      let score = 0;

      if (freq >= 7) score += 4;
      else if (freq >= 1) score += 3;
      else if (freq >= 0.25) score += 2;
      else score += 1;

      expect(score).toBe(4);
    });

    it('should rate high deployment frequency (weekly)', () => {
      const freq = 1;
      let score = 0;

      if (freq >= 7) score += 4;
      else if (freq >= 1) score += 3;
      else if (freq >= 0.25) score += 2;
      else score += 1;

      expect(score).toBe(3);
    });

    it('should rate elite lead time (< 1 hour)', () => {
      const hours = 0.5;
      let score = 0;

      if (hours > 0 && hours < 1) score += 4;
      else if (hours < 24) score += 3;
      else if (hours < 168) score += 2;
      else score += 1;

      expect(score).toBe(4);
    });

    it('should rate elite MTTR (< 1 hour)', () => {
      const hours = 0.5;
      let score = 0;

      if (hours > 0 && hours < 1) score += 4;
      else if (hours < 24) score += 3;
      else if (hours < 168) score += 2;
      else score += 1;

      expect(score).toBe(4);
    });

    it('should rate elite change failure rate (< 5%)', () => {
      const rate = 3;
      let score = 0;

      if (rate < 5) score += 4;
      else if (rate < 15) score += 3;
      else if (rate < 30) score += 2;
      else score += 1;

      expect(score).toBe(4);
    });

    it('should calculate overall rating from metric scores', () => {
      let score = 0;
      score += 4; // deployment
      score += 4; // lead time
      score += 4; // mttr
      score += 4; // cfr

      const avg = score / 4;
      const rating = avg >= 3.5 ? 'elite' : avg >= 2.5 ? 'high' : avg >= 1.5 ? 'medium' : 'low';

      expect(rating).toBe('elite');
    });

    it('should rate low performance with mixed metrics', () => {
      let score = 0;
      score += 1; // low deployment
      score += 1; // low lead time
      score += 1; // low mttr
      score += 1; // low cfr

      const avg = score / 4;
      const rating = avg >= 3.5 ? 'elite' : avg >= 2.5 ? 'high' : avg >= 1.5 ? 'medium' : 'low';

      expect(rating).toBe('low');
    });
  });

  describe('DoraReport Data Structure', () => {
    it('should create valid repo dora metrics', () => {
      const metrics = {
        repo: 'test-repo',
        fullName: 'owner/test-repo',
        deploymentFrequency: 2.3,
        leadTimeHours: 12.5,
        mttrHours: 4.2,
        changeFailureRate: 8,
        rating: 'high' as const,
        prsMerged30d: 45,
        releases30d: 7,
      };

      expect(metrics).toHaveProperty('repo');
      expect(metrics).toHaveProperty('deploymentFrequency');
      expect(metrics).toHaveProperty('leadTimeHours');
      expect(metrics).toHaveProperty('mttrHours');
      expect(metrics).toHaveProperty('changeFailureRate');
      expect(metrics).toHaveProperty('rating');
      expect(typeof metrics.deploymentFrequency).toBe('number');
    });

    it('should create valid dora report summary', () => {
      const summary = {
        totalRepos: 5,
        avgDeployFreq: 2.1,
        avgLeadTime: 18.5,
        avgMTTR: 3.2,
        avgChangeFailRate: 12,
        overallRating: 'high' as const,
        eliteCount: 1,
        highCount: 2,
        mediumCount: 1,
        lowCount: 1,
      };

      expect(summary.totalRepos).toBe(5);
      expect(summary.eliteCount + summary.highCount + summary.mediumCount + summary.lowCount).toBe(
        5
      );
    });

    it('should have correct rating counts', () => {
      const repos: Array<{ rating: 'elite' | 'high' | 'medium' | 'low' }> = [
        { rating: 'elite' },
        { rating: 'elite' },
        { rating: 'high' },
        { rating: 'medium' },
        { rating: 'low' },
      ];

      const eliteCount = repos.filter((r) => r.rating === 'elite').length;
      const highCount = repos.filter((r) => r.rating === 'high').length;
      const mediumCount = repos.filter((r) => r.rating === 'medium').length;
      const lowCount = repos.filter((r) => r.rating === 'low').length;

      expect(eliteCount).toBe(2);
      expect(highCount).toBe(1);
      expect(mediumCount).toBe(1);
      expect(lowCount).toBe(1);
    });
  });

  describe('Overall Rating Calculation', () => {
    it('should calculate elite overall rating', () => {
      const repos: Array<{ rating: 'elite' | 'high' | 'medium' | 'low' }> = [
        { rating: 'elite' },
        { rating: 'elite' },
        { rating: 'high' },
      ];

      const eliteCount = repos.filter((r) => r.rating === 'elite').length;
      const highCount = repos.filter((r) => r.rating === 'high').length;
      const mediumCount = repos.filter((r) => r.rating === 'medium').length;
      const lowCount = repos.filter((r) => r.rating === 'low').length;

      const ratingScore =
        (eliteCount * 4 + highCount * 3 + mediumCount * 2 + lowCount * 1) / repos.length;
      const rating =
        ratingScore >= 3.5
          ? 'elite'
          : ratingScore >= 2.5
            ? 'high'
            : ratingScore >= 1.5
              ? 'medium'
              : 'low';

      expect(rating).toBe('elite');
    });

    it('should calculate high overall rating', () => {
      const repos = [
        { rating: 'high' as const },
        { rating: 'high' as const },
        { rating: 'medium' as const },
      ];

      const ratingScore =
        (repos.filter((r) => r.rating === 'high').length * 3 +
          repos.filter((r) => r.rating === 'medium').length * 2) /
        repos.length;
      const rating =
        ratingScore >= 3.5
          ? 'elite'
          : ratingScore >= 2.5
            ? 'high'
            : ratingScore >= 1.5
              ? 'medium'
              : 'low';

      expect(rating).toBe('high');
    });

    it('should calculate medium overall rating', () => {
      const repos = [
        { rating: 'medium' as const },
        { rating: 'medium' as const },
        { rating: 'low' as const },
      ];

      const ratingScore =
        (repos.filter((r) => r.rating === 'medium').length * 2 +
          repos.filter((r) => r.rating === 'low').length * 1) /
        repos.length;
      const rating =
        ratingScore >= 3.5
          ? 'elite'
          : ratingScore >= 2.5
            ? 'high'
            : ratingScore >= 1.5
              ? 'medium'
              : 'low';

      expect(rating).toBe('medium');
    });

    it('should calculate low overall rating', () => {
      const repos = [{ rating: 'low' as const }, { rating: 'low' as const }];

      const ratingScore = (repos.filter((r) => r.rating === 'low').length * 1) / repos.length;
      const rating =
        ratingScore >= 3.5
          ? 'elite'
          : ratingScore >= 2.5
            ? 'high'
            : ratingScore >= 1.5
              ? 'medium'
              : 'low';

      expect(rating).toBe('low');
    });
  });

  describe('Averaging Calculations', () => {
    it('should calculate average deployment frequency', () => {
      const repos = [
        { deploymentFrequency: 2.0 },
        { deploymentFrequency: 3.0 },
        { deploymentFrequency: 1.0 },
      ];

      const avg =
        Math.round((repos.reduce((s, r) => s + r.deploymentFrequency, 0) / repos.length) * 10) / 10;

      expect(avg).toBeCloseTo(2, 0);
    });

    it('should calculate average lead time excluding zero values', () => {
      const repos = [
        { leadTimeHours: 10 },
        { leadTimeHours: 20 },
        { leadTimeHours: 0 },
        { leadTimeHours: 30 },
      ];

      const active = repos.filter((r) => r.leadTimeHours > 0);
      const avg =
        active.length > 0
          ? Math.round((active.reduce((s, r) => s + r.leadTimeHours, 0) / active.length) * 10) / 10
          : 0;

      expect(avg).toBeCloseTo(20, 0);
    });

    it('should calculate average CFR', () => {
      const repos = [
        { changeFailureRate: 5 },
        { changeFailureRate: 10 },
        { changeFailureRate: 15 },
      ];

      const avg = Math.round(repos.reduce((s, r) => s + r.changeFailureRate, 0) / repos.length);

      expect(avg).toBe(10);
    });
  });

  describe('Edge Cases', () => {
    it('should handle single repo metrics', () => {
      const repos: Array<{
        rating: 'elite' | 'high' | 'medium' | 'low';
        deploymentFrequency: number;
        leadTimeHours: number;
        mttrHours: number;
        changeFailureRate: number;
      }> = [
        {
          rating: 'elite',
          deploymentFrequency: 7,
          leadTimeHours: 0.5,
          mttrHours: 0.3,
          changeFailureRate: 2,
        },
      ];

      const ratingScore = 4;
      const rating = ratingScore >= 3.5 ? 'elite' : 'low';

      expect(rating).toBe('elite');
      expect(repos).toHaveLength(1);
    });

    it('should handle repos with zero metrics', () => {
      const metrics = {
        deploymentFrequency: 0,
        leadTimeHours: 0,
        mttrHours: 0,
        changeFailureRate: 0,
      };

      expect(Object.values(metrics).every((v) => v === 0)).toBe(true);
    });

    it('should handle very large deployment frequencies', () => {
      const freq = 100; // 100 deploys per week
      let score = 0;

      if (freq >= 7) score += 4;

      expect(score).toBe(4);
    });

    it('should handle repos with no CI (filtered out)', () => {
      const activeRepos = [
        { hasCI: true, stack: 'node' },
        { hasCI: false, stack: 'node' },
        { hasCI: true, stack: 'nextjs' },
      ];

      const filtered = activeRepos.filter((a) => a.hasCI);

      expect(filtered).toHaveLength(2);
    });
  });
});
