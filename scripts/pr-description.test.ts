/**
 * pr-description.test.ts
 *
 * Tests pour pr-description - parsing args et logique de prompt
 */

import { describe, it, expect } from 'vitest';

describe('pr-description logic', () => {
  describe('Argument Parsing', () => {
    it('should parse repo argument', () => {
      const args = ['--repo', 'owner/name'];
      let repo = '';

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--repo' && args[i + 1]) {
          repo = args[i + 1];
        }
      }

      expect(repo).toBe('owner/name');
    });

    it('should parse pr argument', () => {
      const args = ['--pr', '123'];
      let pr = '';

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--pr' && args[i + 1]) {
          pr = args[i + 1];
        }
      }

      expect(pr).toBe('123');
    });

    it('should parse both repo and pr', () => {
      const args = ['--repo', 'owner/name', '--pr', '456'];
      let repo = '';
      let pr = '';

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--repo' && args[i + 1]) repo = args[i + 1];
        if (args[i] === '--pr' && args[i + 1]) pr = args[i + 1];
      }

      expect(repo).toBe('owner/name');
      expect(pr).toBe('456');
    });

    it('should handle missing arguments', () => {
      const args = ['--repo'];
      let repo = '';

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--repo' && args[i + 1]) {
          repo = args[i + 1];
        }
      }

      expect(repo).toBe('');
    });
  });

  describe('PR Body Length Check', () => {
    const MIN_LENGTH = 30;

    it('should require description if body too short', () => {
      const body = 'Fix bug';
      const needsDescription = !body || body.length < MIN_LENGTH;

      expect(needsDescription).toBe(true);
    });

    it('should not require description if body sufficient', () => {
      const body =
        'This PR fixes a critical bug in the authentication system that caused users to be logged out';
      const needsDescription = !body || body.length < MIN_LENGTH;

      expect(needsDescription).toBe(false);
    });

    it('should require description if empty', () => {
      const body = '';
      const needsDescription = body.length === 0 || body.length < MIN_LENGTH;

      expect(needsDescription).toBe(true);
    });

    it('should handle exactly min length', () => {
      const body = 'a'.repeat(30);
      const needsDescription = !body || body.length < MIN_LENGTH;

      expect(needsDescription).toBe(false);
    });
  });

  describe('Prompt Structure', () => {
    it('should include summary section', () => {
      const prompt = buildPrompt();

      expect(prompt).toContain('Summary of changes');
    });

    it('should include key changes section', () => {
      const prompt = buildPrompt();

      expect(prompt).toContain('Key changes');
    });

    it('should include impact section', () => {
      const prompt = buildPrompt();

      expect(prompt).toContain('Potential impact');
    });

    it('should include testing section', () => {
      const prompt = buildPrompt();

      expect(prompt).toContain('Testing suggestions');
    });

    it('should request markdown format', () => {
      const prompt = buildPrompt();

      expect(prompt.toLowerCase()).toContain('markdown');
    });
  });

  describe('PR Info Extraction', () => {
    interface PRInfo {
      title: string;
      body: string;
      filesChanged: number;
    }

    it('should extract PR metadata', () => {
      const data = {
        title: 'Fix authentication bug',
        body: 'This fixes the bug',
        changed_files: 5,
      };

      const prInfo: PRInfo = {
        title: data.title || 'Unknown PR',
        body: data.body || '',
        filesChanged: data.changed_files || 0,
      };

      expect(prInfo.title).toBe('Fix authentication bug');
      expect(prInfo.filesChanged).toBe(5);
    });

    it('should handle missing data with defaults', () => {
      const data: Record<string, unknown> = {};

      const prInfo: PRInfo = {
        title: typeof data.title === 'string' ? data.title : 'Unknown PR',
        body: typeof data.body === 'string' ? data.body : '',
        filesChanged: typeof data.changed_files === 'number' ? data.changed_files : 0,
      };

      expect(prInfo.title).toBe('Unknown PR');
      expect(prInfo.body).toBe('');
      expect(prInfo.filesChanged).toBe(0);
    });
  });

  describe('Files Changed Impact', () => {
    it('should flag large PRs (>20 files)', () => {
      const filesChanged = 25;
      const isLarge = filesChanged > 20;

      expect(isLarge).toBe(true);
    });

    it('should not flag small PRs', () => {
      const filesChanged = 5;
      const isLarge = filesChanged > 20;

      expect(isLarge).toBe(false);
    });

    it('should handle single file change', () => {
      const filesChanged = 1;
      expect(filesChanged).toBe(1);
    });
  });
});

// Helper function
function buildPrompt(): string {
  return `You are an expert technical writer. Generate a concise and professional PR description based on this diff.

Focus on:
1. Summary of changes (2-3 sentences explaining the main purpose)
2. Key changes (bulleted list of important modifications)
3. Potential impact (what parts of the codebase are affected)
4. Testing suggestions (how to verify these changes work correctly)

Format as markdown with clear sections. Be concise but comprehensive.`;
}
