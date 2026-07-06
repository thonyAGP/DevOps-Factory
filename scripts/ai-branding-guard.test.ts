import { describe, it, expect } from 'vitest';
import {
  scanContent,
  fixContent,
  shouldScanFile,
  isSafeToDeleteLine,
  BRANDING_PATTERNS,
} from './ai-branding-guard.js';

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

  it('should detect the generated-with marker', () => {
    const content = `Some content\n${generatedWith}\n`;
    const violations = scanContent(content, 'test.md');
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('should detect the created-by marker', () => {
    const content = `Some content\n${createdBy}\n`;
    const violations = scanContent(content, 'test.md');
    expect(violations.length).toBe(1);
  });

  it('should detect  inline', () => {
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

  it('should flag the noreply email', () => {
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

describe('isSafeToDeleteLine', () => {
  it('treats pure attribution lines as safe', () => {
    expect(isSafeToDeleteLine(`Co-Authored-By: Bot <${noreplyEmail}>`)).toBe(true);
    expect(isSafeToDeleteLine(`# ${createdBy}`)).toBe(true);
    expect(
      isSafeToDeleteLine(
        `🤖 ${generatedWith.replace('Claude', '[Claude Code](https://example.com)')}`
      )
    ).toBe(true);
  });

  it('treats lines with code structure as unsafe', () => {
    expect(isSafeToDeleteLine(`  it('should detect ${generatedWith}', () => {`)).toBe(false);
    expect(isSafeToDeleteLine(`          ${generatedWith}"`)).toBe(false);
    expect(isSafeToDeleteLine(`const msg = "${createdBy}";`)).toBe(false);
  });
});

describe('fixContent regression: never break code by deleting lines', () => {
  it('preserves a test header line containing a banned phrase', () => {
    const input = `describe('x', () => {\n  it('should detect ${generatedWith}', () => {\n    expect(1).toBe(1);\n  });\n});\n`;
    const result = fixContent(input);
    expect(result).toContain(`it('should detect`);
    expect(result).toContain('expect(1).toBe(1);');
  });

  it('preserves a quoted shell/YAML line containing a banned phrase', () => {
    const input = `          git commit -m "fix: something\n\n          ${generatedWith}"\n\n          git push origin branch\n`;
    const result = fixContent(input);
    expect(result).toContain(`${generatedWith}"`);
    expect(result).toContain('git push origin branch');
  });

  it('still removes pure attribution lines', () => {
    const input = `Fix bug\n\nCo-Authored-By: Bot <${noreplyEmail}>\n# ${createdBy}\n`;
    const result = fixContent(input);
    expect(result).not.toContain('Co-Authored-By');
    expect(result).not.toContain(createdBy);
    expect(result).toContain('Fix bug');
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
