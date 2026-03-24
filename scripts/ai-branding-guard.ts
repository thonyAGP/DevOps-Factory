/**
 * ai-branding-guard.ts
 *
 * Scans all repos for AI branding/attribution and removes it automatically.
 * Pushes fixes directly to the default branch.
 *
 * Run: pnpm ai-branding-guard
 * Cron: daily at 3h UTC via GitHub Actions
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { KNOWN_PROJECTS } from '../factory.config.js';
import { tmpDir } from './shell-utils.js';
import { logActivity } from './activity-logger.js';

export interface BrandingPattern {
  regex: RegExp;
  mode: 'line' | 'inline';
}

export const BRANDING_PATTERNS: BrandingPattern[] = [
  { regex: /^.*Co-Authored-By:.*(?:Claude|Anthropic|noreply@anthropic\.com).*$/gim, mode: 'line' },
  { regex: /^.*Generated (?:with|by).*(?:Claude|AI|Anthropic).*$/gim, mode: 'line' },
  { regex: /^.*Powered by.*(?:Claude|Anthropic).*$/gim, mode: 'line' },
  { regex: /^.*Built with.*Claude.*$/gim, mode: 'line' },
  { regex: /^.*🤖.*Claude Code.*$/gim, mode: 'line' },
  { regex: /^.*noreply@anthropic\.com.*$/gim, mode: 'line' },
  { regex: /^.*anthropic\.com\/claude-code.*$/gim, mode: 'line' },
  { regex: /^.*Made with.*Claude.*$/gim, mode: 'line' },
  { regex: /^.*Created (?:with|by).*Claude.*$/gim, mode: 'line' },
  { regex: /AI[- ]generated/gi, mode: 'inline' },
];

const IGNORED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.svg',
  '.webp',
  '.avif',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.zip',
  '.tar',
  '.gz',
  '.br',
  '.pdf',
  '.doc',
  '.docx',
  '.mp3',
  '.mp4',
  '.wav',
  '.webm',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
]);

const IGNORED_FILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'CLAUDE.md',
]);

const IGNORED_DIRS = new Set(['node_modules', '.git', '.claude', '.next', 'dist', '.output']);

export const shouldScanFile = (relativePath: string): boolean => {
  const parts = relativePath.split('/');
  if (parts.some((p) => IGNORED_DIRS.has(p))) return false;

  const filename = parts[parts.length - 1];
  if (IGNORED_FILES.has(filename)) return false;

  const ext = extname(filename).toLowerCase();
  if (IGNORED_EXTENSIONS.has(ext)) return false;

  return true;
};

export interface Violation {
  file: string;
  line: number;
  original: string;
  patternMode: 'line' | 'inline';
}

export const scanContent = (content: string, filePath: string): Violation[] => {
  const violations: Violation[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    for (const pattern of BRANDING_PATTERNS) {
      // Reset regex state
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(lines[i])) {
        violations.push({
          file: filePath,
          line: i + 1,
          original: lines[i].trim(),
          patternMode: pattern.mode,
        });
        break; // One violation per line is enough
      }
    }
  }

  return violations;
};

export const fixContent = (content: string): string => {
  let lines = content.split('\n');

  // Pass 1: Remove full lines matching 'line' patterns
  lines = lines.filter((line) => {
    for (const pattern of BRANDING_PATTERNS) {
      if (pattern.mode !== 'line') continue;
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(line)) return false;
    }
    return true;
  });

  // Pass 2: Inline removals
  lines = lines.map((line) => {
    let result = line;
    for (const pattern of BRANDING_PATTERNS) {
      if (pattern.mode !== 'inline') continue;
      pattern.regex.lastIndex = 0;
      result = result.replace(pattern.regex, '');
    }
    return result;
  });

  // Pass 3: Collapse 3+ consecutive empty lines to 2
  const cleaned: string[] = [];
  let emptyCount = 0;
  for (const line of lines) {
    if (line.trim() === '') {
      emptyCount++;
      if (emptyCount <= 2) cleaned.push(line);
    } else {
      emptyCount = 0;
      cleaned.push(line);
    }
  }

  return cleaned.join('\n');
};

const getAllFiles = (dir: string, base = ''): string[] => {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const relativePath = base ? `${base}/${entry}` : entry;
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          if (!IGNORED_DIRS.has(entry)) {
            results.push(...getAllFiles(fullPath, relativePath));
          }
        } else if (stat.isFile() && shouldScanFile(relativePath)) {
          results.push(relativePath);
        }
      } catch {
        // Skip files we can't stat
      }
    }
  } catch {
    // Skip dirs we can't read
  }
  return results;
};

const processRepo = (repo: string): { violations: number; fixed: boolean } => {
  const workDir = `${tmpDir}/branding-guard-${Date.now()}`.replace(/\\/g, '/');

  try {
    execSync(`gh repo clone ${repo} "${workDir}" -- --depth 1`, {
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: 'pipe',
    });
  } catch {
    console.log(`  [ERROR] Failed to clone ${repo}`);
    return { violations: 0, fixed: false };
  }

  try {
    const files = getAllFiles(workDir);
    let totalViolations = 0;
    const fixedFiles: string[] = [];

    for (const file of files) {
      const fullPath = join(workDir, file);
      try {
        const content = readFileSync(fullPath, 'utf-8');
        const violations = scanContent(content, file);

        if (violations.length > 0) {
          totalViolations += violations.length;
          const fixed = fixContent(content);
          writeFileSync(fullPath, fixed);
          fixedFiles.push(file);

          for (const v of violations) {
            console.log(`  - ${v.file}:${v.line} → removed "${v.original.slice(0, 80)}"`);
          }
        }
      } catch {
        // Skip files we can't read (binary detection failure)
      }
    }

    if (fixedFiles.length === 0) {
      return { violations: 0, fixed: false };
    }

    // Configure git auth and push
    const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
    if (ghToken) {
      execSync(
        `git remote set-url origin https://x-access-token:${ghToken}@github.com/${repo}.git`,
        { cwd: workDir, encoding: 'utf-8', stdio: 'pipe' }
      );
    }

    execSync('git add -A', { cwd: workDir, encoding: 'utf-8', stdio: 'pipe' });

    const diff = execSync('git diff --cached --name-only', {
      cwd: workDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    if (!diff) {
      return { violations: totalViolations, fixed: false };
    }

    execSync('git commit -m "chore: remove AI branding"', {
      cwd: workDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    execSync('git push', {
      cwd: workDir,
      encoding: 'utf-8',
      timeout: 60_000,
      stdio: 'pipe',
    });

    console.log(`  → Committed & pushed: chore: remove AI branding`);
    return { violations: totalViolations, fixed: true };
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // Cleanup best-effort
    }
  }
};

const main = () => {
  console.log('=== AI Branding Guard ===');

  const projects = KNOWN_PROJECTS.filter((p) => !p.hidden && p.healingState !== 'paused');
  console.log(`Scanning ${projects.length} repos...\n`);

  let totalFixes = 0;
  let reposFixed = 0;
  let reposClean = 0;

  for (const project of projects) {
    process.stdout.write(`${project.name}... `);
    const result = processRepo(project.repo);

    if (result.fixed) {
      console.log(`✗ ${result.violations} violations → FIXED`);
      totalFixes += result.violations;
      reposFixed++;
      logActivity(
        'scan-and-configure',
        'branding-fix',
        `Removed ${result.violations} AI branding violations`,
        'success',
        project.name
      );
    } else if (result.violations > 0) {
      console.log(`⚠ ${result.violations} violations (push failed)`);
    } else {
      console.log('✓ clean');
      reposClean++;
    }
  }

  console.log(`\nSummary: ${totalFixes} fixes in ${reposFixed} repo(s), ${reposClean} clean`);
  logActivity(
    'scan-and-configure',
    'branding-guard-complete',
    `${totalFixes} fixes in ${reposFixed} repos, ${reposClean} clean`,
    totalFixes > 0 ? 'warning' : 'success'
  );
};

main();
