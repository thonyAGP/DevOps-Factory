import { describe, it, expect } from 'vitest';
import { buildGraphQLQuery, parseGraphQLResponse } from './github-file-checker.js';

describe('github-file-checker', () => {
  describe('buildGraphQLQuery', () => {
    it('should build query with aliases for each path', () => {
      const query = buildGraphQLQuery('thonyAGP', 'MyRepo', ['package.json', '.husky/pre-commit']);

      expect(query).toContain('repository(owner: "thonyAGP", name: "MyRepo")');
      expect(query).toContain('f0: object(expression: "HEAD:package.json")');
      expect(query).toContain('f1: object(expression: "HEAD:.husky/pre-commit")');
      expect(query).toContain('byteSize');
    });

    it('should handle single path', () => {
      const query = buildGraphQLQuery('owner', 'repo', ['README.md']);

      expect(query).toContain('f0: object(expression: "HEAD:README.md")');
      expect(query).not.toContain('f1:');
    });

    it('should handle nested paths', () => {
      const query = buildGraphQLQuery('owner', 'repo', [
        '.github/workflows/ci.yml',
        '.devcontainer/devcontainer.json',
      ]);

      expect(query).toContain('HEAD:.github/workflows/ci.yml');
      expect(query).toContain('HEAD:.devcontainer/devcontainer.json');
    });
  });

  describe('parseGraphQLResponse', () => {
    it('should parse existing files as true', () => {
      const response = JSON.stringify({
        data: {
          repository: {
            f0: { byteSize: 1234 },
            f1: { byteSize: 56 },
          },
        },
      });

      const results = parseGraphQLResponse(response, ['package.json', '.husky/pre-commit']);

      expect(results.get('package.json')).toBe(true);
      expect(results.get('.husky/pre-commit')).toBe(true);
    });

    it('should parse missing files as false (null fields)', () => {
      const response = JSON.stringify({
        data: {
          repository: {
            f0: { byteSize: 1234 },
            f1: null,
          },
        },
      });

      const results = parseGraphQLResponse(response, ['package.json', 'yarn.lock']);

      expect(results.get('package.json')).toBe(true);
      expect(results.get('yarn.lock')).toBe(false);
    });

    it('should handle all files missing', () => {
      const response = JSON.stringify({
        data: {
          repository: {
            f0: null,
            f1: null,
            f2: null,
          },
        },
      });

      const paths = ['a.txt', 'b.txt', 'c.txt'];
      const results = parseGraphQLResponse(response, paths);

      for (const p of paths) {
        expect(results.get(p)).toBe(false);
      }
    });

    it('should handle invalid JSON gracefully', () => {
      const results = parseGraphQLResponse('not json', ['package.json']);

      expect(results.get('package.json')).toBe(false);
    });

    it('should handle empty repository response', () => {
      const response = JSON.stringify({
        data: {
          repository: {},
        },
      });

      const results = parseGraphQLResponse(response, ['package.json']);

      expect(results.get('package.json')).toBe(false);
    });

    it('should handle missing data field', () => {
      const response = JSON.stringify({ errors: [{ message: 'Not found' }] });

      const results = parseGraphQLResponse(response, ['package.json']);

      expect(results.get('package.json')).toBe(false);
    });
  });
});
