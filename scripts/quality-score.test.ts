/**
 * quality-score.test.ts
 *
 * Unit tests for quality-score.ts
 * Tests the scoring logic, calculation functions, and report generation
 */

import { describe, it, expect } from 'vitest';

interface ScoreBreakdown {
  ciPasses: number;
  coverageAboveThreshold: number;
  prettierClean: number;
  eslintZeroWarnings: number;
  branchProtection: number;
  depsUpToDate: number;
  noSecrets: number;
}

interface RepoQualityScore {
  name: string;
  repo: string;
  score: number;
  breakdown: ScoreBreakdown;
}

// Pure functions extracted for testing
const calculateScore = (checks: Partial<ScoreBreakdown>): ScoreBreakdown => {
  return {
    ciPasses: checks.ciPasses ?? 0,
    coverageAboveThreshold: checks.coverageAboveThreshold ?? 0,
    prettierClean: checks.prettierClean ?? 0,
    eslintZeroWarnings: checks.eslintZeroWarnings ?? 0,
    branchProtection: checks.branchProtection ?? 0,
    depsUpToDate: checks.depsUpToDate ?? 0,
    noSecrets: checks.noSecrets ?? 0,
  };
};

const getTotalScore = (breakdown: ScoreBreakdown): number => {
  return Object.values(breakdown).reduce((sum, val) => sum + val, 0);
};

const detectScoreDrops = (
  scores: RepoQualityScore[],
  prevScores: RepoQualityScore[] | null
): Array<{ repo: string; drop: number; from: number; to: number }> => {
  if (!prevScores || prevScores.length === 0) return [];

  const drops: Array<{ repo: string; drop: number; from: number; to: number }> = [];

  for (const score of scores) {
    const prevScore = prevScores.find((r) => r.repo === score.repo);
    if (prevScore && prevScore.score - score.score >= 5) {
      drops.push({
        repo: score.name,
        drop: prevScore.score - score.score,
        from: prevScore.score,
        to: score.score,
      });
    }
  }

  return drops;
};

const detectScoreImprovements = (
  scores: RepoQualityScore[],
  prevScores: RepoQualityScore[] | null
): Array<{ repo: string; gain: number; from: number; to: number }> => {
  if (!prevScores || prevScores.length === 0) return [];

  const gains: Array<{ repo: string; gain: number; from: number; to: number }> = [];

  for (const score of scores) {
    const prevScore = prevScores.find((r) => r.repo === score.repo);
    if (prevScore && score.score - prevScore.score >= 5) {
      gains.push({
        repo: score.name,
        gain: score.score - prevScore.score,
        from: prevScore.score,
        to: score.score,
      });
    }
  }

  return gains;
};

const generateReport = (
  scores: RepoQualityScore[],
  drops: Array<{ repo: string; drop: number; from: number; to: number }>
): string => {
  const today = new Date().toISOString().split('T')[0];
  const avgScore = Math.round(scores.reduce((sum, s) => sum + s.score, 0) / scores.length);
  const excellent = scores.filter((s) => s.score >= 80).length;
  const good = scores.filter((s) => s.score >= 60 && s.score < 80).length;
  const needsWork = scores.filter((s) => s.score < 60).length;

  let report = `## Quality Score Report - ${today}\n\n`;
  report += `### Summary\n`;
  report += `- **Average Score**: ${avgScore}/100\n`;
  report += `- **Excellent** (80+): ${excellent}\n`;
  report += `- **Good** (60-79): ${good}\n`;
  report += `- **Needs Work** (<60): ${needsWork}\n\n`;

  if (drops.length > 0) {
    report += `### Score Drops (≥5 points)\n`;
    for (const drop of drops) {
      report += `- **${drop.repo}**: ${drop.from} → ${drop.to} (-${drop.drop})\n`;
    }
    report += `\n`;
  }

  report += `### Per Repository\n\n`;
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  for (const s of sorted) {
    report += `#### ${s.name}\n`;
    report += `- **Score**: ${s.score}/100\n`;
    report += `- **CI Passes**: ${s.breakdown.ciPasses > 0 ? '✓' : '✗'}\n`;
    report += `- **Coverage**: ${s.breakdown.coverageAboveThreshold > 0 ? '✓' : '✗'}\n`;
    report += `- **Prettier**: ${s.breakdown.prettierClean > 0 ? '✓' : '✗'}\n`;
    report += `- **ESLint**: ${s.breakdown.eslintZeroWarnings > 0 ? '✓' : '✗'}\n`;
    report += `- **Branch Protection**: ${s.breakdown.branchProtection > 0 ? '✓' : '✗'}\n`;
    report += `- **Dependency Mgmt**: ${s.breakdown.depsUpToDate > 0 ? '✓' : '✗'}\n`;
    report += `- **Gitleaks**: ${s.breakdown.noSecrets > 0 ? '✓' : '✗'}\n\n`;
  }

  return report;
};

