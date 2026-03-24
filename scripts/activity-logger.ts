/**
 * activity-logger.ts
 *
 * Shared module for recording Factory activity events.
 * All scripts log their actions here for dashboard visibility.
 *
 * Storage: data/activity-log.json (30-day rolling retention)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type ActivityStatus = 'success' | 'warning' | 'error' | 'info';

export type ActivitySource =
  | 'scan-and-configure'
  | 'ci-health-check'
  | 'factory-watchdog'
  | 'build-dashboard'
  | 'quality-score'
  | 'self-heal'
  | 'recommendation-engine'
  | 'outcome-registry'
  | 'migration-tracker'
  | 'template-updater'
  | 'sync-registry'
  | 'compliance-report'
  | 'auto-fix-prettier'
  | 'cost-monitor'
  | 'dora-metrics'
  | 'audit-pr-outcomes'
  | 'coverage-baseline'
  | 'coverage-gate'
  | 'cross-repo-update'
  | 'security-posture'
  | 'template-drift'
  | 'redeploy-templates'
  | 'weekly-veille'
  | 'dependency-intelligence'
  | 'auto-generate-tests'
  | 'knowledge-graph';

export interface ActivityEntry {
  timestamp: string;
  source: ActivitySource;
  action: string;
  target?: string;
  details: string;
  status: ActivityStatus;
}

interface ActivityLog {
  version: 1;
  entries: ActivityEntry[];
}

// Configurable log path (can be overridden for testing)
let LOG_PATH = 'data/activity-log.json';
const MAX_AGE_DAYS = 7;
const ARCHIVE_DIR = 'data/archive';

// Allow tests to override log path
export const __setLogPath = (path: string): void => {
  LOG_PATH = path;
};

export const __resetLogPath = (): void => {
  LOG_PATH = 'data/activity-log.json';
};

const ensureDir = (filePath: string): void => {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
};

const emptyLog = (): ActivityLog => ({ version: 1, entries: [] });

const loadLog = (): ActivityLog => {
  if (!existsSync(LOG_PATH)) return emptyLog();
  try {
    const parsed = JSON.parse(readFileSync(LOG_PATH, 'utf-8'));
    if (parsed?.version === 1 && Array.isArray(parsed?.entries)) {
      return parsed as ActivityLog;
    }
    return emptyLog();
  } catch {
    return emptyLog();
  }
};

const archivePrunedEntries = (pruned: ActivityEntry[]): void => {
  if (pruned.length === 0) return;
  try {
    if (!existsSync(ARCHIVE_DIR)) mkdirSync(ARCHIVE_DIR, { recursive: true });
    const month = pruned[0].timestamp.substring(0, 7);
    const archivePath = `${ARCHIVE_DIR}/activity-${month}.json`;
    const existing: ActivityEntry[] = existsSync(archivePath)
      ? JSON.parse(readFileSync(archivePath, 'utf-8'))
      : [];
    existing.push(...pruned);
    writeFileSync(archivePath, JSON.stringify(existing));
  } catch {
    // Archive is best-effort, don't block logging
  }
};

const pruneOldEntries = (entries: ActivityEntry[]): ActivityEntry[] => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_AGE_DAYS);
  const cutoffISO = cutoff.toISOString();
  const kept = entries.filter((e) => e.timestamp >= cutoffISO);
  const pruned = entries.filter((e) => e.timestamp < cutoffISO);
  archivePrunedEntries(pruned);
  return kept;
};

const saveLog = (log: ActivityLog): void => {
  ensureDir(LOG_PATH);
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
};

export const logActivity = (
  source: ActivitySource,
  action: string,
  details: string,
  status: ActivityStatus = 'success',
  target?: string
): void => {
  const log = loadLog();

  const entry: ActivityEntry = {
    timestamp: new Date().toISOString(),
    source,
    action,
    ...(target && { target }),
    details,
    status,
  };

  log.entries.push(entry);
  log.entries = pruneOldEntries(log.entries);
  saveLog(log);
};

export const logBatch = (entries: Omit<ActivityEntry, 'timestamp'>[]): void => {
  const log = loadLog();
  const now = new Date().toISOString();

  for (const entry of entries) {
    log.entries.push({ ...entry, timestamp: now });
  }

  log.entries = pruneOldEntries(log.entries);
  saveLog(log);
};

export const getRecentActivities = (limit = 50): ActivityEntry[] => {
  const log = loadLog();
  return log.entries.slice(-limit);
};

export const getActivitiesBySource = (source: ActivitySource): ActivityEntry[] => {
  const log = loadLog();
  return log.entries.filter((e) => e.source === source);
};

export const getActivityStats = (): {
  total: number;
  byStatus: Record<ActivityStatus, number>;
  bySource: Record<string, number>;
  last24h: number;
  lastEntry: string | null;
} => {
  const log = loadLog();
  const entries = log.entries;

  const byStatus: Record<ActivityStatus, number> = { success: 0, warning: 0, error: 0, info: 0 };
  const bySource: Record<string, number> = {};

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let last24h = 0;

  for (const e of entries) {
    byStatus[e.status]++;
    bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    if (e.timestamp >= oneDayAgo) last24h++;
  }

  return {
    total: entries.length,
    byStatus,
    bySource,
    last24h,
    lastEntry: entries.length > 0 ? entries[entries.length - 1].timestamp : null,
  };
};
