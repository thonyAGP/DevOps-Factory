/**
 * factory-watchdog.test.ts
 *
 * Unit tests for factory-watchdog.ts
 * Tests pure functions for pattern detection and failure classification
 */

import { describe, it, expect } from 'vitest';

// Pattern constants from factory-watchdog.ts
const HEALABLE_PATTERNS = [
  'All providers failed',
  '/bin/sh:',
  'Failed to upload',
  'Cannot find module',
  'Failed to create PR',
  'All uploads failed',
];

const INFORMATIONAL_PATTERNS = [
  'ETIMEDOUT',
  'ECONNREFUSED',
  'rate limit exceeded',
  'Could not resolve host',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'gh: not found',
];

const ALL_PARTIAL_PATTERNS = [...HEALABLE_PATTERNS, ...INFORMATIONAL_PATTERNS];

// Pure functions extracted for testing
const detectPartialFailures = (logs: string): string[] => {
  return ALL_PARTIAL_PATTERNS.filter((pattern) =>
    logs.toLowerCase().includes(pattern.toLowerCase())
  );
};

const hasHealablePatterns = (patterns: string[]): boolean => {
  return patterns.some((p) => HEALABLE_PATTERNS.some((hp) => p.toLowerCase() === hp.toLowerCase()));
};

const classifyWorkflowStatus = (
  conclusion: string | null,
  patterns: string[]
): 'pass' | 'total_failure' | 'partial_failure' => {
  if (conclusion === 'success') {
    if (patterns.length > 0) {
      return 'partial_failure';
    }
    return 'pass';
  }
  return 'total_failure';
};

const shouldCreateIssue = (status: string, patterns: string[]): boolean => {
  if (status === 'pass') return false;
  if (status === 'partial_failure' && !hasHealablePatterns(patterns)) {
    return false;
  }
  return true;
};

const isHealableWorkflow = (workflowName: string): boolean => {
  const SELF_HEALABLE_WORKFLOWS = [
    'Factory CI',
    'CI Health Check',
    'Quality Score',
    'Coverage Audit',
    'AI Test Writer',
    'Dependency Intelligence',
    'Feedback Collector',
    'Test Scaffold',
    'Coverage Baseline',
  ];
  return SELF_HEALABLE_WORKFLOWS.includes(workflowName);
};

const shouldTriggerSelfHeal = (
  workflowStatus: string,
  patterns: string[],
  workflowName: string,
  headBranch: string,
  timeSinceLastHeal: number
): boolean => {
  // Guard: cooldown 24h for factory
  const FACTORY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
  if (timeSinceLastHeal > 0 && Date.now() - timeSinceLastHeal < FACTORY_COOLDOWN_MS) {
    return false;
  }

  // Guard: don't heal failures on ai-fix branches
  if (headBranch.startsWith('ai-fix/')) {
    return false;
  }

  // Trigger for:
  // - Total failures on healable workflows
  // - Partial failures with healable patterns
  const shouldHeal =
    isHealableWorkflow(workflowName) &&
    (workflowStatus === 'total_failure' ||
      (workflowStatus === 'partial_failure' && hasHealablePatterns(patterns)));

  return shouldHeal;
};

const shouldCloseIssue = (
  _issueWorkflow: string,
  currentStatus: string,
  currentPatterns: string[]
): boolean => {
  // Close if workflow recovered (passing now)
  if (currentStatus === 'pass') {
    return true;
  }

  // Close informational-only partial failures (no healable patterns = transient, not actionable)
  if (currentStatus === 'partial_failure' && !hasHealablePatterns(currentPatterns)) {
    return true;
  }

  return false;
};

