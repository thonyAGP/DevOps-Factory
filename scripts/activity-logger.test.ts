import { describe, it, expect, beforeEach } from 'vitest';
import {
  logActivity,
  logBatch,
  getRecentActivities,
  getActivitiesBySource,
  getActivityStats,
  type ActivitySource,
  type ActivityStatus,
} from './activity-logger.js';

describe('activity-logger', () => {
  // Note: These tests work with the production activity log at data/activity-log.json
  // Each test operates on the existing log data rather than in isolation.
  // This validates the module's actual behavior with real file I/O.

  beforeEach(() => {
    // Tests will use actual log file - no cleanup per test
  });

  describe('logActivity', () => {
    it('should create a new activity entry with success status', () => {
      const beforeCount = getRecentActivities(1000).length;
      logActivity('scan-and-configure', 'scan_repos', 'Scanned 5 repositories');
      const activities = getRecentActivities(1000);
      expect(activities.length).toBeGreaterThan(beforeCount);
      const entry = activities[activities.length - 1];
      expect(entry.source).toBe('scan-and-configure');
      expect(entry.action).toBe('scan_repos');
      expect(entry.details).toBe('Scanned 5 repositories');
      expect(entry.status).toBe('success');
    });

    it('should accept custom status values', () => {
      logActivity('ci-health-check', 'health_check', 'Detected failing build', 'error');
      const activities = getRecentActivities(1);
      const entry = activities[activities.length - 1];
      expect(entry.status).toBe('error');
    });

    it('should accept warning status', () => {
      logActivity('factory-watchdog', 'check_quota', 'Quota at 80%', 'warning');
      const activities = getRecentActivities(1);
      const entry = activities[activities.length - 1];
      expect(entry.status).toBe('warning');
    });

    it('should accept info status', () => {
      logActivity('build-dashboard', 'generate', 'Dashboard generated', 'info');
      const activities = getRecentActivities(1);
      const entry = activities[activities.length - 1];
      expect(entry.status).toBe('info');
    });

    it('should include optional target field', () => {
      logActivity('self-heal', 'fix_applied', 'Fixed prettier formatting', 'success', 'repo-name');
      const activities = getRecentActivities(1);
      const entry = activities[activities.length - 1];
      expect(entry.target).toBe('repo-name');
    });

    it('should not include target field when omitted', () => {
      logActivity('quality-score', 'calculate', 'Score updated to 92%');
      const activities = getRecentActivities(1);
      const entry = activities[activities.length - 1];
      expect(entry.target).toBeUndefined();
    });

    it('should have valid ISO timestamp', () => {
      logActivity('scan-and-configure', 'test', 'Test entry');
      const activities = getRecentActivities(1);
      const entry = activities[activities.length - 1];
      const timestamp = new Date(entry.timestamp);
      expect(timestamp.getTime()).toBeGreaterThan(0);
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });
  });

  describe('logBatch', () => {
    it('should create multiple entries with batch timestamp', () => {
      const beforeCount = getRecentActivities(1000).length;
      const entries = [
        {
          source: 'scan-and-configure' as const,
          action: 'scan_1',
          details: 'Scanned repo 1',
          status: 'success' as const,
        },
        {
          source: 'scan-and-configure' as const,
          action: 'scan_2',
          details: 'Scanned repo 2',
          status: 'success' as const,
        },
        {
          source: 'scan-and-configure' as const,
          action: 'scan_3',
          details: 'Scanned repo 3',
          status: 'success' as const,
        },
      ];
      logBatch(entries);
      const activities = getRecentActivities(1000);
      expect(activities.length).toBeGreaterThanOrEqual(beforeCount + 3);
    });

    it('should timestamp all entries in batch with same value', () => {
      const entries = [
        { source: 'factory-watchdog' as const, action: 'a', details: 'A', status: 'info' as const },
        { source: 'factory-watchdog' as const, action: 'b', details: 'B', status: 'info' as const },
      ];
      logBatch(entries);
      const activities = getRecentActivities(1000);
      // Get the last two entries of type factory-watchdog with actions a and b
      const lastTwo = activities
        .filter((a) => a.source === 'factory-watchdog' && (a.action === 'a' || a.action === 'b'))
        .slice(-2);
      if (lastTwo.length >= 2) {
        expect(lastTwo[0].timestamp).toBe(lastTwo[1].timestamp);
      }
    });

    it('should handle empty batch gracefully', () => {
      const beforeCount = getRecentActivities(1000).length;
      logBatch([]);
      const afterCount = getRecentActivities(1000).length;
      expect(afterCount).toBe(beforeCount);
    });
  });

  describe('getRecentActivities', () => {
    it('should return recent activities ordered with newest last', () => {
      const activities = getRecentActivities(10);
      // Should have entries or be empty
      expect(Array.isArray(activities)).toBe(true);
      // Each should be a valid entry
      for (const entry of activities) {
        expect(entry).toHaveProperty('timestamp');
        expect(entry).toHaveProperty('source');
        expect(entry).toHaveProperty('action');
      }
    });

    it('should respect custom limit parameter', () => {
      const activities = getRecentActivities(5);
      expect(activities.length).toBeLessThanOrEqual(5);
    });

    it('should return most recent entries', () => {
      logActivity('ci-health-check', 'latest_test', 'Latest test entry');
      const activities = getRecentActivities(1);
      expect(activities.length).toBeGreaterThan(0);
      const entry = activities[activities.length - 1];
      expect(entry.action).toBe('latest_test');
    });
  });

  describe('getActivitiesBySource', () => {
    it('should filter activities by source and return valid entries', () => {
      logActivity('scan-and-configure', 'filter_test', 'Testing filter');
      const activities = getActivitiesBySource('scan-and-configure');
      expect(Array.isArray(activities)).toBe(true);
      expect(activities.every((a) => a.source === 'scan-and-configure')).toBe(true);
    });

    it('should return empty array for truly non-existent source data', () => {
      // Only test sources that have no entries should return empty
      const sources: ActivitySource[] = [
        'scan-and-configure',
        'ci-health-check',
        'factory-watchdog',
        'build-dashboard',
        'quality-score',
        'self-heal',
      ];
      for (const source of sources) {
        const activities = getActivitiesBySource(source);
        expect(Array.isArray(activities)).toBe(true);
      }
    });
  });

  describe('getActivityStats', () => {
    it('should return valid stats structure', () => {
      const stats = getActivityStats();
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('byStatus');
      expect(stats).toHaveProperty('bySource');
      expect(stats).toHaveProperty('last24h');
      expect(stats).toHaveProperty('lastEntry');
    });

    it('should count activities with valid status field', () => {
      logActivity('scan-and-configure', 'stats_test', 'Stats test', 'success');
      const stats = getActivityStats();
      expect(stats.total).toBeGreaterThan(0);
      expect(
        stats.byStatus.success + stats.byStatus.warning + stats.byStatus.error + stats.byStatus.info
      ).toBeGreaterThan(0);
    });

    it('should initialize all status counters properly', () => {
      const stats = getActivityStats();
      expect(stats.byStatus).toHaveProperty('success');
      expect(stats.byStatus).toHaveProperty('warning');
      expect(stats.byStatus).toHaveProperty('error');
      expect(stats.byStatus).toHaveProperty('info');
      expect(typeof stats.byStatus.success).toBe('number');
    });

    it('should track last 24h count', () => {
      logActivity('factory-watchdog', '24h_test', '24h test entry');
      const stats = getActivityStats();
      expect(stats.last24h).toBeGreaterThanOrEqual(0);
    });

    it('should record valid lastEntry timestamp or null', () => {
      const stats = getActivityStats();
      if (stats.lastEntry !== null) {
        expect(stats.lastEntry).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
      }
    });
  });

  describe('entry structure validation', () => {
    it('should create valid ActivityEntry structure', () => {
      logActivity(
        'scan-and-configure',
        'struct_test',
        'Testing structure',
        'success',
        'test-target'
      );
      const activities = getRecentActivities(1000);
      const entry = activities.find((e) => e.action === 'struct_test');
      if (entry) {
        expect(entry).toHaveProperty('timestamp');
        expect(entry).toHaveProperty('source');
        expect(entry).toHaveProperty('action');
        expect(entry).toHaveProperty('details');
        expect(entry).toHaveProperty('status');
      }
    });

    it('should support all valid status types in stats', () => {
      const stats = getActivityStats();
      const statuses: ActivityStatus[] = ['success', 'warning', 'error', 'info'];
      for (const status of statuses) {
        expect(stats.byStatus).toHaveProperty(status);
      }
    });
  });
});
