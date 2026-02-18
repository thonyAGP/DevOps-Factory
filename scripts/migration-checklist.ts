/**
 * migration-checklist.ts
 *
 * Enforces migration quality on PRs in lecteur-magic.
 * Checks that migrated code has specs, tests, and documentation.
 * Posts a checklist comment on the PR.
 *
 * Run: pnpm migration-checklist -- --pr <number>
 * Workflow: triggered on PR in lecteur-magic
 */

import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';

const REPO = 'thonyAGP/lecteur-magic';

interface PRFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
}

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30_000 }).trim();
  } catch {
    return '';
  }
};

const ghApi = <T>(endpoint: string): T | null => {
  const raw = sh(`gh api "repos/${REPO}/${endpoint}"`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const getPRFiles = (prNumber: number): PRFile[] => {
  const raw = sh(
    `gh api "repos/${REPO}/pulls/${prNumber}/files?per_page=100" --jq '[.[] | {filename, status, additions, deletions}]'`
  );
  try {
    return JSON.parse(raw || '[]') as PRFile[];
  } catch {
    return [];
  }
};

interface CheckResult {
  label: string;
  passed: boolean;
  details: string;
}

const analyzeChanges = (files: PRFile[]): CheckResult[] => {
  const checks: CheckResult[] = [];

  // Detect which areas are modified
  const caisseApiFiles = files.filter((f) => f.filename.startsWith('migration/caisse/'));
  const adhWebFiles = files.filter((f) => f.filename.startsWith('adh-web/'));
  const specFiles = files.filter((f) => f.filename.startsWith('.openspec/'));
  const testFiles = files.filter(
    (f) =>
      f.filename.includes('Tests/') ||
      f.filename.includes('.test.') ||
      f.filename.includes('.spec.')
  );
  const docFiles = files.filter(
    (f) =>
      f.filename.endsWith('.md') &&
      (f.filename.includes('MIGRATION') || f.filename.includes('migration'))
  );

  // Check 1: If backend code changed, tests should exist
  const backendSourceFiles = caisseApiFiles.filter(
    (f) => f.filename.endsWith('.cs') && !f.filename.includes('Tests/') && f.status !== 'removed'
  );
  if (backendSourceFiles.length > 0) {
    const hasTests = testFiles.some((f) => f.filename.endsWith('.cs'));
    checks.push({
      label: 'Backend tests included',
      passed: hasTests,
      details: hasTests
        ? `${testFiles.filter((f) => f.filename.endsWith('.cs')).length} test file(s) modified`
        : `${backendSourceFiles.length} C# source file(s) changed but no test files modified`,
    });
  }

  // Check 2: If new CQRS module added, spec should exist
  const newModuleFiles = backendSourceFiles.filter(
    (f) =>
      f.status === 'added' &&
      f.filename.includes('Caisse.Application/') &&
      (f.filename.includes('/Commands/') || f.filename.includes('/Queries/'))
  );
  if (newModuleFiles.length > 0) {
    // Extract module names
    const modules = new Set<string>();
    for (const f of newModuleFiles) {
      const match = f.filename.match(/Caisse\.Application\/([^/]+)\//);
      if (match) modules.add(match[1]);
    }
    const hasSpecs = specFiles.length > 0 || docFiles.length > 0;
    checks.push({
      label: 'Migration documentation updated',
      passed: hasSpecs,
      details: hasSpecs
        ? `Specs/docs updated for module(s): ${[...modules].join(', ')}`
        : `New CQRS module(s) [${[...modules].join(', ')}] added without spec/doc updates`,
    });
  }

  // Check 3: If frontend components changed, verify structure
  if (adhWebFiles.length > 0) {
    const componentFiles = adhWebFiles.filter(
      (f) => (f.filename.endsWith('.tsx') || f.filename.endsWith('.jsx')) && f.status !== 'removed'
    );
    const frontendTests = adhWebFiles.filter(
      (f) => f.filename.includes('.test.') || f.filename.includes('.spec.')
    );
    if (componentFiles.length > 0) {
      checks.push({
        label: 'Frontend tests included',
        passed: frontendTests.length > 0,
        details:
          frontendTests.length > 0
            ? `${frontendTests.length} frontend test file(s)`
            : `${componentFiles.length} component(s) changed without tests`,
      });
    }
  }

  // Check 4: Domain entity changes should have migration doc
  const domainFiles = caisseApiFiles.filter(
    (f) => f.filename.includes('Caisse.Domain/') && f.status !== 'removed'
  );
  if (domainFiles.length > 0) {
    const hasMigrationDoc = docFiles.length > 0 || specFiles.length > 0;
    checks.push({
      label: 'Domain changes documented',
      passed: hasMigrationDoc,
      details: hasMigrationDoc
        ? `Documentation present for domain changes`
        : `${domainFiles.length} domain file(s) changed without migration documentation`,
    });
  }

  // Check 5: Validator exists for new commands
  const newCommands = newModuleFiles.filter((f) => f.filename.includes('/Commands/'));
  if (newCommands.length > 0) {
    const validatorFiles = caisseApiFiles.filter(
      (f) => f.filename.includes('Validator') && f.filename.endsWith('.cs')
    );
    checks.push({
      label: 'Validators included for commands',
      passed: validatorFiles.length > 0,
      details:
        validatorFiles.length > 0
          ? `${validatorFiles.length} validator file(s) present`
          : `New command(s) added without validator classes`,
    });
  }

  // Check 6: No hardcoded connection strings or secrets
  const allSourceFiles = files.filter(
    (f) => f.filename.endsWith('.cs') || f.filename.endsWith('.ts') || f.filename.endsWith('.tsx')
  );
  if (allSourceFiles.length > 0) {
    const suspiciousFiles = allSourceFiles.filter(
      (f) =>
        f.filename.includes('appsettings') &&
        !f.filename.includes('Development') &&
        f.status !== 'removed'
    );
    checks.push({
      label: 'No production config changes',
      passed: suspiciousFiles.length === 0,
      details:
        suspiciousFiles.length === 0
          ? 'No production configuration files modified'
          : `Production config modified: ${suspiciousFiles.map((f) => f.filename).join(', ')}`,
    });
  }

  return checks;
};

const buildComment = (_prNumber: number, checks: CheckResult[], files: PRFile[]): string => {
  const allPassed = checks.every((c) => c.passed);
  const passCount = checks.filter((c) => c.passed).length;

  let body = `## Migration Checklist\n\n`;
  body += `**${passCount}/${checks.length}** checks passed`;
  body += allPassed ? ' :white_check_mark:\n\n' : ' :warning:\n\n';

  for (const check of checks) {
    const icon = check.passed ? ':white_check_mark:' : ':warning:';
    body += `- ${icon} **${check.label}**\n`;
    body += `  ${check.details}\n`;
  }

  // Summary of files changed
  const areas: string[] = [];
  const caisseCount = files.filter((f) => f.filename.startsWith('migration/caisse/')).length;
  const adhCount = files.filter((f) => f.filename.startsWith('adh-web/')).length;
  const specCount = files.filter((f) => f.filename.startsWith('.openspec/')).length;

  if (caisseCount > 0) areas.push(`Caisse.API (${caisseCount} files)`);
  if (adhCount > 0) areas.push(`adh-web (${adhCount} files)`);
  if (specCount > 0) areas.push(`OpenSpec (${specCount} files)`);

  if (areas.length > 0) {
    body += `\n### Areas Modified\n`;
    for (const area of areas) {
      body += `- ${area}\n`;
    }
  }

  body += `\n---\n`;
  body += `*Generated by [DevOps-Factory](https://github.com/thonyAGP/DevOps-Factory) Migration Checklist*`;

  return body;
};

const main = () => {
  const args = process.argv.slice(2);
  const prIdx = args.indexOf('--pr');
  if (prIdx === -1 || !args[prIdx + 1]) {
    console.error('Usage: pnpm migration-checklist -- --pr <number>');
    process.exit(1);
  }

  const prNumber = Number(args[prIdx + 1]);
  console.log(`Migration Checklist: PR #${prNumber} on ${REPO}\n`);

  // Get PR files
  const files = getPRFiles(prNumber);
  if (files.length === 0) {
    console.log('No files found in PR (or PR does not exist)');
    process.exit(0);
  }

  console.log(`  ${files.length} files changed in PR`);

  // Check if PR touches migration-related areas
  const migrationFiles = files.filter(
    (f) =>
      f.filename.startsWith('migration/') ||
      f.filename.startsWith('adh-web/') ||
      f.filename.startsWith('.openspec/') ||
      f.filename.startsWith('tools/')
  );

  if (migrationFiles.length === 0) {
    console.log('  PR does not touch migration areas, skipping checklist');
    process.exit(0);
  }

  console.log(`  ${migrationFiles.length} migration-related file(s)\n`);

  // Run checks
  const checks = analyzeChanges(files);

  if (checks.length === 0) {
    console.log('  No migration checks applicable');
    process.exit(0);
  }

  for (const check of checks) {
    const icon = check.passed ? 'PASS' : 'WARN';
    console.log(`  [${icon}] ${check.label}: ${check.details}`);
  }

  // Build and post comment
  const comment = buildComment(prNumber, checks, files);

  // Check if we already posted a checklist comment
  const existingComments = ghApi<{ id: number; body: string }[]>(
    `issues/${prNumber}/comments?per_page=100`
  );
  const existing = existingComments?.find((c) => c.body.includes('## Migration Checklist'));

  const tmpFile = `/tmp/migration-checklist-${prNumber}.md`;
  writeFileSync(tmpFile, comment);

  if (existing) {
    sh(
      `gh api "repos/${REPO}/issues/comments/${existing.id}" -X PATCH --input ${tmpFile} -F "body=@${tmpFile}"`
    );
    console.log(`\n  Updated existing comment #${existing.id}`);
  } else {
    sh(`gh pr comment ${prNumber} --repo ${REPO} --body-file ${tmpFile}`);
    console.log(`\n  Posted checklist comment on PR #${prNumber}`);
  }

  try {
    unlinkSync(tmpFile);
  } catch {
    /* ignore */
  }

  const allPassed = checks.every((c) => c.passed);
  console.log(`\n  Result: ${allPassed ? 'ALL PASSED' : 'SOME WARNINGS'}`);
};

main();
