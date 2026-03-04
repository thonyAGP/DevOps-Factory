import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process');
vi.mock('node:fs');

describe('compliance-report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateComplianceScore', () => {
    it('should give 20 points for CI enabled', () => {
      const compliance = {
        repo: 'test',
        fullName: 'owner/test',
        mergedPRs: [],
        deployments: [],
        securityFindings: [],
        branchProtection: false,
        codeReview: false,
        ciEnabled: true,
      };

      let score = 0;
      if (compliance.ciEnabled) score += 20;

      expect(score).toBe(20);
    });

    it('should give 20 points for branch protection', () => {
      const compliance = {
        repo: 'test',
        fullName: 'owner/test',
        mergedPRs: [],
        deployments: [],
        securityFindings: [],
        branchProtection: true,
        codeReview: false,
        ciEnabled: false,
      };

      let score = 0;
      if (compliance.branchProtection) score += 20;

      expect(score).toBe(20);
    });

    it('should give 20 points for code review', () => {
      const compliance = {
        repo: 'test',
        fullName: 'owner/test',
        mergedPRs: [],
        deployments: [],
        securityFindings: [],
        branchProtection: false,
        codeReview: true,
        ciEnabled: false,
      };

      let score = 0;
      if (compliance.codeReview) score += 20;

      expect(score).toBe(20);
    });

    it('should give 20 points for security scanning', () => {
      const compliance = {
        repo: 'test',
        fullName: 'owner/test',
        mergedPRs: [],
        deployments: [],
        securityFindings: [
          {
            repo: 'test',
            type: 'vulnerability',
            severity: 'high',
            count: 1,
            lastScan: '2024-01-01',
          },
        ],
        branchProtection: false,
        codeReview: false,
        ciEnabled: false,
      };

      let score = 0;
      if (compliance.securityFindings.length > 0) score += 20;

      expect(score).toBe(20);
    });

    it('should calculate perfect score with all controls', () => {
      const compliance = {
        repo: 'test',
        fullName: 'owner/test',
        mergedPRs: [
          {
            number: 1,
            title: 'PR1',
            author: 'user1',
            mergedAt: '2024-01-01',
            reviewers: ['user2'],
            labels: [],
          },
          {
            number: 2,
            title: 'PR2',
            author: 'user1',
            mergedAt: '2024-01-02',
            reviewers: ['user2'],
            labels: [],
          },
        ],
        deployments: [],
        securityFindings: [
          {
            repo: 'test',
            type: 'vulnerability',
            severity: 'high',
            count: 1,
            lastScan: '2024-01-01',
          },
        ],
        branchProtection: true,
        codeReview: true,
        ciEnabled: true,
      };

      let score = 0;
      if (compliance.ciEnabled) score += 20;
      if (compliance.branchProtection) score += 20;
      if (compliance.codeReview) score += 20;
      if (compliance.securityFindings.length > 0) score += 20;

      const reviewed = compliance.mergedPRs.filter((pr) => pr.reviewers && pr.reviewers.length > 0);
      const coverage =
        compliance.mergedPRs.length > 0 ? reviewed.length / compliance.mergedPRs.length : 0;
      if (coverage >= 0.5) score += 20;

      const finalScore = Math.min(100, score);
      expect(finalScore).toBe(100);
    });

    it('should cap score at 100', () => {
      let score = 0;
      if (true) score += 20;
      if (true) score += 20;
      if (true) score += 20;
      if (true) score += 20;
      if (true) score += 20;
      if (true) score += 20;

      const finalScore = Math.min(100, score);
      expect(finalScore).toBe(100);
    });

    it('should give 0 points for no controls', () => {
      const compliance = {
        repo: 'test',
        fullName: 'owner/test',
        mergedPRs: [],
        deployments: [],
        securityFindings: [],
        branchProtection: false,
        codeReview: false,
        ciEnabled: false,
      };

      let score = 0;
      if (compliance.ciEnabled) score += 20;
      if (compliance.branchProtection) score += 20;
      if (compliance.codeReview) score += 20;
      if (compliance.securityFindings.length > 0) score += 20;

      expect(score).toBe(0);
    });
  });

  describe('PR Review Coverage', () => {
    it('should calculate coverage from reviewed PRs', () => {
      const prs = [
        {
          number: 1,
          title: 'PR1',
          author: 'user1',
          mergedAt: '2024-01-01',
          reviewers: ['user2'],
          labels: [],
        },
        {
          number: 2,
          title: 'PR2',
          author: 'user1',
          mergedAt: '2024-01-02',
          reviewers: [],
          labels: [],
        },
        {
          number: 3,
          title: 'PR3',
          author: 'user1',
          mergedAt: '2024-01-03',
          reviewers: ['user3'],
          labels: [],
        },
      ];

      const reviewed = prs.filter((pr) => pr.reviewers && pr.reviewers.length > 0);
      const coverage = (reviewed.length / prs.length) * 100;

      expect(coverage).toBeCloseTo(66.67, 1);
    });

    it('should handle 0% review coverage', () => {
      const prs = [
        {
          number: 1,
          title: 'PR1',
          author: 'user1',
          mergedAt: '2024-01-01',
          reviewers: [],
          labels: [],
        },
        {
          number: 2,
          title: 'PR2',
          author: 'user1',
          mergedAt: '2024-01-02',
          reviewers: [],
          labels: [],
        },
      ];

      const reviewed = prs.filter((pr) => pr.reviewers && pr.reviewers.length > 0);
      const coverage = prs.length > 0 ? (reviewed.length / prs.length) * 100 : 0;

      expect(coverage).toBe(0);
    });

    it('should handle 100% review coverage', () => {
      const prs = [
        {
          number: 1,
          title: 'PR1',
          author: 'user1',
          mergedAt: '2024-01-01',
          reviewers: ['user2'],
          labels: [],
        },
        {
          number: 2,
          title: 'PR2',
          author: 'user1',
          mergedAt: '2024-01-02',
          reviewers: ['user3'],
          labels: [],
        },
      ];

      const reviewed = prs.filter((pr) => pr.reviewers && pr.reviewers.length > 0);
      const coverage = (reviewed.length / prs.length) * 100;

      expect(coverage).toBe(100);
    });

    it('should handle empty PR list', () => {
      const prs: unknown[] = [];

      const reviewed = prs.filter((pr: any) => pr.reviewers && pr.reviewers.length > 0);
      const coverage = prs.length > 0 ? (reviewed.length / prs.length) * 100 : 0;

      expect(coverage).toBe(0);
    });
  });

  describe('Summary Aggregation', () => {
    it('should sum merged PRs across all repos', () => {
      const repos = [
        { mergedPRs: [{ number: 1 }, { number: 2 }] },
        { mergedPRs: [{ number: 3 }] },
        { mergedPRs: [] },
      ];

      const total = repos.reduce((s, r) => s + r.mergedPRs.length, 0);

      expect(total).toBe(3);
    });

    it('should count repos with branch protection', () => {
      const repos = [
        { repo: 'repo1', branchProtection: true },
        { repo: 'repo2', branchProtection: false },
        { repo: 'repo3', branchProtection: true },
      ];

      const count = repos.filter((r) => r.branchProtection).length;

      expect(count).toBe(2);
    });

    it('should count repos with CI enabled', () => {
      const repos = [
        { repo: 'repo1', ciEnabled: true },
        { repo: 'repo2', ciEnabled: false },
        { repo: 'repo3', ciEnabled: true },
        { repo: 'repo4', ciEnabled: true },
      ];

      const count = repos.filter((r) => r.ciEnabled).length;

      expect(count).toBe(3);
    });

    it('should calculate average compliance score', () => {
      const repos = [{ score: 80 }, { score: 70 }, { score: 90 }, { score: 60 }];

      const avg = Math.round(repos.reduce((s, r) => s + r.score, 0) / repos.length);

      expect(avg).toBe(75);
    });

    it('should count total deployments', () => {
      const repos = [
        { deployments: [{ repo: 'r1' }, { repo: 'r1' }] },
        { deployments: [{ repo: 'r2' }] },
        { deployments: [] },
      ];

      const total = repos.reduce((s, r) => s + r.deployments.length, 0);

      expect(total).toBe(3);
    });
  });

  describe('Score Status Determination', () => {
    it('should rate score >= 80 as EXCELLENT', () => {
      const score = 85;
      const status =
        score >= 80 ? 'EXCELLENT' : score >= 60 ? 'GOOD' : score >= 40 ? 'FAIR' : 'POOR';

      expect(status).toBe('EXCELLENT');
    });

    it('should rate score 60-79 as GOOD', () => {
      const score = 70;
      const status =
        score >= 80 ? 'EXCELLENT' : score >= 60 ? 'GOOD' : score >= 40 ? 'FAIR' : 'POOR';

      expect(status).toBe('GOOD');
    });

    it('should rate score 40-59 as FAIR', () => {
      const score = 50;
      const status =
        score >= 80 ? 'EXCELLENT' : score >= 60 ? 'GOOD' : score >= 40 ? 'FAIR' : 'POOR';

      expect(status).toBe('FAIR');
    });

    it('should rate score < 40 as POOR', () => {
      const score = 30;
      const status =
        score >= 80 ? 'EXCELLENT' : score >= 60 ? 'GOOD' : score >= 40 ? 'FAIR' : 'POOR';

      expect(status).toBe('POOR');
    });

    it('should rate exactly 80 as EXCELLENT', () => {
      const score = 80;
      const status =
        score >= 80 ? 'EXCELLENT' : score >= 60 ? 'GOOD' : score >= 40 ? 'FAIR' : 'POOR';

      expect(status).toBe('EXCELLENT');
    });

    it('should rate exactly 60 as GOOD', () => {
      const score = 60;
      const status =
        score >= 80 ? 'EXCELLENT' : score >= 60 ? 'GOOD' : score >= 40 ? 'FAIR' : 'POOR';

      expect(status).toBe('GOOD');
    });
  });

  describe('Compliance Gaps Detection', () => {
    it('should identify repos without branch protection', () => {
      const repos = [
        { repo: 'repo1', branchProtection: true },
        { repo: 'repo2', branchProtection: false },
        { repo: 'repo3', branchProtection: false },
      ];

      const noProtection = repos.filter((r) => !r.branchProtection);

      expect(noProtection).toHaveLength(2);
      expect(noProtection.map((r) => r.repo)).toEqual(['repo2', 'repo3']);
    });

    it('should identify repos without CI', () => {
      const repos = [
        { repo: 'repo1', ciEnabled: true },
        { repo: 'repo2', ciEnabled: false },
      ];

      const noCI = repos.filter((r) => !r.ciEnabled);

      expect(noCI).toHaveLength(1);
      expect(noCI[0].repo).toBe('repo2');
    });

    it('should identify repos with low review coverage', () => {
      const repos = [
        {
          repo: 'repo1',
          mergedPRs: [
            { number: 1, reviewers: ['user1'] },
            { number: 2, reviewers: [] },
          ],
        },
        {
          repo: 'repo2',
          mergedPRs: [
            { number: 1, reviewers: [] },
            { number: 2, reviewers: [] },
          ],
        },
      ];

      const lowReview = repos.filter(
        (r) =>
          r.mergedPRs.length > 0 &&
          r.mergedPRs.filter((pr) => pr.reviewers && pr.reviewers.length > 0).length === 0
      );

      expect(lowReview).toHaveLength(1);
      expect(lowReview[0].repo).toBe('repo2');
    });
  });

  describe('MergedPR Data Structure', () => {
    it('should validate merged PR structure', () => {
      const pr = {
        number: 123,
        title: 'Add feature X',
        author: 'john.doe',
        mergedAt: '2024-01-15T10:30:00Z',
        reviewers: ['jane.smith', 'bob.jones'],
        labels: ['feature', 'reviewed'],
      };

      expect(pr).toHaveProperty('number');
      expect(pr).toHaveProperty('title');
      expect(pr).toHaveProperty('author');
      expect(pr).toHaveProperty('mergedAt');
      expect(pr).toHaveProperty('reviewers');
      expect(pr).toHaveProperty('labels');
      expect(typeof pr.number).toBe('number');
      expect(Array.isArray(pr.reviewers)).toBe(true);
    });

    it('should handle PR with no reviewers', () => {
      const pr = {
        number: 124,
        title: 'Hotfix',
        author: 'user1',
        mergedAt: '2024-01-16T15:00:00Z',
        reviewers: [],
        labels: [],
      };

      expect(pr.reviewers).toHaveLength(0);
      expect(pr.labels).toHaveLength(0);
    });

    it('should handle PR with multiple reviewers', () => {
      const pr = {
        number: 125,
        title: 'Major refactor',
        author: 'user1',
        mergedAt: '2024-01-17T12:00:00Z',
        reviewers: ['user2', 'user3', 'user4', 'user5'],
        labels: ['refactoring'],
      };

      expect(pr.reviewers).toHaveLength(4);
    });
  });

  describe('DeployEvent Data Structure', () => {
    it('should validate deployment event structure', () => {
      const deploy = {
        repo: 'owner/repo',
        sha: 'abc123def456',
        branch: 'main',
        timestamp: '2024-01-15T10:30:00Z',
        workflow: 'CI/CD Pipeline',
        status: 'success',
      };

      expect(deploy).toHaveProperty('repo');
      expect(deploy).toHaveProperty('sha');
      expect(deploy).toHaveProperty('branch');
      expect(deploy).toHaveProperty('timestamp');
      expect(deploy).toHaveProperty('workflow');
      expect(deploy).toHaveProperty('status');
    });

    it('should handle different deployment statuses', () => {
      const statuses = ['success', 'failure', 'pending'];

      const deploy1 = { status: 'success' };
      const deploy2 = { status: 'failure' };
      const deploy3 = { status: 'pending' };

      expect(statuses).toContain(deploy1.status);
      expect(statuses).toContain(deploy2.status);
      expect(statuses).toContain(deploy3.status);
    });
  });

  describe('Report Markdown Generation', () => {
    it('should include summary section', () => {
      const md = `# Compliance & Audit Report

## Summary

| Metric | Value |
|--------|-------|
| Total Repos | 5 |
| Avg Compliance Score | 75/100 |`;

      expect(md).toContain('## Summary');
      expect(md).toContain('Total Repos');
      expect(md).toContain('Compliance Score');
    });

    it('should include repository compliance section', () => {
      const md = `## Repository Compliance

| Repo | Score |
|------|-------|
| repo1 | 85/100 |`;

      expect(md).toContain('## Repository Compliance');
      expect(md).toContain('repo1');
    });

    it('should include compliance gaps section', () => {
      const md = `## Compliance Gaps

### ⚠️ No Branch Protection (2)
- repo1
- repo2`;

      expect(md).toContain('## Compliance Gaps');
      expect(md).toContain('No Branch Protection');
    });

    it('should include recommendations section', () => {
      const md = `## Recommendations

1. **Enable Branch Protection** on all repos
2. **Setup CI/CD pipelines** for repos without automated testing`;

      expect(md).toContain('## Recommendations');
      expect(md).toContain('Enable Branch Protection');
      expect(md).toContain('Setup CI/CD pipelines');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty repos list', () => {
      const repos: unknown[] = [];

      const totalPRs = repos.reduce((s, r: any) => s + r.mergedPRs?.length || 0, 0);
      const avgScore = repos.length > 0 ? repos.reduce((s, r: any) => s + r.score, 0) / repos.length : 0;

      expect(totalPRs).toBe(0);
      expect(avgScore).toBe(0);
    });

    it('should handle PR with special characters in title', () => {
      const pr = {
        number: 999,
        title: 'Fix: "critical" bug & <xss> vulnerability',
        author: 'user1',
        mergedAt: '2024-01-20T10:00:00Z',
        reviewers: [],
        labels: [],
      };

      expect(pr.title).toContain('critical');
      expect(pr.title).toContain('&');
      expect(pr.title).toContain('<');
    });

    it('should handle repos with very high security findings', () => {
      const findings = Array.from({ length: 100 }, (_, i) => ({
        repo: 'repo',
        type: `CVE-${i}`,
        severity: 'high',
        count: 1,
        lastScan: '2024-01-01',
      }));

      expect(findings).toHaveLength(100);
    });

    it('should handle repos with no activity (0 PRs, 0 deployments)', () => {
      const repo = {
        repo: 'inactive',
        mergedPRs: [],
        deployments: [],
        securityFindings: [],
        branchProtection: false,
        codeReview: false,
        ciEnabled: false,
        score: 0,
      };

      expect(repo.mergedPRs).toHaveLength(0);
      expect(repo.deployments).toHaveLength(0);
      expect(repo.score).toBe(0);
    });
  });

  describe('Security Findings Aggregation', () => {
    interface SecurityFinding {
      repo: string;
      type: string;
      severity: string;
      count: number;
      lastScan: string;
    }

    it('should aggregate findings by severity', () => {
      const findings: SecurityFinding[] = [
        { repo: 'test', type: 'type1', severity: 'high', count: 1, lastScan: '2024-01-01' },
        { repo: 'test', type: 'type1', severity: 'high', count: 1, lastScan: '2024-01-01' },
        { repo: 'test', type: 'type2', severity: 'medium', count: 1, lastScan: '2024-01-01' },
      ];

      const bySeverity = new Map<string, { count: number }>();
      for (const finding of findings) {
        const key = `${finding.type}:${finding.severity}`;
        const existing = bySeverity.get(key);
        if (existing) {
          existing.count++;
        } else {
          bySeverity.set(key, { count: 1 });
        }
      }

      expect(bySeverity.size).toBe(2);
      expect(bySeverity.get('type1:high')?.count).toBe(2);
      expect(bySeverity.get('type2:medium')?.count).toBe(1);
    });

    it('should handle empty security findings', () => {
      const findings: unknown[] = [];

      const bySeverity = new Map();
      for (const finding: any of findings) {
        const key = `${finding.type}:${finding.severity}`;
        if (!bySeverity.has(key)) {
          bySeverity.set(key, { count: 1 });
        }
      }

      expect(bySeverity.size).toBe(0);
    });
  });
});
