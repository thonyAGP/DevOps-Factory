export type FeedbackSource =
  | 'self-heal'
  | 'test-scaffold'
  | 'ai-test-writer'
  | 'prettier-fix'
  | 'configuration'
  | 'remediation'
  | 'unknown';

export interface FeedbackPR {
  number: number;
  title: string;
  state: string;
  labels: Array<{ name: string }>;
  mergedAt: string | null;
  closedAt?: string | null;
  createdAt?: string;
  headRefName: string;
}

/** Require a concrete automation marker, never an empty title/regex alternative. */
export const detectSource = (
  labels: string[],
  title: string,
  branch = ''
): FeedbackSource => {
  if (labels.includes('ai-remediation') || branch.startsWith('ai-remediation/') ||
      title.includes('(central-scan)')) return 'remediation';
  if (labels.includes('ai-fix') || branch.startsWith('ai-fix/') ||
      /^fix(?:\([^)]*\))?:\s*CI fix\b/i.test(title)) return 'self-heal';
  if (branch.startsWith('test-scaffold/') || /test scaffold/i.test(title)) return 'test-scaffold';
  if (branch.startsWith('ai-tests/') || /\bAI[ -]tests\b/i.test(title)) return 'ai-test-writer';
  if (branch.startsWith('auto-fix/prettier') || branch.startsWith('fix/prettier-') ||
      /^style:\s*auto-format with prettier/i.test(title)) return 'prettier-fix';
  if (/^chore:\s*add DevOps-Factory\b/i.test(title)) return 'configuration';
  return 'unknown';
};

export const determinePROutcome = (pr: Pick<FeedbackPR, 'mergedAt' | 'state'>):
  'merged' | 'closed' | 'open' => {
  if (pr.mergedAt) return 'merged';
  return pr.state.toLowerCase() === 'closed' ? 'closed' : 'open';
};

export interface Feedback {
  date: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  outcome: 'merged' | 'closed' | 'modified' | 'open';
  patternId: string | null;
  source: FeedbackSource;
  /** True only after checking PR metadata with the corrected classifier. */
  sourceVerified?: boolean;
}

export const verifiedFeedbacks = (entries: Feedback[]): Feedback[] =>
  entries.filter((entry) => entry.sourceVerified === true && entry.source !== 'unknown');

/** Keep historical evidence, but do not credit unverified legacy attribution. */
export const invalidateLegacySources = (entries: Feedback[]): void => {
  for (const entry of entries) {
    if (entry.sourceVerified !== true) entry.source = 'unknown';
  }
};

/** Update the same log instance that the collector will persist. */
export const refreshFeedback = (entry: Feedback, pr: FeedbackPR, now: string): boolean => {
  const outcome = determinePROutcome(pr);
  const changed = entry.outcome !== outcome;
  const wasVerified = entry.sourceVerified === true;
  entry.source = detectSource(pr.labels.map((label) => label.name), pr.title, pr.headRefName);
  entry.sourceVerified = true;
  entry.prTitle = pr.title;
  entry.outcome = outcome;
  if (changed || !wasVerified) entry.date = pr.mergedAt ?? pr.closedAt ?? pr.createdAt ?? now;
  return changed;
};
