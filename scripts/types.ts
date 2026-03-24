/**
 * types.ts
 *
 * Shared TypeScript interfaces used across multiple DevOps-Factory scripts.
 */

export interface WorkflowRun {
  id: number;
  name: string;
  conclusion: string | null;
  status: string;
  html_url: string;
  created_at: string;
  head_branch: string;
}

export interface Pattern {
  id: string;
  category: string;
  signature: string;
  fix: string;
  fixType: string;
  repos_seen: string[];
  occurrences: number;
  confidence: number;
}

export interface PatternDB {
  version: number;
  lastUpdated: string;
  patterns: Pattern[];
}

export interface QuotaData {
  date: string;
  count: number;
  maxPerDay: number;
}

export interface TreeNode {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
}
