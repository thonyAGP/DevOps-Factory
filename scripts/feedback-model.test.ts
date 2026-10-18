import { describe, expect, it } from 'vitest';
import {
  detectSource, determinePROutcome, invalidateLegacySources, refreshFeedback,
  verifiedFeedbacks, type Feedback, type FeedbackPR,
} from './feedback-model.js';

const sample = (): Feedback => ({
  date: '2026-10-01T00:00:00Z', repo: 'owner/project', prNumber: 12,
  prTitle: 'feat: normal feature', outcome: 'open', patternId: null, source: 'self-heal',
});
const pr = (changes: Partial<FeedbackPR> = {}): FeedbackPR => ({
  number: 12, title: 'fix: repair', state: 'OPEN', labels: [{ name: 'ai-fix' }],
  mergedAt: null, headRefName: 'ai-fix/example', ...changes,
});

describe('automation attribution', () => {
  it.each(['feat: normal feature', 'docs: deployment notes', 'chore(deps): update next', '',
    'fix: prettier settings in editor', 'docs: compare DevOps-Factory alternatives'])(
    'does not credit an unrelated PR: %s', (title) => {
      expect(detectSource([], title)).toBe('unknown');
    });
  it.each([
    [['ai-fix'], 'fix: repair', '', 'self-heal'],
    [[], 'fix: repair', 'ai-fix/run-12', 'self-heal'],
    [[], 'fix: CI fix [pattern:compile]', '', 'self-heal'],
    [[], 'fix: security (central-scan)', 'ai-remediation/security', 'remediation'],
    [[], 'chore: add DevOps-Factory AI workflows', '', 'configuration'],
    [[], 'test: test scaffold for service', '', 'test-scaffold'],
    [[], 'test: AI tests for module', '', 'ai-test-writer'],
    [[], 'style: auto-format with prettier', '', 'prettier-fix'],
  ] as const)('recognizes concrete markers %#', (labels, title, branch, source) => {
    expect(detectSource([...labels], title, branch)).toBe(source);
  });
  it('excludes legacy false attribution without deleting historical evidence', () => {
    const legacy = sample();
    const known = { ...sample(), sourceVerified: true };
    invalidateLegacySources([legacy, known]);
    expect(legacy.source).toBe('unknown');
    expect(legacy.prNumber).toBe(12);
    expect(verifiedFeedbacks([legacy, known])).toEqual([known]);
  });
});

describe('outcome refresh', () => {
  it('understands uppercase CLOSED returned by gh', () => {
    expect(determinePROutcome(pr({ state: 'CLOSED' }))).toBe('closed');
  });
  it('uses mergedAt as evidence of merge', () => {
    expect(determinePROutcome(pr({ state: 'MERGED', mergedAt: '2026-10-18T00:00:00Z' }))).toBe('merged');
  });
  it('persists a changed outcome in the same log instance', () => {
    const log = { feedbacks: [sample()] };
    const now = '2026-10-18T00:00:00Z';
    expect(refreshFeedback(log.feedbacks[0], pr({ state: 'MERGED', mergedAt: now }), now)).toBe(true);
    const saved = JSON.parse(JSON.stringify(log));
    expect(saved.feedbacks[0]).toMatchObject({ outcome: 'merged', sourceVerified: true, date: now });
  });
  it('does not turn an old outcome into a new success each week', () => {
    const entry = { ...sample(), outcome: 'merged' as const };
    expect(refreshFeedback(entry, pr({ mergedAt: '2026-10-01T00:00:00Z' }), '2026-10-18T00:00:00Z')).toBe(false);
    expect(entry.date).toBe('2026-10-01T00:00:00Z');
  });
  it('removes attribution when refreshed metadata has no automation marker', () => {
    const entry = sample();
    refreshFeedback(entry, pr({ title: 'feat: normal feature', labels: [], headRefName: 'feature/ui' }), entry.date);
    expect(verifiedFeedbacks([entry])).toEqual([]);
  });
});
