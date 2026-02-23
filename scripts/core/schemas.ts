import { z } from 'zod/v4';

// --- Activity Log ---

const ActivityStatusSchema = z.enum(['success', 'warning', 'error', 'info']);

const ActivityEntrySchema = z.object({
  timestamp: z.iso.datetime(),
  source: z.string(),
  action: z.string(),
  target: z.string().optional(),
  details: z.string(),
  status: ActivityStatusSchema,
});

export const ActivityLogSchema = z.object({
  version: z.literal(1),
  entries: z.array(ActivityEntrySchema),
});

export type ActivityLog = z.infer<typeof ActivityLogSchema>;
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;

// --- Patterns DB ---

const PatternSchema = z.object({
  id: z.string(),
  category: z.string(),
  signature: z.string(),
  fix: z.string(),
  fixType: z.string(),
  repos_seen: z.array(z.string()),
  occurrences: z.number().int().min(0),
  confidence: z.number().min(0).max(1),
});

export const PatternsDBSchema = z.object({
  version: z.number().int(),
  lastUpdated: z.string(),
  patterns: z.array(PatternSchema),
});

export type PatternsDB = z.infer<typeof PatternsDBSchema>;

// --- Scan Report ---

const ScanAnalysisSchema = z
  .object({
    name: z.string(),
    fullName: z.string(),
    stack: z.string(),
    packageManager: z.string(),
    hasCI: z.boolean(),
    hasClaudeReview: z.boolean(),
    hasSelfHealing: z.boolean(),
    hasQodoMerge: z.boolean(),
    hasGitleaks: z.boolean(),
    hasRenovate: z.boolean(),
    hasHusky: z.boolean(),
    hasSemgrep: z.boolean(),
    hasLicenseCheck: z.boolean(),
    hasNodeVersionSync: z.boolean(),
    hasEnvSyncCheck: z.boolean(),
    hasOpenSpecDrift: z.boolean(),
    hasOpenSpec: z.boolean(),
    hasPrisma: z.boolean(),
    hasBranchCleanup: z.boolean(),
    hasStaleBot: z.boolean(),
    hasPrDescriptionAI: z.boolean(),
    hasAccessibilityCheck: z.boolean(),
    hasDeadCodeDetection: z.boolean(),
    hasSbomGeneration: z.boolean(),
    hasCronMonitor: z.boolean(),
    hasAutoLabel: z.boolean(),
    hasCodeRabbit: z.boolean(),
    hasMutationTesting: z.boolean(),
    hasPerformanceBudget: z.boolean(),
    hasTestImpactAnalysis: z.boolean(),
    hasDevContainer: z.boolean(),
    hasTypeCoverage: z.boolean(),
    hasDependencySizeCheck: z.boolean(),
    hasSupplyChainSecurity: z.boolean(),
    hasContainerScan: z.boolean(),
    hasSecurityHeaders: z.boolean(),
  })
  .passthrough();

export const ScanReportSchema = z.object({
  timestamp: z.string(),
  analyses: z.array(ScanAnalysisSchema),
});

export type ScanReport = z.infer<typeof ScanReportSchema>;

// --- Quality Scores ---

const QualityBreakdownSchema = z.object({
  ciPasses: z.number(),
  coverageAboveThreshold: z.number(),
  prettierClean: z.number(),
  eslintZeroWarnings: z.number(),
  branchProtection: z.number(),
  depsUpToDate: z.number(),
  noSecrets: z.number(),
});

const QualityScoreEntrySchema = z.object({
  name: z.string(),
  repo: z.string(),
  score: z.number().min(0).max(100),
  breakdown: QualityBreakdownSchema,
});

export const QualityScoresSchema = z.object({
  timestamp: z.string(),
  scores: z.array(QualityScoreEntrySchema),
});

export type QualityScores = z.infer<typeof QualityScoresSchema>;

// --- Cost Report ---

const WorkflowCostSchema = z.object({
  name: z.string(),
  runs: z.number().int(),
  totalMinutes: z.number(),
  avgMinutes: z.number(),
  failedRuns: z.number().int(),
  wastedMinutes: z.number(),
});

const RepoCostSchema = z.object({
  repo: z.string(),
  fullName: z.string(),
  totalMinutes: z.number(),
  totalRuns: z.number().int(),
  workflows: z.array(WorkflowCostSchema),
});

export const CostReportSchema = z.object({
  timestamp: z.string(),
  repos: z.array(RepoCostSchema),
});

export type CostReport = z.infer<typeof CostReportSchema>;

// --- Compliance Report ---

const DeploymentSchema = z.object({
  branch: z.string(),
  repo: z.string(),
  sha: z.string(),
  status: z.string(),
  timestamp: z.string(),
  workflow: z.string(),
});

const MergedPRSchema = z
  .object({
    number: z.number().int(),
    title: z.string(),
    author: z.string(),
    mergedAt: z.string(),
    labels: z.array(z.unknown()),
    reviewers: z.array(z.unknown()),
  })
  .passthrough();

const ComplianceRepoSchema = z
  .object({
    repo: z.string(),
    fullName: z.string(),
    mergedPRs: z.array(MergedPRSchema),
    deployments: z.array(DeploymentSchema),
  })
  .passthrough();

export const ComplianceReportSchema = z.object({
  timestamp: z.string(),
  period: z.string(),
  repos: z.array(ComplianceRepoSchema),
});

