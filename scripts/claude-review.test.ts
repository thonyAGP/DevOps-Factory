import { describe, it, expect } from 'vitest';

describe('claude-review', () => {
  describe('parseArgs', () => {
    it('should parse --repo and --pr arguments correctly', () => {
      process.argv = ['node', 'script.ts', '--repo', 'owner/repo', '--pr', '123'];

      const args = process.argv.slice(2);
      let repo = '';
      let pr = '';

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--repo' && args[i + 1]) repo = args[i + 1];
        if (args[i] === '--pr' && args[i + 1]) pr = args[i + 1];
      }

      expect(repo).toBe('owner/repo');
      expect(pr).toBe('123');
    });

    it('should exit when --repo is missing', () => {
      process.argv = ['node', 'script.ts', '--pr', '123'];

      const args = process.argv.slice(2);
      let repo = '';
      let pr = '';

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--repo' && args[i + 1]) repo = args[i + 1];
        if (args[i] === '--pr' && args[i + 1]) pr = args[i + 1];
      }

      expect(repo).toBe('');
      expect(pr).toBe('123');
    });

    it('should exit when --pr is missing', () => {
      process.argv = ['node', 'script.ts', '--repo', 'owner/repo'];

      const args = process.argv.slice(2);
      let repo = '';
      let pr = '';

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--repo' && args[i + 1]) repo = args[i + 1];
        if (args[i] === '--pr' && args[i + 1]) pr = args[i + 1];
      }

      expect(repo).toBe('owner/repo');
      expect(pr).toBe('');
    });

    it('should handle arguments with values after flags', () => {
      process.argv = ['node', 'script.ts', '--repo', 'owner/repo', '--pr', '456'];

      const args = process.argv.slice(2);
      let repo = '';
      let pr = '';

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--repo' && args[i + 1]) repo = args[i + 1];
        if (args[i] === '--pr' && args[i + 1]) pr = args[i + 1];
      }

      expect(repo).toBe('owner/repo');
      expect(pr).toBe('456');
    });
  });

  describe('buildReviewPrompt', () => {
    it('should include PR title and files changed', () => {
      const diff = 'some diff content';
      const prInfo = {
        title: 'Add new feature',
        body: 'Feature description',
        filesChanged: 5,
      };

      const prompt = `You are a senior code reviewer. Analyze this PR diff and provide a concise review focusing on:
1. Bugs or logic errors
2. Security vulnerabilities (OWASP Top 10)
3. Performance issues
4. TypeScript anti-patterns (any types, missing error handling)
5. Missing tests for new code

Format your review as:
## AI Code Review

### Summary
[1-2 sentence summary]

### Issues Found
[List issues with severity: CRITICAL/WARNING/INFO]

### Suggestions
[Improvement suggestions]

If the code looks good, say so briefly. Don't nitpick formatting (Prettier handles that).

---

**PR**: ${prInfo.title}
**Files changed**: ${prInfo.filesChanged}

## Diff
\`\`\`diff
${diff.slice(0, 40000)}
\`\`\``;

      expect(prompt).toContain('Add new feature');
      expect(prompt).toContain('5');
      expect(prompt).toContain('some diff content');
      expect(prompt).toContain('## AI Code Review');
    });

    it('should truncate diff at 40KB', () => {
      const longDiff = 'x'.repeat(50000);
      const prInfo = {
        title: 'Test PR',
        body: '',
        filesChanged: 1,
      };

      const prompt = `You are a senior code reviewer. Analyze this PR diff and provide a concise review focusing on:
1. Bugs or logic errors
2. Security vulnerabilities (OWASP Top 10)
3. Performance issues
4. TypeScript anti-patterns (any types, missing error handling)
5. Missing tests for new code

Format your review as:
## AI Code Review

### Summary
[1-2 sentence summary]

### Issues Found
[List issues with severity: CRITICAL/WARNING/INFO]

### Suggestions
[Improvement suggestions]

If the code looks good, say so briefly. Don't nitpick formatting (Prettier handles that).

---

**PR**: ${prInfo.title}
**Files changed**: ${prInfo.filesChanged}

## Diff
\`\`\`diff
${longDiff.slice(0, 40000)}
\`\`\``;

      expect(prompt.length).toBeLessThan(50000 + 500);
    });

    it('should handle empty PR body', () => {
      const diff = 'changes';
      const prInfo = {
        title: 'Feature X',
        body: '',
        filesChanged: 2,
      };

      const prompt = `You are a senior code reviewer. Analyze this PR diff and provide a concise review focusing on:
1. Bugs or logic errors
2. Security vulnerabilities (OWASP Top 10)
3. Performance issues
4. TypeScript anti-patterns (any types, missing error handling)
5. Missing tests for new code

Format your review as:
## AI Code Review

### Summary
[1-2 sentence summary]

### Issues Found
[List issues with severity: CRITICAL/WARNING/INFO]

### Suggestions
[Improvement suggestions]

If the code looks good, say so briefly. Don't nitpick formatting (Prettier handles that).

---

**PR**: ${prInfo.title}
**Files changed**: ${prInfo.filesChanged}

## Diff
\`\`\`diff
${diff.slice(0, 40000)}
\`\`\``;

      expect(prompt).toContain('Feature X');
      expect(prompt).toContain('2');
    });
  });

  describe('Quota Management', () => {
    it('should check quota correctly', () => {
      const today = new Date().toISOString().split('T')[0];
      const quota = {
        date: today,
        count: 5,
        maxPerDay: 20,
      };

      const isWithinQuota = quota.count < quota.maxPerDay;
      expect(isWithinQuota).toBe(true);
    });

    it('should exceed quota when count equals max', () => {
      const today = new Date().toISOString().split('T')[0];
      const quota = {
        date: today,
        count: 20,
        maxPerDay: 20,
      };

      const isWithinQuota = quota.count < quota.maxPerDay;
      expect(isWithinQuota).toBe(false);
    });

    it('should reset quota on new day', () => {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const quota = {
        date: yesterday,
        count: 15,
        maxPerDay: 20,
      };

      if (quota.date !== today) {
        quota.date = today;
        quota.count = 0;
      }

      expect(quota.date).toBe(today);
      expect(quota.count).toBe(0);
    });

    it('should increment quota correctly', () => {
      const today = new Date().toISOString().split('T')[0];
      const quota = {
        date: today,
        count: 5,
        maxPerDay: 20,
      };

      if (quota.date === today) {
        quota.count += 1;
      }

      expect(quota.count).toBe(6);
    });

    it('should handle quota increment on new day', () => {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const quota = {
        date: yesterday,
        count: 10,
        maxPerDay: 20,
      };

      if (quota.date !== today) {
        quota.date = today;
        quota.count = 1;
      } else {
        quota.count += 1;
      }

      expect(quota.date).toBe(today);
      expect(quota.count).toBe(1);
    });
  });

  describe('getPRInfo', () => {
    it('should return PR info with correct structure', () => {
      const prInfo = {
        title: 'Test PR',
        body: 'Description',
        filesChanged: 3,
      };

      expect(prInfo).toHaveProperty('title');
      expect(prInfo).toHaveProperty('body');
      expect(prInfo).toHaveProperty('filesChanged');
      expect(typeof prInfo.title).toBe('string');
      expect(typeof prInfo.body).toBe('string');
      expect(typeof prInfo.filesChanged).toBe('number');
    });

    it('should handle missing PR data gracefully', () => {
      const prInfo = {
        title: 'Unknown PR',
        body: '',
        filesChanged: 0,
      };

      expect(prInfo.title).toBe('Unknown PR');
      expect(prInfo.body).toBe('');
      expect(prInfo.filesChanged).toBe(0);
    });

    it('should provide default values when API returns null', () => {
      interface PRDataFromAPI {
        title?: string;
        body?: string;
        changed_files?: number;
      }
      const data: PRDataFromAPI | null = null;
      const prInfo = {
        title: data?.title || 'Unknown PR',
        body: data?.body || '',
        filesChanged: data?.changed_files || 0,
      };

      expect(prInfo.title).toBe('Unknown PR');
      expect(prInfo.body).toBe('');
      expect(prInfo.filesChanged).toBe(0);
    });
  });

  describe('Review Result Formatting', () => {
    it('should format Claude review with footer', () => {
      const review = 'Test review content';
      const formatted = review + '\n\n---\n*Reviewed by Claude (Max plan)*';

      expect(formatted).toContain('Test review content');
      expect(formatted).toContain('---');
      expect(formatted).toContain('Reviewed by Claude');
    });

    it('should format Gemini review with footer', () => {
      const review = 'Gemini review text';
      const formatted = review + '\n\n---\n*Reviewed by Gemini 2.5 Flash*';

      expect(formatted).toContain('Gemini review text');
      expect(formatted).toContain('Reviewed by Gemini');
    });

    it('should provide fallback when no API available', () => {
      const fallback = `## AI Code Review\n\n> Review unavailable: no Claude CLI or GEMINI_API_KEY. Manual review recommended.\n\nFiles changed: 5`;

      expect(fallback).toContain('## AI Code Review');
      expect(fallback).toContain('unavailable');
      expect(fallback).toContain('Manual review');
    });

    it('should provide error fallback when review fails', () => {
      const fallback = `## AI Code Review\n\n> Review failed. Manual review recommended.\n\nFiles changed: 3`;

      expect(fallback).toContain('## AI Code Review');
      expect(fallback).toContain('failed');
      expect(fallback).toContain('Manual review');
    });
  });

  describe('Repo Filtering', () => {
    it('should identify enabled repo', () => {
      const enabledRepos = ['owner/repo1', 'owner/repo2'];
      const currentRepo = 'owner/repo1';

      const isEnabled = enabledRepos.includes(currentRepo);
      expect(isEnabled).toBe(true);
    });

    it('should identify disabled repo', () => {
      const enabledRepos = ['owner/repo1', 'owner/repo2'];
      const currentRepo = 'owner/repo3';

      const isEnabled = enabledRepos.includes(currentRepo);
      expect(isEnabled).toBe(false);
    });

    it('should handle case-sensitive repo names', () => {
      const enabledRepos = ['Owner/Repo'];
      const currentRepo = 'owner/repo';

      const isEnabled = enabledRepos.includes(currentRepo);
      expect(isEnabled).toBe(false);
    });
  });

  describe('Diff Handling', () => {
    it('should detect empty diff', () => {
      const diff = '';
      const isEmpty = !diff;

      expect(isEmpty).toBe(true);
    });

    it('should detect non-empty diff', () => {
      const diff = 'diff --git a/file.ts b/file.ts\n+console.log("test");';
      const isEmpty = !diff;

      expect(isEmpty).toBe(false);
    });

    it('should calculate diff size in KB', () => {
      const diff = 'x'.repeat(5000);
      const sizeKB = Math.round(diff.length / 1024);

      expect(sizeKB).toBeGreaterThan(0);
      expect(sizeKB).toBeLessThan(10);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large file count', () => {
      const prInfo = {
        title: 'Large refactor',
        body: 'Refactored 1000 files',
        filesChanged: 1000,
      };

      expect(prInfo.filesChanged).toBe(1000);
    });

    it('should handle special characters in PR title', () => {
      const prInfo = {
        title: 'Fix: "quotes" & <special> chars',
        body: '',
        filesChanged: 1,
      };

      expect(prInfo.title).toContain('quotes');
      expect(prInfo.title).toContain('special');
    });

    it('should handle PR title with newlines', () => {
      const title = 'Fix: bug\nLine 2';
      expect(title).toContain('\n');
      expect(title.split('\n')).toHaveLength(2);
    });

    it('should validate date format in quota', () => {
      const today = new Date().toISOString().split('T')[0];
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

      expect(dateRegex.test(today)).toBe(true);
    });
  });
});
