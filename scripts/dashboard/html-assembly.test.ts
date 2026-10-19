import { expect, it, vi } from 'vitest';
import type { ProjectStatus } from './types.js';
import { generateHTML } from './html-assembly.js';

vi.mock('./sections/index.js', () => ({
  getFactoryStatusSection: () => '', getSecurityPostureSection: () => '',
  getCentralScanSection: () => '', getSecurityRegistrySection: () => '',
  getCoverageSection: () => '', getPerformanceSection: () => '',
  getDoraSection: () => '', getCostSection: () => '', getComplianceSection: () => '',
  getRecommendationsSection: () => '', getMigrationSection: () => '',
  renderAlertCards: () => '', renderOkCards: (projects: ProjectStatus[]) => projects.map(p => p.name).join(', '),
}));

const project = (ciStatus: ProjectStatus['ciStatus']): ProjectStatus => ({
  name: 'Synthetic repository', fullName: 'owner/synthetic', stack: 'node', ciStatus,
  lastRun: null, openPRs: [], aiFixPRs: [], renovatePRs: [], healthScore: 0,
  configured: false, hasGitleaks: false, hasRenovate: false, hasHusky: false,
  hasCodeRabbit: false, hasLicenseCheck: false, hasSemgrep: false, hasSupplyChain: false,
  securityScore: 0, hasPerformanceBudget: false, hasAccessibilityCheck: false,
  hasLighthouse: false, hasTypedoc: false, hasCoverageTracking: false, perfScore: 0,
});

it('never renders an empty inventory as a healthy dashboard', () => {
  expect(() => generateHTML([])).toThrow('No monitored results');
});
it('does not put a repository without CI in the passing group', () => {
  const html = generateHTML([project('none')], 2);
  expect(html).toContain('CI passing (0)');
  expect(html).toContain('Without a displayed CI result (2)');
  expect(html).not.toContain('class="all-clear"');
  expect(html).not.toContain('projects are healthy');
});
it('separates a successful CI result from production health', () => {
  const html = generateHTML([project('pass')], 2);
  expect(html).toContain('CI passing (1)');
  expect(html).toContain('1 without a displayed CI result');
  expect(html).toContain('Production health is not established');
});
