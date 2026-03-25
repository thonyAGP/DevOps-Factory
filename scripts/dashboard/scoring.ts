import type { ProjectStatus } from './types.js';

export const calculateSecurityScore = (status: ProjectStatus): number => {
  let score = 0;
  const total = 5;
  if (status.hasGitleaks) score++;
  if (status.hasLicenseCheck) score++;
  if (status.hasSemgrep) score++;
  if (status.hasSupplyChain) score++;
  if (status.hasCodeRabbit) score++;
  return Math.round((score / total) * 100);
};

export const calculatePerfScore = (status: ProjectStatus): number => {
  let score = 0;
  const total = 5;
  if (status.hasLighthouse || status.hasPerformanceBudget) score++;
  if (status.hasAccessibilityCheck) score++;
  if (status.hasCoverageTracking) score++;
  if (status.hasTypedoc) score++;
  return Math.round((score / total) * 100);
};

export const calculateHealthScore = (status: ProjectStatus): number => {
  let score = 100;
  if (status.ciStatus === 'fail') score -= 30;
  if (status.ciStatus === 'none') score -= 10;
  if (!status.configured) score -= 15;
  if (status.aiFixPRs.length > 0) score -= 10;
  if (status.openPRs.length > 5) score -= 10;
  if (!status.hasGitleaks) score -= 5;
  if (!status.hasRenovate) score -= 5;
  if (!status.hasHusky) score -= 5;
  if (!status.hasCodeRabbit && !status.configured) score -= 5;
  if (!status.hasLicenseCheck) score -= 3;
  if (!status.hasSemgrep) score -= 3;
  if (!status.hasCoverageTracking) score -= 3;
  return Math.max(0, score);
};
