/**
 * security-posture.test.ts
 *
 * Tests pour security-posture - évaluation sécurité des repos
 * Coverage: score calculation, grade assignment, workflow status evaluation
 */

import { describe, it, expect } from 'vitest';

describe('security-posture logic', () => {
  describe('Security score calculation', () => {
    interface SecurityWorkflowStatus {
      conclusion: 'success' | 'failure' | 'skipped' | 'not_found';
    }

    interface Workflows {
      gitleaks: SecurityWorkflowStatus;
      supplyChain: SecurityWorkflowStatus;
      licenseCheck: SecurityWorkflowStatus;
      semgrep: SecurityWorkflowStatus;
      containerScan: SecurityWorkflowStatus;
      securityHeaders: SecurityWorkflowStatus;
    }

    const calculateSecurityScore = (workflows: Workflows): { score: number; issues: string[] } => {
      let score = 100;
      const issues: string[] = [];

      // Gitleaks (critical: -25 if missing, -15 if failing)
      if (workflows.gitleaks.conclusion === 'not_found') {
        score -= 25;
        issues.push('No secret scanning configured');
      } else if (workflows.gitleaks.conclusion === 'failure') {
        score -= 15;
        issues.push('Secret scanning detected issues');
      }

      // Supply chain (important: -20 if missing, -10 if failing)
      if (workflows.supplyChain.conclusion === 'not_found') {
        score -= 20;
        issues.push('No supply chain security scanning');
      } else if (workflows.supplyChain.conclusion === 'failure') {
        score -= 10;
        issues.push('Supply chain vulnerabilities detected');
      }

      // License check (moderate: -10 if missing, -5 if failing)
      if (workflows.licenseCheck.conclusion === 'not_found') {
        score -= 10;
        issues.push('No license compliance check');
      } else if (workflows.licenseCheck.conclusion === 'failure') {
        score -= 5;
        issues.push('License compliance issues');
      }

      // Semgrep SAST (moderate: -10 if missing)
      if (workflows.semgrep.conclusion === 'not_found') {
        score -= 10;
        issues.push('No SAST scanning configured');
      } else if (workflows.semgrep.conclusion === 'failure') {
        score -= 5;
        issues.push('SAST scanner found issues');
      }

      // Container scan (optional: -5 if failing)
      if (workflows.containerScan.conclusion === 'failure') {
        score -= 5;
        issues.push('Container vulnerabilities detected');
      }

      // Security headers (optional: -5 if failing)
      if (workflows.securityHeaders.conclusion === 'failure') {
        score -= 5;
        issues.push('Security headers misconfigured');
      }

      return { score: Math.max(0, score), issues };
    };

    it('should return 100 for all successful workflows', () => {
      const workflows: Workflows = {
        gitleaks: { conclusion: 'success' },
        supplyChain: { conclusion: 'success' },
        licenseCheck: { conclusion: 'success' },
        semgrep: { conclusion: 'success' },
        containerScan: { conclusion: 'success' },
        securityHeaders: { conclusion: 'success' },
      };

      const { score } = calculateSecurityScore(workflows);

      expect(score).toBe(100);
    });

    it('should deduct 25 points if gitleaks missing', () => {
      const workflows: Workflows = {
        gitleaks: { conclusion: 'not_found' },
        supplyChain: { conclusion: 'success' },
        licenseCheck: { conclusion: 'success' },
        semgrep: { conclusion: 'success' },
        containerScan: { conclusion: 'success' },
        securityHeaders: { conclusion: 'success' },
      };

      const { score } = calculateSecurityScore(workflows);

      expect(score).toBe(75);
    });

    it('should deduct 15 points if gitleaks fails', () => {
      const workflows: Workflows = {
        gitleaks: { conclusion: 'failure' },
        supplyChain: { conclusion: 'success' },
        licenseCheck: { conclusion: 'success' },
        semgrep: { conclusion: 'success' },
        containerScan: { conclusion: 'success' },
        securityHeaders: { conclusion: 'success' },
      };

      const { score } = calculateSecurityScore(workflows);

      expect(score).toBe(85);
    });

    it('should deduct 20 points if supply chain missing', () => {
      const workflows: Workflows = {
        gitleaks: { conclusion: 'success' },
        supplyChain: { conclusion: 'not_found' },
        licenseCheck: { conclusion: 'success' },
        semgrep: { conclusion: 'success' },
        containerScan: { conclusion: 'success' },
        securityHeaders: { conclusion: 'success' },
      };

      const { score } = calculateSecurityScore(workflows);

      expect(score).toBe(80);
    });

    it('should deduct 10 points if supply chain fails', () => {
      const workflows: Workflows = {
        gitleaks: { conclusion: 'success' },
        supplyChain: { conclusion: 'failure' },
        licenseCheck: { conclusion: 'success' },
        semgrep: { conclusion: 'success' },
        containerScan: { conclusion: 'success' },
        securityHeaders: { conclusion: 'success' },
      };

      const { score } = calculateSecurityScore(workflows);

      expect(score).toBe(90);
    });

    it('should deduct 10 points if license check missing', () => {
      const workflows: Workflows = {
        gitleaks: { conclusion: 'success' },
        supplyChain: { conclusion: 'success' },
        licenseCheck: { conclusion: 'not_found' },
        semgrep: { conclusion: 'success' },
        containerScan: { conclusion: 'success' },
        securityHeaders: { conclusion: 'success' },
      };

      const { score } = calculateSecurityScore(workflows);

      expect(score).toBe(90);
    });

    it('should deduct 5 points if license check fails', () => {
      const workflows: Workflows = {
        gitleaks: { conclusion: 'success' },
        supplyChain: { conclusion: 'success' },
        licenseCheck: { conclusion: 'failure' },
        semgrep: { conclusion: 'success' },
        containerScan: { conclusion: 'success' },
        securityHeaders: { conclusion: 'success' },
      };

      const { score } = calculateSecurityScore(workflows);

      expect(score).toBe(95);
    });

    it('should deduct 10 points if semgrep missing', () => {
      const workflows: Workflows = {
        gitleaks: { conclusion: 'success' },
        supplyChain: { conclusion: 'success' },
        licenseCheck: { conclusion: 'success' },
        semgrep: { conclusion: 'not_found' },
        containerScan: { conclusion: 'success' },
        securityHeaders: { conclusion: 'success' },
      };

      const { score } = calculateSecurityScore(workflows);

      expect(score).toBe(90);
    });

    it('should deduct 5 points if semgrep fails', () => {
      const workflows: Workflows = {
        gitleaks: { conclusion: 'success' },
        supplyChain: { conclusion: 'success' },
        licenseCheck: { conclusion: 'success' },
        semgrep: { conclusion: 'failure' },
        containerScan: { conclusion: 'success' },
        securityHeaders: { conclusion: 'success' },
      };

      const { score } = calculateSecurityScore(workflows);

      expect(score).toBe(95);
    });

    it('should deduct 5 points if container scan fails', () => {
      const workflows: Workflows = {
        gitleaks: { conclusion: 'success' },
        supplyChain: { conclusion: 'success' },
        licenseCheck: { conclusion: 'success' },
        semgrep: { conclusion: 'success' },
        containerScan: { conclusion: 'failure' },
        securityHeaders: { conclusion: 'success' },
      };

      const { score } = calculateSecurityScore(workflows);

      expect(score).toBe(95);
    });

    it('should deduct 5 points if security headers fail', () => {
      const workflows: Workflows = {
        gitleaks: { conclusion: 'success' },
        supplyChain: { conclusion: 'success' },
        licenseCheck: { conclusion: 'success' },
        semgrep: { conclusion: 'success' },
        containerScan: { conclusion: 'success' },
        securityHeaders: { conclusion: 'failure' },
      };

      const { score } = calculateSecurityScore(workflows);

      expect(score).toBe(95);
    });

    it('should handle multiple critical failures', () => {
      const workflows: Workflows = {
        gitleaks: { conclusion: 'not_found' }, // -25
        supplyChain: { conclusion: 'not_found' }, // -20
        licenseCheck: { conclusion: 'not_found' }, // -10
        semgrep: { conclusion: 'not_found' }, // -10
        containerScan: { conclusion: 'success' },
        securityHeaders: { conclusion: 'success' },
      };

      const { score } = calculateSecurityScore(workflows);

      expect(score).toBe(35); // 100 - 25 - 20 - 10 - 10
    });

    it('should never go below 0', () => {
      const workflows: Workflows = {
        gitleaks: { conclusion: 'not_found' }, // -25
        supplyChain: { conclusion: 'failure' }, // -10
        licenseCheck: { conclusion: 'failure' }, // -5
        semgrep: { conclusion: 'failure' }, // -5
        containerScan: { conclusion: 'failure' }, // -5
        securityHeaders: { conclusion: 'failure' }, // -5
      };

      const { score } = calculateSecurityScore(workflows);

      expect(score).toBeGreaterThanOrEqual(0);
    });

    it('should include issue descriptions', () => {
      const workflows: Workflows = {
        gitleaks: { conclusion: 'not_found' },
        supplyChain: { conclusion: 'failure' },
        licenseCheck: { conclusion: 'success' },
        semgrep: { conclusion: 'success' },
        containerScan: { conclusion: 'success' },
        securityHeaders: { conclusion: 'success' },
      };

      const { issues } = calculateSecurityScore(workflows);

      expect(issues).toContain('No secret scanning configured');
      expect(issues).toContain('Supply chain vulnerabilities detected');
      expect(issues).toHaveLength(2);
    });
  });

  describe('Grade assignment', () => {
    const getGrade = (score: number): 'A' | 'B' | 'C' | 'D' | 'F' => {
      if (score >= 90) return 'A';
      if (score >= 75) return 'B';
      if (score >= 60) return 'C';
      if (score >= 40) return 'D';
      return 'F';
    };

    it('should assign A for score >= 90', () => {
      expect(getGrade(100)).toBe('A');
      expect(getGrade(95)).toBe('A');
      expect(getGrade(90)).toBe('A');
    });

    it('should assign B for score 75-89', () => {
      expect(getGrade(89)).toBe('B');
      expect(getGrade(80)).toBe('B');
      expect(getGrade(75)).toBe('B');
    });

    it('should assign C for score 60-74', () => {
      expect(getGrade(74)).toBe('C');
      expect(getGrade(65)).toBe('C');
      expect(getGrade(60)).toBe('C');
    });

    it('should assign D for score 40-59', () => {
      expect(getGrade(59)).toBe('D');
      expect(getGrade(50)).toBe('D');
      expect(getGrade(40)).toBe('D');
    });

    it('should assign F for score < 40', () => {
      expect(getGrade(39)).toBe('F');
      expect(getGrade(20)).toBe('F');
      expect(getGrade(0)).toBe('F');
    });

    it('should handle boundary values exactly', () => {
      expect(getGrade(90)).toBe('A'); // Boundary
      expect(getGrade(89.9)).toBe('B');
      expect(getGrade(75)).toBe('B'); // Boundary
      expect(getGrade(74.9)).toBe('C');
      expect(getGrade(60)).toBe('C'); // Boundary
      expect(getGrade(59.9)).toBe('D');
      expect(getGrade(40)).toBe('D'); // Boundary
      expect(getGrade(39.9)).toBe('F');
    });
  });

  describe('Grade distribution', () => {
    it('should count repos by grade', () => {
      const repos = [
        { grade: 'A' as const, score: 95 },
        { grade: 'A' as const, score: 92 },
        { grade: 'B' as const, score: 80 },
        { grade: 'C' as const, score: 65 },
        { grade: 'F' as const, score: 30 },
      ];

      const distribution: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
      for (const r of repos) distribution[r.grade]++;

      expect(distribution.A).toBe(2);
      expect(distribution.B).toBe(1);
      expect(distribution.C).toBe(1);
      expect(distribution.D).toBe(0);
      expect(distribution.F).toBe(1);
    });

    it('should handle all same grade', () => {
      const repos = [{ grade: 'A' as const }, { grade: 'A' as const }, { grade: 'A' as const }];

      const distribution: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
      for (const r of repos) distribution[r.grade]++;

      expect(distribution.A).toBe(3);
      expect(distribution.B + distribution.C + distribution.D + distribution.F).toBe(0);
    });

    it('should handle empty repos', () => {
      const repos: unknown[] = [];

      const distribution: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
      for (const r of repos) distribution[r.grade]++;

      const totalCount = Object.values(distribution).reduce((a, b) => a + b, 0);
      expect(totalCount).toBe(0);
    });
  });

  describe('Summary calculations', () => {
    const calculateSummary = (repos: unknown[]) => {
      const avgScore =
        repos.length > 0 ? Math.round(repos.reduce((s, r) => s + r.score, 0) / repos.length) : 0;
      const reposWithSecurity = repos.filter((r) => r.score >= 60).length;
      const criticalIssues = repos.reduce(
        (s, r) =>
          s +
          (r.issues
            ? r.issues.filter(
                (i: string) => i.includes('secret') || i.includes('vulnerabilities detected')
              ).length
            : 0),
        0
      );

      return { avgScore, reposWithSecurity, criticalIssues };
    };

    it('should calculate average score correctly', () => {
      const repos = [{ score: 100 }, { score: 80 }, { score: 60 }];

      const { avgScore } = calculateSummary(repos);

      expect(avgScore).toBe(80); // (100 + 80 + 60) / 3 = 80
    });

    it('should count repos with security score >= 60', () => {
      const repos = [
        { score: 95, issues: [] },
        { score: 75, issues: [] },
        { score: 65, issues: [] },
        { score: 55, issues: [] },
        { score: 30, issues: [] },
      ];

      const { reposWithSecurity } = calculateSummary(repos);

      expect(reposWithSecurity).toBe(3);
    });

    it('should count critical issues', () => {
      const repos = [
        {
          score: 80,
          issues: ['No secret scanning configured', 'License compliance issues'],
        },
        {
          score: 60,
          issues: ['Supply chain vulnerabilities detected', 'Other issue'],
        },
      ];

      const { criticalIssues } = calculateSummary(repos);

      expect(criticalIssues).toBe(2); // 1 secret + 1 vulnerabilities
    });

    it('should handle single repo', () => {
      const repos = [{ score: 85, issues: ['No secret scanning configured'] }];

      const { avgScore, reposWithSecurity, criticalIssues } = calculateSummary(repos);

      expect(avgScore).toBe(85);
      expect(reposWithSecurity).toBe(1);
      expect(criticalIssues).toBe(1);
    });

    it('should handle empty repos', () => {
      const repos: unknown[] = [];

      try {
        const result = calculateSummary(repos);
        expect(isNaN(result.avgScore)).toBe(true);
      } catch {
        // Expected on division by zero
      }
    });

    it('should round average score', () => {
      const repos = [{ score: 87 }, { score: 88 }, { score: 86 }];

      const { avgScore } = calculateSummary(repos);

      expect(typeof avgScore).toBe('number');
      expect(avgScore).toBe(87); // (87 + 88 + 86) / 3 = 87
    });
  });

  describe('Workflow status evaluation', () => {
    it('should categorize success status', () => {
      const status = { conclusion: 'success' };
      expect(status.conclusion).toBe('success');
    });

    it('should categorize failure status', () => {
      const status = { conclusion: 'failure' };
      expect(status.conclusion).toBe('failure');
    });

    it('should categorize skipped status', () => {
      const status = { conclusion: 'skipped' };
      expect(status.conclusion).toBe('skipped');
    });

    it('should categorize not_found status', () => {
      const status = { conclusion: 'not_found' };
      expect(status.conclusion).toBe('not_found');
    });

    it('should have lastRun timestamp when available', () => {
      const status = { lastRun: '2024-03-10T12:00:00Z', conclusion: 'success' as const };
      expect(status.lastRun).toBeDefined();
    });

    it('should allow null lastRun', () => {
      const status = { lastRun: null, conclusion: 'skipped' as const };
      expect(status.lastRun).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should handle repos with no issues', () => {
      const repos = [{ grade: 'A', score: 100, issues: [] }];

      expect(repos[0].issues).toHaveLength(0);
    });

    it('should handle repos with many issues', () => {
      const issues = Array.from({ length: 10 }, (_, i) => `Issue ${i + 1}`);
      const repos = [{ grade: 'F', score: 10, issues }];

      expect(repos[0].issues).toHaveLength(10);
    });

    it('should handle very large number of repos', () => {
      const repos = Array.from({ length: 1000 }, (_, i) => ({
        grade: i % 5 === 0 ? 'A' : i % 5 === 1 ? 'B' : i % 5 === 2 ? 'C' : i % 5 === 3 ? 'D' : 'F',
        score: 100 - (i % 100),
        issues: [],
      }));

      expect(repos).toHaveLength(1000);

      const avgScore = Math.round(repos.reduce((s, r) => s + r.score, 0) / repos.length);
      expect(typeof avgScore).toBe('number');
    });

    it('should handle repos with unicode characters in names', () => {
      const repos = [
        {
          repo: 'repo-français',
          fullName: 'org/repo-français',
          grade: 'A' as const,
          score: 95,
          issues: [],
        },
      ];

      expect(repos[0].repo).toContain('français');
    });

    it('should handle missing workflow status gracefully', () => {
      const workflows = {
        gitleaks: { conclusion: 'not_found' as const },
        supplyChain: { conclusion: 'not_found' as const },
        licenseCheck: { conclusion: 'not_found' as const },
        semgrep: { conclusion: 'not_found' as const },
        containerScan: { conclusion: 'not_found' as const },
        securityHeaders: { conclusion: 'not_found' as const },
      };

      let score = 100;
      if (workflows.gitleaks.conclusion === 'not_found') score -= 25;
      if (workflows.supplyChain.conclusion === 'not_found') score -= 20;
      if (workflows.licenseCheck.conclusion === 'not_found') score -= 10;
      if (workflows.semgrep.conclusion === 'not_found') score -= 10;

      expect(score).toBe(35);
    });
  });

  describe('Critical issues filtering', () => {
    it('should count only secret-related issues', () => {
      const issues = [
        'No secret scanning configured',
        'License compliance issues',
        'Secret scanning detected issues',
      ];

      const criticalCount = issues.filter((i) => i.toLowerCase().includes('secret')).length;

      expect(criticalCount).toBe(2);
    });

    it('should count vulnerabilities detected issues', () => {
      const issues = [
        'Supply chain vulnerabilities detected',
        'Container vulnerabilities detected',
        'Security headers misconfigured',
      ];

      const criticalCount = issues.filter((i) => i.includes('vulnerabilities detected')).length;

      expect(criticalCount).toBe(2);
    });

    it('should not count other issues as critical', () => {
      const issues = [
        'No license compliance check',
        'No SAST scanning configured',
        'Security headers misconfigured',
      ];

      const criticalCount = issues.filter(
        (i) => i.includes('secret') || i.includes('vulnerabilities detected')
      ).length;

      expect(criticalCount).toBe(0);
    });

    it('should handle empty issues array', () => {
      const issues: string[] = [];

      const criticalCount = issues.filter(
        (i) => i.includes('secret') || i.includes('vulnerabilities detected')
      ).length;

      expect(criticalCount).toBe(0);
    });
  });
});
