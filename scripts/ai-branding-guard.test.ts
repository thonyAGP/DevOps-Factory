import { describe, it, expect } from 'vitest';
import {
  scanContent,
  fixContent,
  shouldScanFile,
  isSafeToDeleteLine,
  actionFor,
  summarizeError,
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

  it('should detect the inline marker', () => {
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

  it('should keep ambiguous inline wording for manual review', () => {
    const input = `This is an ${aiGen} doc with useful info\n`;
    const result = fixContent(input);
    expect(result).toBe(input);
  });

  it('should collapse the empty lines left around a removed line', () => {
    const input = `line1\n\n\n${createdBy}\n\n\nline2`;
    const result = fixContent(input);
    expect(result).not.toContain(createdBy);
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

describe('fixContent regression: never rewrite product text', () => {
  it('should leave an LLM guardrail sentence untouched when it contains the inline wording', () => {
    // CasaSync src/lib/ai/knowledge-base.ts:293 — the 2026-10-11 dry-run showed it rewritten
    const input = `  lines.push(\n    \`- Door codes are sent via secure automated messages only (never in ${aiGen} replies).\`,\n  )\n`;
    expect(fixContent(input)).toBe(input);
  });

  it('should leave a YAML description untouched when it contains the inline wording', () => {
    const input = `SuggestedReply:\n  description: "${aiGen} message suggestion (manual approval)"\n`;
    expect(fixContent(input)).toBe(input);
  });

  it('should not produce a whitespace-only change when every match is kept', () => {
    const input = `# ${aiGen} notes\n\n\n\n\nconst a = "${createdBy}";\n`;
    expect(fixContent(input)).toBe(input);
  });
});

describe('actionFor', () => {
  it('should report inline wording as kept for manual review', () => {
    expect(actionFor({ patternMode: 'inline', original: `${aiGen} docs` })).toContain(
      'manual review'
    );
  });

  it('should report a code line as kept for manual review', () => {
    expect(actionFor({ patternMode: 'line', original: `const m = "${createdBy}";` })).toContain(
      'code line'
    );
  });

  it('should report a pure attribution line as removed', () => {
    expect(actionFor({ patternMode: 'line', original: `# ${createdBy}` })).toBe('removed');
  });
});

describe('summarizeError', () => {
  it('should keep the command and the last stderr line', () => {
    const err = new Error('Command failed: git push\nremote: x\nerror: GH006: Protected branch');
    expect(summarizeError(err)).toBe('Command failed: git push — error: GH006: Protected branch');
  });

  it('should redact a token embedded in a remote URL', () => {
    const err = new Error('fatal: https://x-access-token:ghs_secret123@github.com/o/r.git');
    expect(summarizeError(err)).not.toContain('ghs_secret123');
    expect(summarizeError(err)).toContain('x-access-token:***@');
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