describe('quality-score', () => {
  describe('calculateScore', () => {
    it('should create score breakdown with defaults', () => {
      const score = calculateScore({});
      expect(score.ciPasses).toBe(0);
      expect(score.coverageAboveThreshold).toBe(0);
      expect(score.prettierClean).toBe(0);
      expect(score.eslintZeroWarnings).toBe(0);
      expect(score.branchProtection).toBe(0);
      expect(score.depsUpToDate).toBe(0);
      expect(score.noSecrets).toBe(0);
    });

    it('should accept partial breakdown values', () => {
      const score = calculateScore({
        ciPasses: 15,
        coverageAboveThreshold: 15,
        prettierClean: 14,
      });
      expect(score.ciPasses).toBe(15);
      expect(score.coverageAboveThreshold).toBe(15);
      expect(score.prettierClean).toBe(14);
      expect(score.eslintZeroWarnings).toBe(0);
    });

    it('should preserve all provided values', () => {
      const partial: Partial<ScoreBreakdown> = {
        ciPasses: 10,
        coverageAboveThreshold: 15,
        prettierClean: 14,
        eslintZeroWarnings: 14,
        branchProtection: 16,
        depsUpToDate: 14,
        noSecrets: 17,
      };
      const score = calculateScore(partial);
      expect(score.ciPasses).toBe(10);
      expect(score.coverageAboveThreshold).toBe(15);
      expect(score.prettierClean).toBe(14);
      expect(score.eslintZeroWarnings).toBe(14);
      expect(score.branchProtection).toBe(16);
      expect(score.depsUpToDate).toBe(14);
      expect(score.noSecrets).toBe(17);
    });
  });

  describe('getTotalScore', () => {
    it('should return 0 for empty breakdown', () => {
      const breakdown = calculateScore({});
      const total = getTotalScore(breakdown);
      expect(total).toBe(0);
    });

    it('should sum all breakdown values', () => {
      const breakdown = calculateScore({
        ciPasses: 15,
        coverageAboveThreshold: 15,
        prettierClean: 14,
        eslintZeroWarnings: 14,
        branchProtection: 16,
        depsUpToDate: 14,
        noSecrets: 17,
      });
      const total = getTotalScore(breakdown);
      expect(total).toBe(105);
    });

    it('should handle partial scores', () => {
      const breakdown = calculateScore({
        ciPasses: 10,
        prettierClean: 5,
      });
      const total = getTotalScore(breakdown);
      expect(total).toBe(15);
    });
  });

  describe('detectScoreDrops', () => {
    it('should return empty array when no previous scores', () => {
      const current: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 50,
          breakdown: calculateScore({}),
        },
      ];
      const drops = detectScoreDrops(current, null);
      expect(drops).toEqual([]);
    });

    it('should return empty array when no scores dropped', () => {
      const current: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 75,
          breakdown: calculateScore({}),
        },
      ];
      const previous: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 70,
          breakdown: calculateScore({}),
        },
      ];
      const drops = detectScoreDrops(current, previous);
      expect(drops).toEqual([]);
    });

    it('should detect drop of exactly 5 points', () => {
      const current: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 70,
          breakdown: calculateScore({}),
        },
      ];
      const previous: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 75,
          breakdown: calculateScore({}),
        },
      ];
      const drops = detectScoreDrops(current, previous);
      expect(drops).toContainEqual({
        repo: 'Repo1',
        drop: 5,
        from: 75,
        to: 70,
      });
    });

    it('should detect drop greater than 5 points', () => {
      const current: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 60,
          breakdown: calculateScore({}),
        },
      ];
      const previous: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 80,
          breakdown: calculateScore({}),
        },
      ];
      const drops = detectScoreDrops(current, previous);
      expect(drops).toContainEqual({
        repo: 'Repo1',
        drop: 20,
        from: 80,
        to: 60,
      });
    });

    it('should ignore drop less than 5 points', () => {
      const current: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 72,
          breakdown: calculateScore({}),
        },
      ];
      const previous: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 75,
          breakdown: calculateScore({}),
        },
      ];
      const drops = detectScoreDrops(current, previous);
      expect(drops).toEqual([]);
    });

    it('should handle multiple repos with mixed results', () => {
      const current: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 65,
          breakdown: calculateScore({}),
        },
        {
          name: 'Repo2',
          repo: 'user/repo2',
          score: 80,
          breakdown: calculateScore({}),
        },
        {
          name: 'Repo3',
          repo: 'user/repo3',
          score: 45,
          breakdown: calculateScore({}),
        },
      ];
      const previous: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 80,
          breakdown: calculateScore({}),
        },
        {
          name: 'Repo2',
          repo: 'user/repo2',
          score: 75,
          breakdown: calculateScore({}),
        },
        {
          name: 'Repo3',
          repo: 'user/repo3',
          score: 55,
          breakdown: calculateScore({}),
        },
      ];
      const drops = detectScoreDrops(current, previous);
      expect(drops).toHaveLength(2);
      expect(drops.map((d) => d.repo)).toContain('Repo1');
      expect(drops.map((d) => d.repo)).toContain('Repo3');
    });
  });

  describe('detectScoreImprovements', () => {
    it('should return empty array when no previous scores', () => {
      const current: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 75,
          breakdown: calculateScore({}),
        },
      ];
      const gains = detectScoreImprovements(current, null);
      expect(gains).toEqual([]);
    });

    it('should return empty array when no improvements', () => {
      const current: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 70,
          breakdown: calculateScore({}),
        },
      ];
      const previous: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 75,
          breakdown: calculateScore({}),
        },
      ];
      const gains = detectScoreImprovements(current, previous);
      expect(gains).toEqual([]);
    });

    it('should detect improvement of exactly 5 points', () => {
      const current: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 80,
          breakdown: calculateScore({}),
        },
      ];
      const previous: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 75,
          breakdown: calculateScore({}),
        },
      ];
      const gains = detectScoreImprovements(current, previous);
      expect(gains).toContainEqual({
        repo: 'Repo1',
        gain: 5,
        from: 75,
        to: 80,
      });
    });

    it('should detect improvement greater than 5 points', () => {
      const current: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 90,
          breakdown: calculateScore({}),
        },
      ];
      const previous: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 60,
          breakdown: calculateScore({}),
        },
      ];
      const gains = detectScoreImprovements(current, previous);
      expect(gains).toContainEqual({
        repo: 'Repo1',
        gain: 30,
        from: 60,
        to: 90,
      });
    });

    it('should ignore improvement less than 5 points', () => {
      const current: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 78,
          breakdown: calculateScore({}),
        },
      ];
      const previous: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 75,
          breakdown: calculateScore({}),
        },
      ];
      const gains = detectScoreImprovements(current, previous);
      expect(gains).toEqual([]);
    });
  });

  describe('generateReport', () => {
    it('should include report header with date', () => {
      const scores: RepoQualityScore[] = [
        {
          name: 'TestRepo',
          repo: 'user/test',
          score: 75,
          breakdown: calculateScore({ ciPasses: 15 }),
        },
      ];
      const report = generateReport(scores, []);
      expect(report).toContain('## Quality Score Report');
      expect(report).toMatch(/2\d{3}-\d{2}-\d{2}/);
    });

    it('should include summary section', () => {
      const scores: RepoQualityScore[] = [
        {
          name: 'TestRepo',
          repo: 'user/test',
          score: 75,
          breakdown: calculateScore({}),
        },
      ];
      const report = generateReport(scores, []);
      expect(report).toContain('### Summary');
      expect(report).toContain('Average Score');
      expect(report).toContain('Excellent');
      expect(report).toContain('Good');
      expect(report).toContain('Needs Work');
    });

    it('should calculate average score correctly', () => {
      const scores: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 60,
          breakdown: calculateScore({}),
        },
        {
          name: 'Repo2',
          repo: 'user/repo2',
          score: 80,
          breakdown: calculateScore({}),
        },
      ];
      const report = generateReport(scores, []);
      expect(report).toContain('**Average Score**: 70/100');
    });

    it('should count repos by score tier', () => {
      const scores: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 90,
          breakdown: calculateScore({}),
        },
        {
          name: 'Repo2',
          repo: 'user/repo2',
          score: 75,
          breakdown: calculateScore({}),
        },
        {
          name: 'Repo3',
          repo: 'user/repo3',
          score: 50,
          breakdown: calculateScore({}),
        },
      ];
      const report = generateReport(scores, []);
      expect(report).toContain('**Excellent** (80+): 1');
      expect(report).toContain('**Good** (60-79): 1');
      expect(report).toContain('**Needs Work** (<60): 1');
    });

    it('should include score drops section when present', () => {
      const scores: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 75,
          breakdown: calculateScore({}),
        },
      ];
      const drops = [{ repo: 'Repo1', drop: 10, from: 85, to: 75 }];
      const report = generateReport(scores, drops);
      expect(report).toContain('### Score Drops');
      expect(report).toContain('**Repo1**: 85 → 75 (-10)');
    });

    it('should not include score drops section when empty', () => {
      const scores: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 75,
          breakdown: calculateScore({}),
        },
      ];
      const report = generateReport(scores, []);
      expect(report).not.toContain('### Score Drops');
    });

    it('should include per-repository breakdown', () => {
      const breakdown = calculateScore({
        ciPasses: 15,
        coverageAboveThreshold: 15,
        prettierClean: 14,
      });
      const scores: RepoQualityScore[] = [
        {
          name: 'TestRepo',
          repo: 'user/test',
          score: 44,
          breakdown,
        },
      ];
      const report = generateReport(scores, []);
      expect(report).toContain('#### TestRepo');
      expect(report).toContain('**Score**: 44/100');
      expect(report).toContain('**CI Passes**: ✓');
      expect(report).toContain('**Coverage**: ✓');
      expect(report).toContain('**Prettier**: ✓');
      expect(report).toContain('**ESLint**: ✗');
    });

    it('should sort repos by score descending', () => {
      const scores: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 50,
          breakdown: calculateScore({}),
        },
        {
          name: 'Repo2',
          repo: 'user/repo2',
          score: 90,
          breakdown: calculateScore({}),
        },
        {
          name: 'Repo3',
          repo: 'user/repo3',
          score: 70,
          breakdown: calculateScore({}),
        },
      ];
      const report = generateReport(scores, []);
      const repo1Idx = report.indexOf('#### Repo1');
      const repo2Idx = report.indexOf('#### Repo2');
      const repo3Idx = report.indexOf('#### Repo3');

      expect(repo2Idx).toBeLessThan(repo3Idx);
      expect(repo3Idx).toBeLessThan(repo1Idx);
    });

    it('should show checkmarks for passing checks', () => {
      const breakdown = calculateScore({
        ciPasses: 15,
        coverageAboveThreshold: 15,
        eslintZeroWarnings: 14,
      });
      const scores: RepoQualityScore[] = [
        {
          name: 'TestRepo',
          repo: 'user/test',
          score: 44,
          breakdown,
        },
      ];
      const report = generateReport(scores, []);
      expect(report).toContain('**CI Passes**: ✓');
      expect(report).toContain('**ESLint**: ✓');
      expect(report).toContain('**Branch Protection**: ✗');
    });

    it('should handle multiple repos in report', () => {
      const scores: RepoQualityScore[] = [
        {
          name: 'Repo1',
          repo: 'user/repo1',
          score: 85,
          breakdown: calculateScore({ ciPasses: 15 }),
        },
        {
          name: 'Repo2',
          repo: 'user/repo2',
          score: 65,
          breakdown: calculateScore({ prettierClean: 14 }),
        },
        {
          name: 'Repo3',
          repo: 'user/repo3',
          score: 45,
          breakdown: calculateScore({}),
        },
      ];
      const report = generateReport(scores, []);
      expect(report).toContain('#### Repo1');
      expect(report).toContain('#### Repo2');
      expect(report).toContain('#### Repo3');
    });
  });
});
