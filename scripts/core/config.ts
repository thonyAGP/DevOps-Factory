export {
  KNOWN_PROJECTS,
  GITHUB_OWNER,
  DASHBOARD_URL,
  SCAN_CONFIG,
  COVERAGE_THRESHOLDS,
  CLAUDE_REVIEW_CONFIG,
  QUALITY_WEIGHTS,
} from '../../factory.config.js';
export type {
  ProjectConfig,
  CoverageThresholds,
  ClaudeReviewConfig,
} from '../../factory.config.js';

// --- Thresholds ---

export const ESCALATION_THRESHOLD = 3;

export const COOLDOWN_HOURS = {
  default: 4,
  escalated: 24,
  critical: 48,
} as const;

export const FILE_SIZE_LIMIT_KB = 50;

// --- AI Quotas ---

export const AI_QUOTAS = {
  testWriterPerDay: 20,
  reviewPerDay: 5,
} as const;

// --- Cron Stagger Offsets ---

export const CRON_SCHEDULE = {
  coverageAudit: '0 5 * * *',
  ciHealthCheck: '0 6 * * *',
  patHealthCheck: '0 7 * * *',
  dailyReport: '30 7 * * *',
  qualityScore: '0 8 * * *',
  branchProtection: '0 9 * * *',
  dependencyIntel: '30 9 * * *',
  uptimeMonitor: '*/10 * * * *',
} as const;

// --- Notification Channels ---

export const NOTIFICATION_CHANNELS = {
  githubIssue: true,
  email: false,
  discord: false,
  ntfy: false,
} as const;

// --- Data Paths ---

export const DATA_PATHS = {
  activityLog: 'data/activity-log.json',
  patterns: 'data/patterns.json',
  cooldowns: 'data/self-heal-cooldowns.json',
  escalation: 'data/escalation-tracker.json',
  alerts: 'data/alert-tracker.json',
  qualityHistory: 'data/quality-history.json',
  coverageHistory: 'data/coverage-history.json',
  veilleHistory: 'data/veille-history.json',
  feedbackLog: 'data/feedback-log.json',
  migrationHistory: 'data/migration-history.json',
} as const;

export const DASHBOARD_PATHS = {
  index: 'dashboard/index.html',
  scanReport: 'dashboard/scan-report.json',
  qualityScores: 'dashboard/quality-scores.json',
  costReport: 'dashboard/cost-report.json',
  complianceReport: 'dashboard/compliance-report.json',
  doraMetrics: 'dashboard/dora-metrics.json',
  recommendations: 'dashboard/recommendations.json',
  recommendationsMd: 'dashboard/recommendations.md',
  securityPosture: 'dashboard/security-posture.json',
  templateDrift: 'dashboard/template-drift.json',
  statuses: 'dashboard/statuses.json',
  history: 'dashboard/history.json',
} as const;

// --- Retention ---

export const RETENTION_DAYS = 30;
export const MAX_LOG_ENTRIES = 5000;
