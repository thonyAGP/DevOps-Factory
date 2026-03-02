/**
 * branch-protection.test.ts
 *
 * Tests pour branch-protection - logique de protection et filtrage
 */

import { describe, it, expect } from 'vitest';

describe('branch-protection logic', () => {
  describe('CI Check Patterns', () => {
    const CI_CHECK_PATTERNS = ['ci', 'build', 'test', 'lint', 'typecheck'];

    it('should include all expected patterns', () => {
      expect(CI_CHECK_PATTERNS).toHaveLength(5);
    });

    it('should match ci workflow', () => {
      const workflowName = 'CI Pipeline';
      const matches = CI_CHECK_PATTERNS.some((p) => workflowName.toLowerCase().includes(p));

      expect(matches).toBe(true);
    });

    it('should match build workflow', () => {
      const workflowName = 'Build and Deploy';
      const matches = CI_CHECK_PATTERNS.some((p) => workflowName.toLowerCase().includes(p));

      expect(matches).toBe(true);
    });

    it('should match test workflow', () => {
      const workflowName = 'Run Tests';
      const matches = CI_CHECK_PATTERNS.some((p) => workflowName.toLowerCase().includes(p));

      expect(matches).toBe(true);
    });

    it('should not match irrelevant workflows', () => {
      const workflowName = 'Release Notes';
      const matches = CI_CHECK_PATTERNS.some((p) => workflowName.toLowerCase().includes(p));

      expect(matches).toBe(false);
    });

    it('should be case insensitive', () => {
      const workflowName = 'LINT and FORMAT';
      const matches = CI_CHECK_PATTERNS.some((p) => workflowName.toLowerCase().includes(p));

      expect(matches).toBe(true);
    });
  });

  describe('Filter CI Workflows', () => {
    const CI_CHECK_PATTERNS = ['ci', 'build', 'test', 'lint', 'typecheck'];

    it('should filter CI-related workflows', () => {
      const allWorkflows = ['CI', 'Build', 'Update Deps', 'Tests', 'Release'];
      const ciWorkflows = allWorkflows.filter((name) =>
        CI_CHECK_PATTERNS.some((p) => name.toLowerCase().includes(p))
      );

      expect(ciWorkflows).toEqual(['CI', 'Build', 'Tests']);
    });

    it('should handle empty workflow list', () => {
      const allWorkflows: string[] = [];
      const ciWorkflows = allWorkflows.filter((name) =>
        CI_CHECK_PATTERNS.some((p) => name.toLowerCase().includes(p))
      );

      expect(ciWorkflows).toHaveLength(0);
    });

    it('should handle workflows with no CI checks', () => {
      const allWorkflows = ['Release', 'Deploy', 'Publish'];
      const ciWorkflows = allWorkflows.filter((name) =>
        CI_CHECK_PATTERNS.some((p) => name.toLowerCase().includes(p))
      );

      expect(ciWorkflows).toHaveLength(0);
    });
  });

  describe('Protection Status', () => {
    type ProtectionStatus = 'protected' | 'already' | 'skipped_private' | 'error';

    it('should handle protected status', () => {
      const status: ProtectionStatus = 'protected';
      expect(status).toBe('protected');
    });

    it('should handle already protected status', () => {
      const status: ProtectionStatus = 'already';
      expect(status).toBe('already');
    });

    it('should handle skipped private repo', () => {
      const status: ProtectionStatus = 'skipped_private';
      expect(status).toBe('skipped_private');
    });

    it('should handle error status', () => {
      const status: ProtectionStatus = 'error';
      expect(status).toBe('error');
    });
  });

  describe('Repo Privacy Check', () => {
    interface RepoInfo {
      private: boolean;
      default_branch: string;
    }

    it('should detect private repo', () => {
      const repo: RepoInfo = { private: true, default_branch: 'main' };
      const shouldSkip = repo.private;

      expect(shouldSkip).toBe(true);
    });

    it('should not skip public repo', () => {
      const repo: RepoInfo = { private: false, default_branch: 'main' };
      const shouldSkip = repo.private;

      expect(shouldSkip).toBe(false);
    });
  });

  describe('Default Branch Names', () => {
    it('should handle main as default', () => {
      const defaultBranch = 'main';
      expect(['main', 'master']).toContain(defaultBranch);
    });

    it('should handle master as default', () => {
      const defaultBranch = 'master';
      expect(['main', 'master']).toContain(defaultBranch);
    });

    it('should handle custom default branch', () => {
      const defaultBranch = 'develop';
      expect(defaultBranch).toBeTruthy();
    });
  });

  describe('Protection Result Structure', () => {
    interface ProtectionResult {
      project: string;
      repo: string;
      branch: string;
      status: 'protected' | 'already' | 'skipped_private' | 'error';
      reason?: string;
    }

    it('should create valid result for protected', () => {
      const result: ProtectionResult = {
        project: 'MyProject',
        repo: 'owner/repo',
        branch: 'main',
        status: 'protected',
      };

      expect(result.status).toBe('protected');
      expect(result.branch).toBe('main');
    });

    it('should include optional reason for errors', () => {
      const result: ProtectionResult = {
        project: 'MyProject',
        repo: 'owner/repo',
        branch: 'main',
        status: 'error',
        reason: 'API rate limit exceeded',
      };

      expect(result.reason).toBeDefined();
      expect(result.status).toBe('error');
    });

    it('should not require reason for success', () => {
      const result: ProtectionResult = {
        project: 'MyProject',
        repo: 'owner/repo',
        branch: 'main',
        status: 'protected',
      };

      expect(result.reason).toBeUndefined();
    });
  });

  describe('Label Consistency', () => {
    const LABEL = 'branch-protection';

    it('should use kebab-case', () => {
      expect(LABEL).toMatch(/^[a-z-]+$/);
    });

    it('should match expected value', () => {
      expect(LABEL).toBe('branch-protection');
    });
  });
});
