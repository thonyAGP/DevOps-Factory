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

  it('should detect Generated with Claude', () => {
    const content = `Some content\n${generatedWith}\n`;
    const violations = scanContent(content, 'test.md');
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('should detect Created by Claude', () => {
    const content = `Some content\n${createdBy}\n`;
    const violations = scanContent(content, 'test.md');
    expect(violations.length).toBe(1);
  });

  it('should detect AI-generated inline', () => {
    const content = `This is an ${aiGen} response with useful content\n`;
    const violations = scanContent(content, 'test.md');
    expect(violations.length).toBe(1);
    expect(violations[0].patternMode).toBe('inline');
  });

  it('should not flag Claude Monet (false positive)', () => {
    const content = 'The painting by Claude Monet is beautiful\n';
    const violations = scanContent(content, 'test.md');
    expect(violations.length).toBe(0);
  });

  it('should not flag Claude Bernard (false positive)', () => {
    const content = 'Claude Bernard was a famous physiologist\n';
    const violations = scanContent(content, 'test.md');
    expect(violations.length).toBe(0);
  });

  it('should detect noreply@anthropic.com email', () => {
    const content = `Author: Bot <${noreplyEmail}>\n`;
    const violations = scanContent(content, 'test.ts');
    expect(violations.length).toBe(1);
  });

  it('should return empty for clean content', () => {
    const content = 'const x = 1;\nconst y = 2;\nexport { x, y };\n';
    const violations = scanContent(content, 'test.ts');
    expect(violations.length).toBe(0);
  });
});

describe('fixContent', () => {
  it('should remove full lines with Co-Authored-By', () => {
    const input = `Fix bug\n\n${coAuthor}\n`;
    const result = fixContent(input);
    expect(result).not.toContain('Co-Authored');
    expect(result).toContain('Fix bug');
  });

  it('should remove inline  but keep rest of line', () => {
    const input = `This is an ${aiGen} doc with useful info\n`;
    const result = fixContent(input);
    expect(result).not.toContain(aiGen);
    expect(result).toContain('This is an');
    expect(result).toContain('doc with useful info');
  });

  it('should collapse 3+ consecutive empty lines to 2', () => {
    const input = 'line1\n\n\n\n\nline2';
    const result = fixContent(input);
    expect(result).not.toContain('\n\n\n\n');
    expect(result).toContain('line1');
    expect(result).toContain('line2');
  });

  it('should handle multiple violations in same file', () => {
    const input = `some code\n${coAuthor}\nmore code\n${generatedWith}\nfinal code\n`;
    const result = fixContent(input);
    expect(result).not.toContain('Co-Authored');
    expect(result).not.toContain('Generated');
    expect(result).toContain('some code');
    expect(result).toContain('more code');
    expect(result).toContain('final code');
  });

  it('should not modify clean content', () => {
    const input = 'const x = 1;\nconst y = 2;\n';
    const result = fixContent(input);
    expect(result).toBe(input);
  });

  it('should handle empty content', () => {
    const result = fixContent('');
    expect(result).toBe('');
  });
});

describe('BRANDING_PATTERNS', () => {
  it('should have at least 5 patterns', () => {
    expect(BRANDING_PATTERNS.length).toBeGreaterThanOrEqual(5);
  });

  it('should have both line and inline modes', () => {
    const modes = new Set(BRANDING_PATTERNS.map((p) => p.mode));
    expect(modes.has('line')).toBe(true);
    expect(modes.has('inline')).toBe(true);
  });
});
