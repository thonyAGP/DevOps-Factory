/**
 * migration-checklist.test.ts
 *
 * Unit tests for migration-checklist.ts
 * Tests the analyzeChanges and buildComment functions
 */

import { describe, it, expect } from 'vitest';

interface PRFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
}

interface CheckResult {
  label: string;
  passed: boolean;
  details: string;
}

// Pure functions extracted from migration-checklist.ts for testing
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
    (f) =>
      f.filename.endsWith('.cs') ||
      f.filename.endsWith('.ts') ||
      f.filename.endsWith('.tsx') ||
      f.filename.endsWith('.json')
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

describe('migration-checklist', () => {
  describe('analyzeChanges', () => {
    it('should return empty array for non-migration files', () => {
      const files: PRFile[] = [
        {
          filename: 'README.md',
          status: 'modified',
          additions: 5,
          deletions: 2,
        },
      ];
      const checks = analyzeChanges(files);
      expect(checks).toEqual([]);
    });

    it('should flag missing tests for backend source changes', () => {
      const files: PRFile[] = [
        {
          filename: 'migration/caisse/src/Caisse.Application/Orders/Commands/CreateOrder.cs',
          status: 'added',
          additions: 50,
          deletions: 0,
        },
      ];
      const checks = analyzeChanges(files);
      expect(checks).toContainEqual({
        label: 'Backend tests included',
        passed: false,
        details: '1 C# source file(s) changed but no test files modified',
      });
    });

    it('should pass backend tests check when test files exist', () => {
      const files: PRFile[] = [
        {
          filename: 'migration/caisse/src/Caisse.Application/Orders/Commands/CreateOrder.cs',
          status: 'added',
          additions: 50,
          deletions: 0,
        },
        {
          filename: 'migration/caisse/src/Caisse.Application/Orders/Commands/CreateOrder.test.cs',
          status: 'added',
          additions: 100,
          deletions: 0,
        },
      ];
      const checks = analyzeChanges(files);
      const testCheck = checks.find((c) => c.label === 'Backend tests included');
      expect(testCheck?.passed).toBe(true);
    });

    it('should flag missing documentation for new CQRS modules', () => {
      const files: PRFile[] = [
        {
          filename: 'migration/caisse/src/Caisse.Application/Orders/Commands/CreateOrder.cs',
          status: 'added',
          additions: 50,
          deletions: 0,
        },
      ];
      const checks = analyzeChanges(files);
      const docCheck = checks.find((c) => c.label === 'Migration documentation updated');
      expect(docCheck?.passed).toBe(false);
    });

    it('should pass documentation check when spec files exist', () => {
      const files: PRFile[] = [
        {
          filename: 'migration/caisse/src/Caisse.Application/Orders/Commands/CreateOrder.cs',
          status: 'added',
          additions: 50,
          deletions: 0,
        },
        {
          filename: '.openspec/specs/orders-migration.md',
          status: 'added',
          additions: 30,
          deletions: 0,
        },
      ];
      const checks = analyzeChanges(files);
      const docCheck = checks.find((c) => c.label === 'Migration documentation updated');
      expect(docCheck?.passed).toBe(true);
    });

    it('should check frontend component tests', () => {
      const files: PRFile[] = [
        {
          filename: 'adh-web/src/components/OrderForm.tsx',
          status: 'added',
          additions: 80,
          deletions: 0,
        },
      ];
      const checks = analyzeChanges(files);
      const frontendCheck = checks.find((c) => c.label === 'Frontend tests included');
      expect(frontendCheck?.passed).toBe(false);
    });

    it('should pass frontend check when test files exist', () => {
      const files: PRFile[] = [
        {
          filename: 'adh-web/src/components/OrderForm.tsx',
          status: 'added',
          additions: 80,
          deletions: 0,
        },
        {
          filename: 'adh-web/src/components/OrderForm.test.tsx',
          status: 'added',
          additions: 150,
          deletions: 0,
        },
      ];
      const checks = analyzeChanges(files);
      const frontendCheck = checks.find((c) => c.label === 'Frontend tests included');
      expect(frontendCheck?.passed).toBe(true);
    });

    it('should flag domain changes without documentation', () => {
      const files: PRFile[] = [
        {
          filename: 'migration/caisse/src/Caisse.Domain/Order.cs',
          status: 'modified',
          additions: 40,
          deletions: 20,
        },
      ];
      const checks = analyzeChanges(files);
      const domainCheck = checks.find((c) => c.label === 'Domain changes documented');
      expect(domainCheck?.passed).toBe(false);
    });

    it('should pass domain check with migration documentation', () => {
      const files: PRFile[] = [
        {
          filename: 'migration/caisse/src/Caisse.Domain/Order.cs',
          status: 'modified',
          additions: 40,
          deletions: 20,
        },
        {
          filename: 'MIGRATION_DOMAIN.md',
          status: 'modified',
          additions: 50,
          deletions: 0,
        },
      ];
      const checks = analyzeChanges(files);
      const domainCheck = checks.find((c) => c.label === 'Domain changes documented');
      expect(domainCheck?.passed).toBe(true);
    });

    it('should require validators for new commands', () => {
      const files: PRFile[] = [
        {
          filename: 'migration/caisse/src/Caisse.Application/Orders/Commands/CreateOrder.cs',
          status: 'added',
          additions: 50,
          deletions: 0,
        },
      ];
      const checks = analyzeChanges(files);
      const validatorCheck = checks.find((c) => c.label === 'Validators included for commands');
      expect(validatorCheck?.passed).toBe(false);
    });

    it('should pass validator check when validator exists', () => {
      const files: PRFile[] = [
        {
          filename: 'migration/caisse/src/Caisse.Application/Orders/Commands/CreateOrder.cs',
          status: 'added',
          additions: 50,
          deletions: 0,
        },
        {
          filename:
            'migration/caisse/src/Caisse.Application/Orders/Commands/CreateOrderValidator.cs',
          status: 'added',
          additions: 80,
          deletions: 0,
        },
      ];
      const checks = analyzeChanges(files);
      const validatorCheck = checks.find((c) => c.label === 'Validators included for commands');
      expect(validatorCheck?.passed).toBe(true);
    });

    it('should flag production config changes', () => {
      const files: PRFile[] = [
        {
          filename: 'migration/caisse/src/Program.cs',
          status: 'modified',
          additions: 10,
          deletions: 5,
        },
        {
          filename: 'migration/caisse/src/appsettings.json',
          status: 'modified',
          additions: 10,
          deletions: 5,
        },
      ];
      const checks = analyzeChanges(files);
      const configCheck = checks.find((c) => c.label === 'No production config changes');
      expect(configCheck?.passed).toBe(false);
    });

    it('should allow development config changes', () => {
      const files: PRFile[] = [
        {
          filename: 'migration/caisse/src/Program.cs',
          status: 'modified',
          additions: 10,
          deletions: 5,
        },
        {
          filename: 'migration/caisse/src/appsettings.Development.json',
          status: 'modified',
          additions: 10,
          deletions: 5,
        },
      ];
      const checks = analyzeChanges(files);
      const configCheck = checks.find((c) => c.label === 'No production config changes');
      expect(configCheck?.passed).toBe(true);
    });

    it('should ignore removed files in backend tests check', () => {
      const files: PRFile[] = [
        {
          filename: 'migration/caisse/src/Caisse.Application/OldCommand.cs',
          status: 'removed',
          additions: 0,
          deletions: 50,
        },
      ];
      const checks = analyzeChanges(files);
      const backendCheck = checks.find((c) => c.label === 'Backend tests included');
      expect(backendCheck).toBeUndefined();
    });

    it('should extract correct module names from paths', () => {
      const files: PRFile[] = [
        {
          filename: 'migration/caisse/src/Caisse.Application/Invoices/Commands/CreateInvoice.cs',
          status: 'added',
          additions: 50,
          deletions: 0,
        },
        {
          filename: 'migration/caisse/src/Caisse.Application/Payments/Queries/GetPaymentById.cs',
          status: 'added',
          additions: 40,
          deletions: 0,
        },
        {
          filename: '.openspec/specs/invoice-payment-migration.md',
          status: 'added',
          additions: 100,
          deletions: 0,
        },
      ];
      const checks = analyzeChanges(files);
      const docCheck = checks.find((c) => c.label === 'Migration documentation updated');
      expect(docCheck?.details).toContain('Invoices');
      expect(docCheck?.details).toContain('Payments');
    });
  });

  describe('buildComment', () => {
    it('should build a comment with all passed checks', () => {
      const checks: CheckResult[] = [
        { label: 'Test 1', passed: true, details: 'All good' },
        { label: 'Test 2', passed: true, details: 'Perfect' },
      ];
      const files: PRFile[] = [];
      const comment = buildComment(1, checks, files);

      expect(comment).toContain('## Migration Checklist');
      expect(comment).toContain('**2/2**');
      expect(comment).toContain('checks passed');
      expect(comment).toContain(':white_check_mark:');
      expect(comment).not.toContain(':warning:');
    });

    it('should build a comment with mixed passed/failed checks', () => {
      const checks: CheckResult[] = [
        { label: 'Test 1', passed: true, details: 'Good' },
        { label: 'Test 2', passed: false, details: 'Bad' },
      ];
      const files: PRFile[] = [];
      const comment = buildComment(1, checks, files);

      expect(comment).toContain('**1/2**');
      expect(comment).toContain('checks passed');
      expect(comment).toContain(':warning:');
      expect(comment).toContain('Test 1');
      expect(comment).toContain('Test 2');
    });

    it('should include area summary for Caisse files', () => {
      const checks: CheckResult[] = [];
      const files: PRFile[] = [
        {
          filename: 'migration/caisse/src/file1.cs',
          status: 'modified',
          additions: 10,
          deletions: 5,
        },
        {
          filename: 'migration/caisse/src/file2.cs',
          status: 'modified',
          additions: 15,
          deletions: 8,
        },
      ];
      const comment = buildComment(1, checks, files);

      expect(comment).toContain('### Areas Modified');
      expect(comment).toContain('Caisse.API (2 files)');
    });

    it('should include area summary for adh-web files', () => {
      const checks: CheckResult[] = [];
      const files: PRFile[] = [
        {
          filename: 'adh-web/src/component.tsx',
          status: 'modified',
          additions: 20,
          deletions: 10,
        },
      ];
      const comment = buildComment(1, checks, files);

      expect(comment).toContain('adh-web (1 files)');
    });

    it('should include area summary for OpenSpec files', () => {
      const checks: CheckResult[] = [];
      const files: PRFile[] = [
        {
          filename: '.openspec/specs/test.md',
          status: 'added',
          additions: 50,
          deletions: 0,
        },
      ];
      const comment = buildComment(1, checks, files);

      expect(comment).toContain('OpenSpec (1 files)');
    });

    it('should include footer with factory link', () => {
      const checks: CheckResult[] = [];
      const files: PRFile[] = [];
      const comment = buildComment(1, checks, files);

      expect(comment).toContain('DevOps-Factory');
      expect(comment).toContain('---');
    });

    it('should show correct icon for passed checks', () => {
      const checks: CheckResult[] = [{ label: 'Passed Check', passed: true, details: 'Details' }];
      const files: PRFile[] = [];
      const comment = buildComment(1, checks, files);

      expect(comment).toContain(':white_check_mark: **Passed Check**');
    });

    it('should show correct icon for failed checks', () => {
      const checks: CheckResult[] = [
        { label: 'Failed Check', passed: false, details: 'Failure details' },
      ];
      const files: PRFile[] = [];
      const comment = buildComment(1, checks, files);

      expect(comment).toContain(':warning: **Failed Check**');
    });

    it('should include check details in comment', () => {
      const checks: CheckResult[] = [
        { label: 'Detail Test', passed: true, details: 'This is a specific detail' },
      ];
      const files: PRFile[] = [];
      const comment = buildComment(1, checks, files);

      expect(comment).toContain('This is a specific detail');
    });

    it('should count files correctly for multiple areas', () => {
      const checks: CheckResult[] = [];
      const files: PRFile[] = [
        { filename: 'migration/caisse/file1.cs', status: 'modified', additions: 10, deletions: 5 },
        { filename: 'migration/caisse/file2.cs', status: 'modified', additions: 15, deletions: 8 },
        { filename: 'adh-web/comp.tsx', status: 'modified', additions: 20, deletions: 10 },
        { filename: '.openspec/specs/test.md', status: 'added', additions: 50, deletions: 0 },
      ];
      const comment = buildComment(1, checks, files);

      expect(comment).toContain('Caisse.API (2 files)');
      expect(comment).toContain('adh-web (1 files)');
      expect(comment).toContain('OpenSpec (1 files)');
    });
  });
});
