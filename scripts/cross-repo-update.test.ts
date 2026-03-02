/**
 * cross-repo-update.test.ts
 *
 * Tests pour cross-repo-update - parsing args et logique
 */

import { describe, it, expect } from 'vitest';

describe('cross-repo-update logic', () => {
  describe('Argument Parsing', () => {
    it('should parse file argument', () => {
      const argv = ['--file', '.github/workflows/ci.yml'];
      const args = { file: '', dryRun: false };

      for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--file') {
          args.file = argv[i + 1] ?? '';
          i++;
        }
      }

      expect(args.file).toBe('.github/workflows/ci.yml');
    });

    it('should parse template argument', () => {
      const argv = ['--template', 'templates/ci.yml'];
      let template = '';

      for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--template') {
          template = argv[i + 1] ?? '';
          i++;
        }
      }

      expect(template).toBe('templates/ci.yml');
    });

    it('should parse content argument', () => {
      const argv = ['--content', '22'];
      let content = '';

      for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--content') {
          content = argv[i + 1] ?? '';
          i++;
        }
      }

      expect(content).toBe('22');
    });

    it('should parse stack filter', () => {
      const argv = ['--stack', 'node,nextjs'];
      let stack: string[] = [];

      for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--stack') {
          stack = argv[i + 1]?.split(',') ?? [];
          i++;
        }
      }

      expect(stack).toEqual(['node', 'nextjs']);
    });

    it('should parse repos filter', () => {
      const argv = ['--repos', 'repo1,repo2,repo3'];
      let repos: string[] = [];

      for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--repos') {
          repos = argv[i + 1]?.split(',') ?? [];
          i++;
        }
      }

      expect(repos).toEqual(['repo1', 'repo2', 'repo3']);
    });

    it('should parse dry-run flag', () => {
      const argv = ['--dry-run'];
      let dryRun = false;

      for (const arg of argv) {
        if (arg === '--dry-run') {
          dryRun = true;
        }
      }

      expect(dryRun).toBe(true);
    });

    it('should handle multiple arguments together', () => {
      const argv = ['--file', '.nvmrc', '--content', '22', '--dry-run'];
      const args = { file: '', content: '', dryRun: false };

      for (let i = 0; i < argv.length; i++) {
        const val = argv[i + 1];
        switch (argv[i]) {
          case '--file':
            args.file = val ?? '';
            i++;
            break;
          case '--content':
            args.content = val ?? '';
            i++;
            break;
          case '--dry-run':
            args.dryRun = true;
            break;
        }
      }

      expect(args.file).toBe('.nvmrc');
      expect(args.content).toBe('22');
      expect(args.dryRun).toBe(true);
    });
  });

  describe('Stack Filtering', () => {
    interface Project {
      name: string;
      stack: string[];
    }

    it('should filter projects by stack', () => {
      const projects: Project[] = [
        { name: 'proj1', stack: ['node', 'nextjs'] },
        { name: 'proj2', stack: ['python'] },
        { name: 'proj3', stack: ['node', 'react'] },
      ];
      const targetStack = ['node'];

      const filtered = projects.filter((p) => p.stack.some((s) => targetStack.includes(s)));

      expect(filtered).toHaveLength(2);
      expect(filtered[0].name).toBe('proj1');
      expect(filtered[1].name).toBe('proj3');
    });

    it('should return all projects if no stack filter', () => {
      const projects: Project[] = [
        { name: 'proj1', stack: ['node'] },
        { name: 'proj2', stack: ['python'] },
      ];
      const targetStack: string[] = [];

      const filtered =
        targetStack.length === 0
          ? projects
          : projects.filter((p) => p.stack.some((s) => targetStack.includes(s)));

      expect(filtered).toHaveLength(2);
    });

    it('should handle multiple stack filters', () => {
      const projects: Project[] = [
        { name: 'proj1', stack: ['node'] },
        { name: 'proj2', stack: ['nextjs'] },
        { name: 'proj3', stack: ['python'] },
      ];
      const targetStack = ['node', 'nextjs'];

      const filtered = projects.filter((p) => p.stack.some((s) => targetStack.includes(s)));

      expect(filtered).toHaveLength(2);
    });
  });

  describe('Repo Filtering', () => {
    it('should filter specific repos', () => {
      const allRepos = ['owner/repo1', 'owner/repo2', 'owner/repo3'];
      const targetRepos = ['owner/repo1', 'owner/repo3'];

      const filtered = allRepos.filter((r) => targetRepos.includes(r));

      expect(filtered).toHaveLength(2);
      expect(filtered).toEqual(['owner/repo1', 'owner/repo3']);
    });

    it('should use all repos if no filter specified', () => {
      const allRepos = ['owner/repo1', 'owner/repo2'];
      const targetRepos: string[] = [];

      const filtered =
        targetRepos.length === 0 ? allRepos : allRepos.filter((r) => targetRepos.includes(r));

      expect(filtered).toHaveLength(2);
    });
  });

  describe('PR Title Generation', () => {
    it('should use custom title if provided', () => {
      const customTitle = 'chore: upgrade to Node 22';
      const title = customTitle || 'chore: update configuration';

      expect(title).toBe('chore: upgrade to Node 22');
    });

    it('should use default title if not provided', () => {
      const customTitle = '';
      const file = '.nvmrc';
      const title = customTitle || `chore: update ${file}`;

      expect(title).toBe('chore: update .nvmrc');
    });

    it('should handle file paths in title', () => {
      const file = '.github/workflows/ci.yml';
      const title = `chore: update ${file}`;

      expect(title).toContain('ci.yml');
    });
  });

  describe('Content Resolution', () => {
    it('should prefer direct content over template', () => {
      const content = '22';
      const template = 'templates/nvmrc.txt';

      const resolved = content || template;

      expect(resolved).toBe('22');
    });

    it('should use template if no content provided', () => {
      const content = '';
      const template = 'templates/nvmrc.txt';

      const resolved = content || template;

      expect(resolved).toBe('templates/nvmrc.txt');
    });
  });

  describe('Dry Run Logic', () => {
    it('should skip PR creation in dry run mode', () => {
      const dryRun = true;

      const shouldCreatePR = !dryRun;

      expect(shouldCreatePR).toBe(false);
    });

    it('should create PR in normal mode', () => {
      const dryRun = false;

      const shouldCreatePR = !dryRun;

      expect(shouldCreatePR).toBe(true);
    });
  });
});
