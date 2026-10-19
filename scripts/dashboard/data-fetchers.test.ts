import { expect, it, vi } from 'vitest';
import { getReferenceWorkflowRun } from '../workflow-monitoring.js';
import { getLatestWorkflowRun, buildProjectStatuses } from './data-fetchers.js';
import type { ScanResult } from './types.js';

vi.mock('../workflow-monitoring.js', () => ({ getReferenceWorkflowRun: vi.fn(() => null) }));
vi.mock('../shell-utils.js', () => ({ sh: vi.fn(() => '[]'), jq: (value: string) => value }));

it('looks up the discovered workflow for repositories without an explicit CI override', () => {
  getLatestWorkflowRun('owner/custom-build-project', 'main', 'compile-and-test.yml');
  expect(getReferenceWorkflowRun).toHaveBeenCalledWith('owner/custom-build-project', 'compile-and-test.yml', 'main');
});

it('keeps unsupported repositories visible without claiming they have CI', () => {
  const analysis: ScanResult = {
    name: 'Documents', fullName: 'owner/documents', stack: 'unknown', defaultBranch: 'main',
    hasCI: false, hasClaudeReview: false, hasSelfHealing: false, hasQodoMerge: false,
    hasGitleaks: false, hasRenovate: false, hasHusky: false, hasCodeRabbit: false,
    hasLicenseCheck: false, hasSemgrep: false, hasSupplyChainSecurity: false,
    hasContainerScan: false, hasSecurityHeaders: false, hasPerformanceBudget: false,
    hasAccessibilityCheck: false, hasLighthouse: false, hasTypedoc: false, hasCoverageTracking: false,
  };
  expect(buildProjectStatuses({ timestamp: '2026-10-19T00:00:00Z', analyses: [analysis] }))
    .toEqual([expect.objectContaining({ name: 'Documents', ciStatus: 'none', lastRun: null })]);
});
