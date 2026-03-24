/**
 * activity-logger.test.ts
 *
 * Tests pour le module activity-logger
 * Coverage: fonctions exportées + edge cases
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  logActivity,
  logBatch,
  getRecentActivities,
  getActivitiesBySource,
  getActivityStats,
  __setLogPath,
  __resetLogPath,
  type ActivitySource,
  type ActivityStatus,
} from './activity-logger.js';

// Mock du fichier de log pour tests
const TEST_LOG_PATH = 'data/activity-log.test.json';

describe('activity-logger', () => {
  beforeEach(() => {
    // Utiliser un fichier de test isolé
    __setLogPath(TEST_LOG_PATH);

    // Nettoyer log de test avant chaque test
    if (existsSync(TEST_LOG_PATH)) {
      unlinkSync(TEST_LOG_PATH);
    }
  });

  afterEach(() => {
    // Nettoyer après chaque test
    if (existsSync(TEST_LOG_PATH)) {
      unlinkSync(TEST_LOG_PATH);
    }

    // Réinitialiser le chemin par défaut
    __resetLogPath();
  });

  describe('logActivity', () => {
    it('should create log file if it does not exist', () => {
      logActivity('scan-and-configure', 'test-action', 'test details');

      expect(existsSync(TEST_LOG_PATH)).toBe(true);
    });

    it('should log activity with all required fields', () => {
      logActivity('ci-health-check', 'check-workflow', 'Workflow passed', 'success', 'my-repo');

      const log = JSON.parse(readFileSync(TEST_LOG_PATH, 'utf-8'));
      const lastEntry = log.entries[log.entries.length - 1];

      expect(lastEntry).toMatchObject({
        source: 'ci-health-check',
        action: 'check-workflow',
        details: 'Workflow passed',
        status: 'success',
        target: 'my-repo',
      });
      expect(lastEntry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should default status to success if not provided', () => {
      logActivity('build-dashboard', 'generate', 'Dashboard built');

      const log = JSON.parse(readFileSync(TEST_LOG_PATH, 'utf-8'));
      const lastEntry = log.entries[log.entries.length - 1];

      expect(lastEntry.status).toBe('success');
    });

    it('should handle optional target parameter', () => {
      logActivity('quality-score', 'calculate', 'Score computed');

      const log = JSON.parse(readFileSync(TEST_LOG_PATH, 'utf-8'));
      const lastEntry = log.entries[log.entries.length - 1];

      expect(lastEntry.target).toBeUndefined();
    });

    it('should append to existing log', () => {
      logActivity('scan-and-configure', 'first', 'First entry');
      logActivity('factory-watchdog', 'second', 'Second entry');

      const log = JSON.parse(readFileSync(TEST_LOG_PATH, 'utf-8'));

      expect(log.entries).toHaveLength(2);
      expect(log.entries[0].action).toBe('first');
      expect(log.entries[1].action).toBe('second');
    });
  });

  describe('logBatch', () => {
    it('should log multiple entries at once with same timestamp', () => {
      const entries = [
        {
          source: 'scan-and-configure' as ActivitySource,
          action: 'scan1',
          details: 'Details 1',
          status: 'success' as ActivityStatus,
        },
        {
          source: 'ci-health-check' as ActivitySource,
          action: 'scan2',
          details: 'Details 2',
          status: 'warning' as ActivityStatus,
        },
        {
          source: 'quality-score' as ActivitySource,
          action: 'scan3',
          details: 'Details 3',
          status: 'error' as ActivityStatus,
        },
      ];

      logBatch(entries);

      const log = JSON.parse(readFileSync(TEST_LOG_PATH, 'utf-8'));

      expect(log.entries).toHaveLength(3);
      expect(log.entries[0].timestamp).toBe(log.entries[1].timestamp);
      expect(log.entries[1].timestamp).toBe(log.entries[2].timestamp);
    });

    it('should handle empty batch', () => {
      logBatch([]);

      const log = JSON.parse(readFileSync(TEST_LOG_PATH, 'utf-8'));
      expect(log.entries).toHaveLength(0);
    });
  });

  describe('pruneOldEntries - via logActivity', () => {
    it('should keep entries within 30 days', () => {
      // Simuler entrée ancienne (35 jours)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 35);

      const log = {
        version: 1,
        entries: [
          {
            timestamp: oldDate.toISOString(),
            source: 'scan-and-configure',
            action: 'old-action',
            details: 'Old entry',
            status: 'success',
          },
        ],
      };

      writeFileSync(TEST_LOG_PATH, JSON.stringify(log));

      // Ajouter nouvelle entrée (devrait purger l'ancienne)
      logActivity('build-dashboard', 'new-action', 'New entry');

      const updatedLog = JSON.parse(readFileSync(TEST_LOG_PATH, 'utf-8'));

      expect(updatedLog.entries).toHaveLength(1);
      expect(updatedLog.entries[0].action).toBe('new-action');
    });

    it('should keep recent entries (less than 7 days)', () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 3);

      const log = {
        version: 1,
        entries: [
          {
            timestamp: recentDate.toISOString(),
            source: 'factory-watchdog',
            action: 'recent-action',
            details: 'Recent entry',
            status: 'info',
          },
        ],
      };

      writeFileSync(TEST_LOG_PATH, JSON.stringify(log));

      logActivity('quality-score', 'new-action', 'New entry');

      const updatedLog = JSON.parse(readFileSync(TEST_LOG_PATH, 'utf-8'));

      expect(updatedLog.entries).toHaveLength(2);
      expect(updatedLog.entries[0].action).toBe('recent-action');
      expect(updatedLog.entries[1].action).toBe('new-action');
    });
  });

  describe('getRecentActivities', () => {
    it('should return last N activities', () => {
      // Créer 100 entrées
      const entries = Array.from({ length: 100 }, (_, i) => ({
        source: 'scan-and-configure' as ActivitySource,
        action: `action-${i}`,
        details: `Entry ${i}`,
        status: 'success' as ActivityStatus,
      }));

      logBatch(entries);

      const recent = getRecentActivities(10);

      expect(recent).toHaveLength(10);
      expect(recent[0].action).toBe('action-90'); // 100 - 10 = 90
      expect(recent[9].action).toBe('action-99');
    });

    it('should default to 50 if no limit provided', () => {
      const entries = Array.from({ length: 60 }, (_, i) => ({
        source: 'build-dashboard' as ActivitySource,
        action: `action-${i}`,
        details: `Entry ${i}`,
        status: 'info' as ActivityStatus,
      }));

      logBatch(entries);

      const recent = getRecentActivities();

      expect(recent).toHaveLength(50);
    });

    it('should return all entries if total < limit', () => {
      logActivity('ci-health-check', 'action1', 'Entry 1');
      logActivity('quality-score', 'action2', 'Entry 2');

      const recent = getRecentActivities(100);

      expect(recent).toHaveLength(2);
    });
  });

  describe('getActivitiesBySource', () => {
    it('should filter activities by source', () => {
      logActivity('scan-and-configure', 'scan1', 'Scan 1');
      logActivity('ci-health-check', 'check1', 'Check 1');
      logActivity('scan-and-configure', 'scan2', 'Scan 2');
      logActivity('quality-score', 'score1', 'Score 1');

      const scanActivities = getActivitiesBySource('scan-and-configure');

      expect(scanActivities).toHaveLength(2);
      expect(scanActivities[0].action).toBe('scan1');
      expect(scanActivities[1].action).toBe('scan2');
    });

    it('should return empty array if no activities match source', () => {
      logActivity('build-dashboard', 'build1', 'Build 1');

      const activities = getActivitiesBySource('factory-watchdog');

      expect(activities).toHaveLength(0);
    });
  });

  describe('getActivityStats', () => {
    it('should return correct stats for empty log', () => {
      const stats = getActivityStats();

      expect(stats).toEqual({
        total: 0,
        byStatus: { success: 0, warning: 0, error: 0, info: 0 },
        bySource: {},
        last24h: 0,
        lastEntry: null,
      });
    });

    it('should count activities by status', () => {
      logActivity('scan-and-configure', 'a1', 'Entry 1', 'success');
      logActivity('ci-health-check', 'a2', 'Entry 2', 'warning');
      logActivity('quality-score', 'a3', 'Entry 3', 'error');
      logActivity('build-dashboard', 'a4', 'Entry 4', 'success');
      logActivity('self-heal', 'a5', 'Entry 5', 'info');

      const stats = getActivityStats();

      expect(stats.byStatus).toEqual({
        success: 2,
        warning: 1,
        error: 1,
        info: 1,
      });
    });

    it('should count activities by source', () => {
      logActivity('scan-and-configure', 'a1', 'Entry 1');
      logActivity('scan-and-configure', 'a2', 'Entry 2');
      logActivity('ci-health-check', 'a3', 'Entry 3');

      const stats = getActivityStats();

      expect(stats.bySource).toEqual({
        'scan-and-configure': 2,
        'ci-health-check': 1,
      });
    });

    it('should count activities in last 24h', () => {
      // Entrée ancienne (30h ago)
      const oldDate = new Date();
      oldDate.setHours(oldDate.getHours() - 30);

      const log = {
        version: 1,
        entries: [
          {
            timestamp: oldDate.toISOString(),
            source: 'factory-watchdog',
            action: 'old',
            details: 'Old',
            status: 'success',
          },
        ],
      };

      writeFileSync(TEST_LOG_PATH, JSON.stringify(log));

      // Entrées récentes
      logActivity('build-dashboard', 'recent1', 'Recent 1');
      logActivity('quality-score', 'recent2', 'Recent 2');

      const stats = getActivityStats();

      expect(stats.total).toBe(3);
      expect(stats.last24h).toBe(2); // Seulement les 2 récentes
    });

    it('should return last entry timestamp', () => {
      logActivity('scan-and-configure', 'action1', 'Entry 1');
      logActivity('ci-health-check', 'action2', 'Entry 2');

      const stats = getActivityStats();

      expect(stats.lastEntry).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('Edge Cases', () => {
    it('should handle corrupted log file gracefully', () => {
      // Écrire JSON invalide
      mkdirSync(dirname(TEST_LOG_PATH), { recursive: true });
      writeFileSync(TEST_LOG_PATH, 'invalid json content');

      // Ne devrait pas crasher, mais créer un nouveau log
      logActivity('scan-and-configure', 'action', 'Details');

      const log = JSON.parse(readFileSync(TEST_LOG_PATH, 'utf-8'));
      expect(log.entries).toHaveLength(1);
    });

    it('should handle very long details string', () => {
      const longDetails = 'x'.repeat(10000);

      logActivity('build-dashboard', 'long-action', longDetails);

      const log = JSON.parse(readFileSync(TEST_LOG_PATH, 'utf-8'));
      expect(log.entries[0].details).toBe(longDetails);
    });

    it('should handle special characters in action/details', () => {
      const specialChars = 'Test with "quotes", \\backslashes\\ and \nnewlines';

      logActivity('quality-score', 'special', specialChars);

      const log = JSON.parse(readFileSync(TEST_LOG_PATH, 'utf-8'));
      expect(log.entries[0].details).toBe(specialChars);
    });
  });
});
