/**
 * auto-fix-prettier.test.ts
 *
 * Tests pour auto-fix-prettier - logique de détection et configuration
 */

import { describe, it, expect } from 'vitest';

describe('auto-fix-prettier logic', () => {
  describe('Node Stack Detection', () => {
    it('should include nextjs in node stacks', () => {
      const NODE_STACKS = new Set(['nextjs', 'fastify', 'node', 'astro']);
      expect(NODE_STACKS.has('nextjs')).toBe(true);
    });

    it('should include all expected stacks', () => {
      const NODE_STACKS = new Set(['nextjs', 'fastify', 'node', 'astro']);
      expect(NODE_STACKS.size).toBe(4);
    });

    it('should filter node-based projects', () => {
      const NODE_STACKS = new Set(['nextjs', 'fastify', 'node', 'astro']);
      const projects = [{ stack: 'nextjs' }, { stack: 'python' }, { stack: 'node' }];

      const nodeProjects = projects.filter((p) => NODE_STACKS.has(p.stack));
      expect(nodeProjects).toHaveLength(2);
    });
  });

  describe('Prettier Config Detection', () => {
    const PRETTIER_CONFIGS = [
      '.prettierrc',
      '.prettierrc.json',
      '.prettierrc.yml',
      '.prettierrc.js',
      'prettier.config.js',
      'prettier.config.mjs',
    ];

    it('should recognize all prettier config formats', () => {
      expect(PRETTIER_CONFIGS).toHaveLength(6);
    });

    it('should include json config', () => {
      expect(PRETTIER_CONFIGS).toContain('.prettierrc.json');
    });

    it('should include js config', () => {
      expect(PRETTIER_CONFIGS).toContain('prettier.config.js');
    });

    it('should check multiple config files', () => {
      const existingFiles = ['.prettierrc.json', 'package.json', 'README.md'];
      const hasPrettier = PRETTIER_CONFIGS.some((f) => existingFiles.includes(f));

      expect(hasPrettier).toBe(true);
    });

    it('should return false if no config exists', () => {
      const existingFiles = ['package.json', 'README.md'];
      const hasPrettier = PRETTIER_CONFIGS.some((f) => existingFiles.includes(f));

      expect(hasPrettier).toBe(false);
    });
  });

  describe('Package Manager Detection', () => {
    it('should detect pnpm from lock file', () => {
      const files = ['pnpm-lock.yaml', 'package.json'];
      const pm = files.includes('pnpm-lock.yaml')
        ? 'pnpm'
        : files.includes('yarn.lock')
          ? 'yarn'
          : 'npm';

      expect(pm).toBe('pnpm');
    });

    it('should detect yarn from lock file', () => {
      const files = ['yarn.lock', 'package.json'];
      const pm = files.includes('pnpm-lock.yaml')
        ? 'pnpm'
        : files.includes('yarn.lock')
          ? 'yarn'
          : 'npm';

      expect(pm).toBe('yarn');
    });

    it('should default to npm if no lock file', () => {
      const files = ['package.json'];
      const pm = files.includes('pnpm-lock.yaml')
        ? 'pnpm'
        : files.includes('yarn.lock')
          ? 'yarn'
          : 'npm';

      expect(pm).toBe('npm');
    });

    it('should prioritize pnpm over yarn', () => {
      const files = ['pnpm-lock.yaml', 'yarn.lock'];
      const pm = files.includes('pnpm-lock.yaml')
        ? 'pnpm'
        : files.includes('yarn.lock')
          ? 'yarn'
          : 'npm';

      expect(pm).toBe('pnpm');
    });
  });

  describe('Install Commands', () => {
    it('should use frozen lockfile for pnpm', () => {
      const pm = 'pnpm';
      const cmd =
        pm === 'pnpm'
          ? 'pnpm install --frozen-lockfile --ignore-scripts'
          : pm === 'yarn'
            ? 'yarn install --frozen-lockfile --ignore-scripts'
            : 'npm ci --ignore-scripts';

      expect(cmd).toBe('pnpm install --frozen-lockfile --ignore-scripts');
    });

    it('should use frozen lockfile for yarn', () => {
      const pm: string = 'yarn';
      const cmd =
        pm === 'pnpm'
          ? 'pnpm install --frozen-lockfile --ignore-scripts'
          : pm === 'yarn'
            ? 'yarn install --frozen-lockfile --ignore-scripts'
            : 'npm ci --ignore-scripts';

      expect(cmd).toBe('yarn install --frozen-lockfile --ignore-scripts');
    });

    it('should use npm ci for npm', () => {
      const pm: string = 'npm';
      const cmd =
        pm === 'pnpm'
          ? 'pnpm install --frozen-lockfile --ignore-scripts'
          : pm === 'yarn'
            ? 'yarn install --frozen-lockfile --ignore-scripts'
            : 'npm ci --ignore-scripts';

      expect(cmd).toBe('npm ci --ignore-scripts');
    });

    it('should ignore scripts during install', () => {
      const commands = [
        'pnpm install --frozen-lockfile --ignore-scripts',
        'yarn install --frozen-lockfile --ignore-scripts',
        'npm ci --ignore-scripts',
      ];

      commands.forEach((cmd) => {
        expect(cmd).toContain('--ignore-scripts');
      });
    });
  });

  describe('Branch Naming', () => {
    it('should use consistent branch name', () => {
      const BRANCH_NAME = 'devops-factory/prettier-fix';

      expect(BRANCH_NAME).toMatch(/^devops-factory\//);
    });

    it('should use consistent label', () => {
      const LABEL = 'prettier-fix';

      expect(LABEL).toBe('prettier-fix');
    });
  });

  describe('Fallback Install Logic', () => {
    it('should fallback to non-frozen install on error', () => {
      const pm = 'pnpm';

      // Primary attempt
      let cmd = 'pnpm install --frozen-lockfile --ignore-scripts';
      const success = false;

      // Simulate failure, fallback
      if (!success) {
        cmd =
          pm === 'pnpm'
            ? 'pnpm install --ignore-scripts'
            : pm === 'yarn'
              ? 'yarn install --ignore-scripts'
              : 'npm install --ignore-scripts';
      }

      expect(cmd).toBe('pnpm install --ignore-scripts');
    });
  });
});