export type ComplianceReport = z.infer<typeof ComplianceReportSchema>;

// --- DORA Metrics ---

const DoraRepoSchema = z.object({
  repo: z.string(),
  fullName: z.string(),
  deploymentFrequency: z.number(),
  leadTimeHours: z.number(),
  mttrHours: z.number(),
  changeFailureRate: z.number(),
  rating: z.enum(['elite', 'high', 'medium', 'low']),
  prsMerged30d: z.number().int(),
  releases30d: z.number().int(),
});

export const DoraMetricsSchema = z.object({
  timestamp: z.string(),
  repos: z.array(DoraRepoSchema),
});

export type DoraMetrics = z.infer<typeof DoraMetricsSchema>;

// --- Recommendations ---

const RecommendationItemSchema = z.object({
  template: z.string(),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  reason: z.string(),
  effort: z.enum(['minimal', 'moderate', 'significant']),
  impact: z.string(),
});

const RepoRecommendationSchema = z.object({
  repo: z.string(),
  fullName: z.string(),
  healthScore: z.number(),
  stack: z.string(),
  ciFailureRate: z.number(),
  recommendations: z.array(RecommendationItemSchema),
});

export const RecommendationsSchema = z.object({
  timestamp: z.string(),
  repos: z.array(RepoRecommendationSchema),
});

export type Recommendations = z.infer<typeof RecommendationsSchema>;

// --- Security Posture ---

const SecurityWorkflowSchema = z.object({
  name: z.string(),
  lastRun: z.string().nullable(),
  conclusion: z.string().nullable(),
  url: z.string().nullable(),
});

const SecurityRepoSchema = z
  .object({
    repo: z.string(),
    fullName: z.string(),
    workflows: z.record(z.string(), SecurityWorkflowSchema),
  })
  .passthrough();

export const SecurityPostureSchema = z.object({
  timestamp: z.string(),
  repos: z.array(SecurityRepoSchema),
});

export type SecurityPosture = z.infer<typeof SecurityPostureSchema>;

// --- Template Drift ---

const TemplateDriftEntrySchema = z.object({
  template: z.string(),
  repoPath: z.string(),
  status: z.enum(['missing', 'up-to-date', 'outdated', 'modified']),
  similarity: z.number().min(0).max(100),
});

const TemplateDriftRepoSchema = z.object({
  repo: z.string(),
  fullName: z.string(),
  templates: z.array(TemplateDriftEntrySchema),
});

export const TemplateDriftSchema = z.object({
  timestamp: z.string(),
  repos: z.array(TemplateDriftRepoSchema),
});

export type TemplateDrift = z.infer<typeof TemplateDriftSchema>;

// --- Statuses ---

const LastRunSchema = z.object({
  conclusion: z.string().nullable(),
  created_at: z.string().nullable(),
  head_branch: z.string().nullable(),
  html_url: z.string().nullable(),
  id: z.number().nullable(),
  name: z.string().nullable(),
});

const OpenPRSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  state: z.string(),
  html_url: z.string(),
  created_at: z.string(),
  user: z.object({ login: z.string() }),
  labels: z.array(z.unknown()),
});

const ProjectStatusSchema = z
  .object({
    name: z.string(),
    fullName: z.string(),
    stack: z.string(),
    ciStatus: z.string(),
    lastRun: LastRunSchema,
    openPRs: z.array(OpenPRSchema),
    aiFixPRs: z.array(z.unknown()),
    renovatePRs: z.array(z.unknown()),
    healthScore: z.number(),
    configured: z.boolean(),
    hasGitleaks: z.boolean(),
    hasRenovate: z.boolean(),
    hasHusky: z.boolean(),
    hasCodeRabbit: z.boolean(),
    hasLicenseCheck: z.boolean(),
    hasSemgrep: z.boolean(),
  })
  .passthrough();

export const StatusesSchema = z.object({
  timestamp: z.string(),
  projects: z.array(ProjectStatusSchema),
});

export type Statuses = z.infer<typeof StatusesSchema>;

// --- History ---

const HistoryProjectSchema = z.object({
  name: z.string(),
  health: z.number(),
  ciStatus: z.string(),
});

const HistoryEntrySchema = z.object({
  date: z.string(),
  avgHealth: z.number(),
  failingCI: z.number().int(),
  passingCI: z.number().int(),
  totalOpenPRs: z.number().int(),
  perProject: z.array(HistoryProjectSchema),
});

export const HistorySchema = z.array(HistoryEntrySchema);

export type History = z.infer<typeof HistorySchema>;

// --- Self-Heal Cooldowns ---

export const CooldownSchema = z.record(z.string(), z.number());

export type Cooldowns = z.infer<typeof CooldownSchema>;

// --- Escalation Tracker ---

const EscalationEntrySchema = z.object({
  consecutiveFailures: z.number().int(),
  lastFailure: z.string(),
  escalated: z.boolean(),
});

export const EscalationSchema = z.record(z.string(), EscalationEntrySchema);

export type EscalationTracker = z.infer<typeof EscalationSchema>;

// --- Alert Tracker ---

const AlertEntrySchema = z
  .object({
    repo: z.string(),
    type: z.string(),
    message: z.string(),
    timestamp: z.string(),
    resolved: z.boolean(),
  })
  .passthrough();

export const AlertTrackerSchema = z.array(AlertEntrySchema);

export type AlertTracker = z.infer<typeof AlertTrackerSchema>;
