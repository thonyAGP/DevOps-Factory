import { describe, it, expect } from 'vitest';
import { scanContent, fixContent, shouldScanFile, BRANDING_PATTERNS } from './ai-branding-guard.js';

describe('shouldScanFile', () => {
  it('should scan TypeScript files', () => {
    expect(shouldScanFile('src/index.ts')).toBe(true);
    expect(shouldScanFile('README.md')).toBe(true);
    expect(shouldScanFile('.github/workflows/ci.yml')).toBe(true);
  });

  it('should skip node_modules', () => {
    expect(shouldScanFile('node_modules/express/package.json')).toBe(false);
  });

  it('should skip .git directory', () => {
    expect(shouldScanFile('.git/config')).toBe(false);
  });

  it('should skip CLAUDE.md', () => {
    expect(shouldScanFile('CLAUDE.md')).toBe(false);
  });

  it('should skip .claude directory', () => {
    expect(shouldScanFile('.claude/settings.json')).toBe(false);
  });

  it('should skip lock files', () => {
    expect(shouldScanFile('pnpm-lock.yaml')).toBe(false);
    expect(shouldScanFile('package-lock.json')).toBe(false);
  });

  it('should skip binary files', () => {
    expect(shouldScanFile('logo.png')).toBe(false);
    expect(shouldScanFile('fonts/inter.woff2')).toBe(false);
    expect(shouldScanFile('doc.pdf')).toBe(false);
  });
});

// Use string concat to prevent ai-branding-guard from stripping test fixtures
const coAuthor = 'Co-Authored' + '-By: Claude <noreply' + '@anthropic.com>';
const generatedWith = 'Generated' + ' with Claude';
const aiGen = 'AI' + '-generated';
const createdBy = 'Created' + ' by Claude';
const noreplyEmail = 'noreply' + '@anthropic.com';

describe('scanContent', () => {
  it('should detect Co-Authored-By Claude', () => {
    const content = `line1\nline2\n${coAuthor}\nline4\n`;
    const violations = scanContent(content, 'test.ts');
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0].line).toBe(3);
  });

  const content = `Some content\n${generatedWith}\n`;
  const violations = scanContent(content, 'test.md');
  expect(violations.length).toBeGreaterThanOrEqual(1);
});

// ... rest of the file remains the same