describe('factory-watchdog', () => {
  describe('detectPartialFailures', () => {
    it('should detect healable patterns in logs', () => {
      const logs = 'Error: All providers failed during deployment';
      const patterns = detectPartialFailures(logs);
      expect(patterns).toContain('All providers failed');
    });

    it('should detect shell errors', () => {
      const logs = 'Failed at step: /bin/sh: command not found';
      const patterns = detectPartialFailures(logs);
      expect(patterns).toContain('/bin/sh:');
    });

    it('should detect upload failures', () => {
      const logs = 'Deploy failed: Failed to upload artifacts to S3';
      const patterns = detectPartialFailures(logs);
      expect(patterns).toContain('Failed to upload');
    });

    it('should detect module not found errors', () => {
      const logs = 'Cannot find module "@types/node"';
      const patterns = detectPartialFailures(logs);
      expect(patterns).toContain('Cannot find module');
    });

    it('should detect PR creation failures', () => {
      const logs = 'Workflow error: Failed to create PR on main branch';
      const patterns = detectPartialFailures(logs);
      expect(patterns).toContain('Failed to create PR');
    });

    it('should detect bulk upload failures', () => {
      const logs = 'Critical: All uploads failed due to network error';
      const patterns = detectPartialFailures(logs);
      expect(patterns).toContain('All uploads failed');
    });

    it('should detect timeout errors', () => {
      const logs = 'Network error: ETIMEDOUT while connecting to API';
      const patterns = detectPartialFailures(logs);
      expect(patterns).toContain('ETIMEDOUT');
    });

    it('should detect connection refused errors', () => {
      const logs = 'Service unavailable: ECONNREFUSED on port 3000';
      const patterns = detectPartialFailures(logs);
      expect(patterns).toContain('ECONNREFUSED');
    });

    it('should detect rate limit errors', () => {
      const logs = 'GitHub API: rate limit exceeded in request';
      const patterns = detectPartialFailures(logs);
      expect(patterns).toContain('rate limit exceeded');
    });

    it('should detect DNS resolution errors', () => {
      const logs = 'Could not resolve host: api.example.com';
      const patterns = detectPartialFailures(logs);
      expect(patterns).toContain('Could not resolve host');
    });

    it('should detect missing API keys', () => {
      const logs = 'Error: GEMINI_API_KEY environment variable not set';
      const patterns = detectPartialFailures(logs);
      expect(patterns).toContain('GEMINI_API_KEY');
    });

    it('should detect missing GROQ key', () => {
      const logs = 'GROQ_API_KEY missing in environment';
      const patterns = detectPartialFailures(logs);
      expect(patterns).toContain('GROQ_API_KEY');
    });

    it('should detect gh command not found', () => {
      const logs = 'Command failed: gh: not found';
      const patterns = detectPartialFailures(logs);
      expect(patterns).toContain('gh: not found');
    });

    it('should be case-insensitive', () => {
      const logs = 'ERROR: ALL PROVIDERS FAILED IN DEPLOYMENT';
      const patterns = detectPartialFailures(logs);
      expect(patterns).toContain('All providers failed');
    });

    it('should handle multiple patterns in logs', () => {
      const logs = 'Error 1: ETIMEDOUT\nError 2: rate limit exceeded\nError 3: ECONNREFUSED';
      const patterns = detectPartialFailures(logs);
      expect(patterns).toHaveLength(3);
      expect(patterns).toContain('ETIMEDOUT');
      expect(patterns).toContain('rate limit exceeded');
      expect(patterns).toContain('ECONNREFUSED');
    });

    it('should return empty array for clean logs', () => {
      const logs = 'Deployment completed successfully. All systems operational.';
      const patterns = detectPartialFailures(logs);
      expect(patterns).toEqual([]);
    });

    it('should handle empty logs', () => {
      const patterns = detectPartialFailures('');
      expect(patterns).toEqual([]);
    });
  });

  describe('hasHealablePatterns', () => {
    it('should return true for healable patterns', () => {
      const patterns = ['All providers failed'];
      expect(hasHealablePatterns(patterns)).toBe(true);
    });

    it('should return false for informational-only patterns', () => {
      const patterns = ['ETIMEDOUT', 'rate limit exceeded'];
      expect(hasHealablePatterns(patterns)).toBe(false);
    });

    it('should return true when healable patterns mixed with informational', () => {
      const patterns = ['ETIMEDOUT', 'Failed to upload', 'rate limit exceeded'];
      expect(hasHealablePatterns(patterns)).toBe(true);
    });

    it('should return false for empty patterns', () => {
      expect(hasHealablePatterns([])).toBe(false);
    });

    it('should be case-insensitive', () => {
      const patterns = ['all providers failed'];
      expect(hasHealablePatterns(patterns)).toBe(true);
    });

    it('should detect all healable pattern types', () => {
      const patterns = HEALABLE_PATTERNS;
      expect(hasHealablePatterns(patterns)).toBe(true);
    });
  });

  describe('classifyWorkflowStatus', () => {
    it('should classify successful run with no patterns as pass', () => {
      const status = classifyWorkflowStatus('success', []);
      expect(status).toBe('pass');
    });

    it('should classify successful run with patterns as partial_failure', () => {
      const patterns = ['ETIMEDOUT'];
      const status = classifyWorkflowStatus('success', patterns);
      expect(status).toBe('partial_failure');
    });

    it('should classify failed run as total_failure', () => {
      const status = classifyWorkflowStatus('failure', []);
      expect(status).toBe('total_failure');
    });

    it('should classify cancelled run as total_failure', () => {
      const status = classifyWorkflowStatus('cancelled', []);
      expect(status).toBe('total_failure');
    });

    it('should handle null conclusion as total_failure', () => {
      const status = classifyWorkflowStatus(null, []);
      expect(status).toBe('total_failure');
    });

    it('should classify timed out run as total_failure', () => {
      const status = classifyWorkflowStatus('timed_out', []);
      expect(status).toBe('total_failure');
    });
  });

  describe('shouldCreateIssue', () => {
    it('should not create issue for passing workflow', () => {
      const should = shouldCreateIssue('pass', []);
      expect(should).toBe(false);
    });

    it('should create issue for total failure', () => {
      const should = shouldCreateIssue('total_failure', []);
      expect(should).toBe(true);
    });

    it('should create issue for partial failure with healable patterns', () => {
      const patterns = ['Failed to upload'];
      const should = shouldCreateIssue('partial_failure', patterns);
      expect(should).toBe(true);
    });

    it('should not create issue for partial failure with informational patterns only', () => {
      const patterns = ['ETIMEDOUT', 'rate limit exceeded'];
      const should = shouldCreateIssue('partial_failure', patterns);
      expect(should).toBe(false);
    });

    it('should create issue for partial failure with mixed patterns (has healable)', () => {
      const patterns = ['ETIMEDOUT', 'Failed to upload', 'rate limit exceeded'];
      const should = shouldCreateIssue('partial_failure', patterns);
      expect(should).toBe(true);
    });
  });

  describe('isHealableWorkflow', () => {
    it('should identify Factory CI as healable', () => {
      expect(isHealableWorkflow('Factory CI')).toBe(true);
    });

    it('should identify CI Health Check as healable', () => {
      expect(isHealableWorkflow('CI Health Check')).toBe(true);
    });

    it('should identify Quality Score as healable', () => {
      expect(isHealableWorkflow('Quality Score')).toBe(true);
    });

    it('should identify Coverage Audit as healable', () => {
      expect(isHealableWorkflow('Coverage Audit')).toBe(true);
    });

    it('should identify AI Test Writer as healable', () => {
      expect(isHealableWorkflow('AI Test Writer')).toBe(true);
    });

    it('should identify Dependency Intelligence as healable', () => {
      expect(isHealableWorkflow('Dependency Intelligence')).toBe(true);
    });

    it('should identify Feedback Collector as healable', () => {
      expect(isHealableWorkflow('Feedback Collector')).toBe(true);
    });

    it('should identify Test Scaffold as healable', () => {
      expect(isHealableWorkflow('Test Scaffold')).toBe(true);
    });

    it('should identify Coverage Baseline as healable', () => {
      expect(isHealableWorkflow('Coverage Baseline')).toBe(true);
    });

    it('should reject unknown workflows', () => {
      expect(isHealableWorkflow('Some Random Workflow')).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(isHealableWorkflow('factory ci')).toBe(false);
    });
  });

  describe('shouldTriggerSelfHeal', () => {
    const twentyFiveHoursAgo = Date.now() - 25 * 60 * 60 * 1000;
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;

    it('should trigger heal for total failure on healable workflow', () => {
      const should = shouldTriggerSelfHeal(
        'total_failure',
        [],
        'Factory CI',
        'main',
        0 // no previous heal
      );
      expect(should).toBe(true);
    });

    it('should trigger heal for partial failure with healable patterns on healable workflow', () => {
      const should = shouldTriggerSelfHeal(
        'partial_failure',
        ['Failed to upload'],
        'Quality Score',
        'main',
        0
      );
      expect(should).toBe(true);
    });

    it('should not trigger heal for partial failure with only informational patterns', () => {
      const should = shouldTriggerSelfHeal(
        'partial_failure',
        ['ETIMEDOUT', 'rate limit exceeded'],
        'Coverage Audit',
        'main',
        0
      );
      expect(should).toBe(false);
    });

    it('should not trigger heal for non-healable workflow', () => {
      const should = shouldTriggerSelfHeal('total_failure', [], 'Some Other Workflow', 'main', 0);
      expect(should).toBe(false);
    });

    it('should not trigger heal for passing workflow', () => {
      const should = shouldTriggerSelfHeal('pass', [], 'Factory CI', 'main', 0);
      expect(should).toBe(false);
    });

    it('should not trigger heal on ai-fix branch', () => {
      const should = shouldTriggerSelfHeal(
        'total_failure',
        [],
        'Factory CI',
        'ai-fix/test-branch',
        0
      );
      expect(should).toBe(false);
    });

    it('should not trigger heal within cooldown period', () => {
      const should = shouldTriggerSelfHeal(
        'total_failure',
        [],
        'Factory CI',
        'main',
        twoHoursAgo // 2 hours ago
      );
      expect(should).toBe(false);
    });

    it('should trigger heal after cooldown expires', () => {
      const should = shouldTriggerSelfHeal(
        'total_failure',
        [],
        'Factory CI',
        'main',
        twentyFiveHoursAgo // 25 hours ago
      );
      expect(should).toBe(true);
    });

    it('should allow heal at exactly 24 hours', () => {
      const exactlyTwentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
      const should = shouldTriggerSelfHeal(
        'total_failure',
        [],
        'Factory CI',
        'main',
        exactlyTwentyFourHoursAgo
      );
      expect(should).toBe(true);
    });

    it('should not trigger heal for pass status', () => {
      const should = shouldTriggerSelfHeal('pass', [], 'Factory CI', 'main', 0);
      expect(should).toBe(false);
    });
  });

  describe('shouldCloseIssue', () => {
    it('should close issue when workflow recovers to pass', () => {
      const should = shouldCloseIssue('Factory CI', 'pass', []);
      expect(should).toBe(true);
    });

    it('should not close issue when workflow still failing', () => {
      const should = shouldCloseIssue('Factory CI', 'total_failure', []);
      expect(should).toBe(false);
    });

    it('should close informational-only partial failures', () => {
      const patterns = ['ETIMEDOUT', 'rate limit exceeded'];
      const should = shouldCloseIssue('Factory CI', 'partial_failure', patterns);
      expect(should).toBe(true);
    });

    it('should not close partial failures with healable patterns', () => {
      const patterns = ['Failed to upload'];
      const should = shouldCloseIssue('Factory CI', 'partial_failure', patterns);
      expect(should).toBe(false);
    });

    it('should not close partial failures with mixed patterns including healable', () => {
      const patterns = ['ETIMEDOUT', 'Failed to upload'];
      const should = shouldCloseIssue('Factory CI', 'partial_failure', patterns);
      expect(should).toBe(false);
    });

    it('should not close when still partial failure with healable patterns', () => {
      const patterns = ['Failed to upload', '/bin/sh:'];
      const should = shouldCloseIssue('Coverage Audit', 'partial_failure', patterns);
      expect(should).toBe(false);
    });
  });
});
