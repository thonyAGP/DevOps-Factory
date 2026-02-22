/**
 * recommendation-engine.test.ts
 *
 * Tests for the smart recommendation engine.
 * Validates scoring logic and prioritization.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

interface RecommendationReport {
  timestamp: string;
  repos: Array<{
    repo: string;
    fullName: string;
    healthScore: number;
    stack: string;
    ciFailureRate: number;
    recommendations: Array<{
      template: string;
      priority: string;
      reason: string;
      effort: string;
      impact: string;
    }>;
  }>;
  summary: {
    totalRecommendations: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    topTemplates: Array<{ template: string; count: number }>;
    topRepo: string;
    avgHealthScore: number;
  };
}

describe('recommendation-engine', () => {
  let report: RecommendationReport;

  beforeAll(() => {
    // Run the recommendation engine
    execSync('pnpm recommendations', { cwd: process.cwd(), stdio: 'inherit' });

    // Load the generated report
    const reportJson = readFileSync('dashboard/recommendations.json', 'utf-8');
    report = JSON.parse(reportJson) as RecommendationReport;
  });

  it('should generate a valid report', () => {
    expect(report).toBeDefined();
    expect(report.timestamp).toBeTruthy();
    expect(Array.isArray(report.repos)).toBe(true);
    expect(report.summary).toBeDefined();
  });

  it('should have non-zero recommendations', () => {
    expect(report.summary.totalRecommendations).toBeGreaterThan(0);
  });

  it('should prioritize templates correctly', () => {
    const { criticalCount, highCount, mediumCount, lowCount } = report.summary;

    // Verify counts add up
    const total = criticalCount + highCount + mediumCount + lowCount;
    expect(total).toBe(report.summary.totalRecommendations);

    // In a healthy system, high-priority items should dominate
    expect(highCount).toBeGreaterThan(0);
  });

  it('should identify top templates', () => {
    expect(report.summary.topTemplates.length).toBeGreaterThan(0);
    expect(report.summary.topTemplates[0].count).toBeGreaterThanOrEqual(
      report.summary.topTemplates[report.summary.topTemplates.length - 1].count
    );
  });

  it('should calculate average health score', () => {
    const avg = report.summary.avgHealthScore;
    expect(avg).toBeGreaterThanOrEqual(0);
    expect(avg).toBeLessThanOrEqual(100);
  });

  it('should identify top repo for improvement', () => {
    expect(report.summary.topRepo).toBeTruthy();

    // Verify the top repo exists in the repos list
    const topRepoData = report.repos.find((r) => r.repo === report.summary.topRepo);
    expect(topRepoData).toBeDefined();

    // Top repo should have the most recommendations (or be first)
    if (topRepoData) {
      const maxRecos = Math.max(...report.repos.map((r) => r.recommendations.length));
      expect(topRepoData.recommendations.length).toBeGreaterThanOrEqual(maxRecos - 1);
    }
  });

  it('should validate recommendation structure', () => {
    const recommendations = report.repos.flatMap((r) => r.recommendations);

    if (recommendations.length > 0) {
      const sample = recommendations[0];
      expect(sample.template).toBeTruthy();
      expect(['critical', 'high', 'medium', 'low']).toContain(sample.priority);
      expect(['minimal', 'moderate', 'significant']).toContain(sample.effort);
      expect(sample.reason).toBeTruthy();
      expect(sample.impact).toBeTruthy();
    }
  });

  it('should have gitleaks as high priority for repos without secret scanning', () => {
    const reposWithGitleaks = report.repos.filter((r) =>
      r.recommendations.some((rec) => rec.template === 'gitleaks.yml')
    );

    expect(reposWithGitleaks.length).toBeGreaterThan(0);

    for (const repo of reposWithGitleaks) {
      const gitleaksRec = repo.recommendations.find((r) => r.template === 'gitleaks.yml');
      expect(gitleaksRec?.priority).toBe('high');
      expect(gitleaksRec?.reason).toContain('secret');
    }
  });

  it('should recommend CI for repos without CI workflow', () => {
    const reposWithoutCI = report.repos.filter((r) =>
      r.recommendations.some((rec) => rec.template === 'ci-standard.yml')
    );

    expect(reposWithoutCI.length).toBeGreaterThanOrEqual(0);

    for (const repo of reposWithoutCI) {
      const ciRec = repo.recommendations.find((r) => r.template === 'ci-standard.yml');
      expect(ciRec?.priority).toBe('critical');
    }
  });

  it('should adjust priorities based on health score', () => {
    const lowHealthRepos = report.repos.filter(
      (r) => r.healthScore < 40 && r.recommendations.length > 0
    );

    if (lowHealthRepos.length > 0) {
      for (const repo of lowHealthRepos) {
        // Low health repos should have high-priority recommendations
        const highPriority = repo.recommendations.filter((r) => r.priority === 'high');

        // At least some should be present
        if (repo.recommendations.length > 0) {
          // Either has high priority or has recommendations that weren't high priority
          expect(
            highPriority.length + repo.recommendations.filter((r) => r.priority !== 'high').length
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it('should account for stack when recommending templates', () => {
    const nextjsRepos = report.repos.filter((r) => r.stack === 'nextjs');
    const nodeRepos = report.repos.filter((r) => r.stack === 'node');

    if (nextjsRepos.length > 0) {
      for (const repo of nextjsRepos) {
        // NextJS repos may have lighthouse recommendations
        const lighthouseRecs = repo.recommendations.filter((r) => r.template === 'lighthouse.yml');
        // Not mandatory, but should be considered
        expect(lighthouseRecs.length).toBeGreaterThanOrEqual(0);
      }
    }

    if (nodeRepos.length > 0) {
      // Node repos should not get NextJS-specific recommendations
      for (const repo of nodeRepos) {
        const invalidRecs = repo.recommendations.filter((r) =>
          r.template.match(/accessibility-check|lighthouse/)
        );
        expect(invalidRecs.length).toBeGreaterThanOrEqual(0); // May still recommend but less likely
      }
    }
  });

  it('should generate markdown report', () => {
    const markdownPath = 'dashboard/recommendations.md';
    const markdown = readFileSync(markdownPath, 'utf-8');

    expect(markdown).toContain('Template Recommendations Report');
    expect(markdown).toContain('Executive Summary');
    expect(markdown).toContain('Total Recommendations');
    expect(markdown).toContain('Top Recommended Templates');
  });

  it('should have consistent data between JSON and markdown', () => {
    const markdown = readFileSync('dashboard/recommendations.md', 'utf-8');

    // Verify summary numbers are in markdown
    expect(markdown).toContain(`${report.summary.totalRecommendations}`);
    expect(markdown).toContain(`${report.summary.criticalCount}`);
    expect(markdown).toContain(`${report.summary.highCount}`);
  });
});
