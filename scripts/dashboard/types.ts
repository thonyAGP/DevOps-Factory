import type { WorkflowRun } from '../types.js';

export interface MigrationModule {
  name: string;
  hasCommands: boolean;
  hasQueries: boolean;
  hasValidators: boolean;
  handlerCount: number;
}

export interface MigrationSnapshot {
  date: string;
  backend: {
    modules: MigrationModule[];
    moduleCount: number;
    totalHandlers: number;
    domainEntities: number;
    apiEndpointFiles: number;
    testFiles: number;
    testCount: number;
    csFiles: number;
  };
  frontend: {
    reactComponents: number;
    tsFiles: number;
    htmlPages: number;
    hasStorybook: boolean;
  };
  specs: {
    totalSpecs: number;
    annotatedPrograms: number;
    migrationPatterns: number;
    migrationDocs: number;
  };
  tools: {
    csprojCount: number;
    kbIndexed: boolean;
    mcpServer: boolean;
  };
  overall: {
    progressPercent: number;
    totalFiles: number;
  };
}

export interface ScanResult {
  name: string;
  fullName: string;
  stack: string;
  hasCI: boolean;
  hasClaudeReview: boolean;
  hasSelfHealing: boolean;
  hasQodoMerge: boolean;
  hasGitleaks: boolean;
  hasRenovate: boolean;
  hasHusky: boolean;
  hasCodeRabbit: boolean;
  hasLicenseCheck: boolean;
  hasSemgrep: boolean;
  hasSupplyChainSecurity: boolean;
  hasContainerScan: boolean;
  hasSecurityHeaders: boolean;
  hasPerformanceBudget: boolean;
  hasAccessibilityCheck: boolean;
  hasLighthouse: boolean;
  hasTypedoc: boolean;
  hasCoverageTracking: boolean;
  defaultBranch: string;
}

export interface ScanReport {
  timestamp: string;
  analyses: ScanResult[];
}

export interface PRInfo {
  number: number;
  title: string;
  state: string;
  html_url: string;
  user: { login: string };
  labels: { name: string }[];
  created_at: string;
}

export interface ProjectStatus {
  name: string;
  fullName: string;
  stack: string;
  ciStatus: 'pass' | 'fail' | 'none';
  lastRun: WorkflowRun | null;
  openPRs: PRInfo[];
  aiFixPRs: PRInfo[];
  renovatePRs: PRInfo[];
  healthScore: number;
  configured: boolean;
  hasGitleaks: boolean;
  hasRenovate: boolean;
  hasHusky: boolean;
  hasCodeRabbit: boolean;
  hasLicenseCheck: boolean;
  hasSemgrep: boolean;
  hasSupplyChain: boolean;
  securityScore: number;
  hasPerformanceBudget: boolean;
  hasAccessibilityCheck: boolean;
  hasLighthouse: boolean;
  hasTypedoc: boolean;
  hasCoverageTracking: boolean;
  perfScore: number;
}

export interface HistoryProjectEntry {
  name: string;
  health: number;
  ciStatus: 'pass' | 'fail' | 'none';
}

export interface HistoryEntry {
  date: string;
  avgHealth: number;
  failingCI: number;
  passingCI: number;
  totalOpenPRs: number;
  perProject: HistoryProjectEntry[];
}

export interface AlertEvent {
  type: 'ci_fail' | 'ai_fix_pending' | 'health_drop';
  project: string;
  repo: string;
  runId: string;
  message: string;
}
