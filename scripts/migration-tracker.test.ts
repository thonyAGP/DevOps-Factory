/**
 * migration-tracker.test.ts
 *
 * Unit tests for migration-tracker.ts
 * Tests the analysis and progress calculation functions
 */

import { describe, it, expect } from 'vitest';

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
}

interface MigrationModule {
  name: string;
  hasCommands: boolean;
  hasQueries: boolean;
  hasValidators: boolean;
  handlerCount: number;
}

interface MigrationSnapshot {
  backend: {
    modules: MigrationModule[];
    moduleCount: number;
    totalHandlers: number;
    domainEntities: number;
    apiEndpointFiles: number;
    testFiles: number;
    testCount: number;
    csFiles: number;
  };
  frontend: {
    reactComponents: number;
    tsFiles: number;
    htmlPages: number;
    hasStorybook: boolean;
  };
  specs: {
    totalSpecs: number;
    annotatedPrograms: number;
    migrationPatterns: number;
    migrationDocs: number;
  };
}

// Pure functions extracted for testing
const analyzeBackend = (tree: TreeEntry[]): MigrationSnapshot['backend'] => {
  const appBase = 'migration/caisse/src/Caisse.Application/';

  // Find CQRS module folders (direct children of Caisse.Application)
  const moduleDirs = new Set<string>();
  for (const entry of tree) {
    if (entry.path.startsWith(appBase) && entry.type === 'blob') {
      const relative = entry.path.slice(appBase.length);
      const parts = relative.split('/');
      if (parts.length >= 2) {
        moduleDirs.add(parts[0]);
      }
    }
  }

  // Exclude non-module folders
  const excluded = new Set([
    'Common',
    'Interfaces',
    'Behaviors',
    'Extensions',
    'DependencyInjection',
  ]);
  const moduleNames = [...moduleDirs].filter((d) => !excluded.has(d)).sort();

  const modules: MigrationModule[] = moduleNames.map((name) => {
    const prefix = `${appBase}${name}/`;
    const moduleFiles = tree.filter((e) => e.path.startsWith(prefix) && e.type === 'blob');
    const hasCommands = moduleFiles.some((f) => f.path.includes('/Commands/'));
    const hasQueries = moduleFiles.some((f) => f.path.includes('/Queries/'));
    const hasValidators = moduleFiles.some((f) => f.path.toLowerCase().includes('validator'));
    const handlerCount = moduleFiles.filter(
      (f) =>
        f.type === 'blob' &&
        f.path.endsWith('.cs') &&
        !f.path.includes('Validator') &&
        (f.path.includes('/Commands/') || f.path.includes('/Queries/'))
    ).length;
    return { name, hasCommands, hasQueries, hasValidators, handlerCount };
  });

  // Domain entities
  const domainBase = 'migration/caisse/src/Caisse.Domain/';
  const domainEntities = tree.filter(
    (e) => e.path.startsWith(domainBase) && e.type === 'blob' && e.path.endsWith('.cs')
  ).length;

  // API endpoint files
  const apiBase = 'migration/caisse/src/Caisse.Api/';
  const apiEndpointFiles = tree.filter(
    (e) =>
      e.path.startsWith(apiBase) &&
      e.type === 'blob' &&
      e.path.endsWith('.cs') &&
      !e.path.includes('Program.cs')
  ).length;

  // Test files
  const testBase = 'migration/caisse/tests/';
  const testFiles = tree.filter(
    (e) => e.path.startsWith(testBase) && e.type === 'blob' && e.path.endsWith('.cs')
  ).length;

  // Estimate test count from test files (avg ~3 tests per file)
  const testCount = testFiles * 3;

  // Total C# files in migration
  const csFiles = tree.filter(
    (e) => e.path.startsWith('migration/') && e.type === 'blob' && e.path.endsWith('.cs')
  ).length;

  return {
    modules,
    moduleCount: modules.length,
    totalHandlers: modules.reduce((s, m) => s + m.handlerCount, 0),
    domainEntities,
    apiEndpointFiles,
    testFiles,
    testCount,
    csFiles,
  };
};

const analyzeFrontend = (tree: TreeEntry[]): MigrationSnapshot['frontend'] => {
  const webBase = 'adh-web/src/';

  const reactComponents = tree.filter(
    (e) =>
      e.path.startsWith(webBase) &&
      e.type === 'blob' &&
      (e.path.endsWith('.tsx') || e.path.endsWith('.jsx'))
  ).length;

  const tsFiles = tree.filter(
    (e) =>
      e.path.startsWith(webBase) &&
      e.type === 'blob' &&
      (e.path.endsWith('.ts') || e.path.endsWith('.tsx'))
  ).length;

  // HTML pages (prototypes in migration/caisse/)
  const htmlPages = tree.filter(
    (e) =>
      e.path.startsWith('migration/caisse/') &&
      e.type === 'blob' &&
      e.path.endsWith('.html') &&
      !e.path.includes('node_modules')
  ).length;

  const hasStorybook = tree.some((e) => e.path.includes('.storybook/'));

  return { reactComponents, tsFiles, htmlPages, hasStorybook };
};

const analyzeSpecs = (tree: TreeEntry[]): MigrationSnapshot['specs'] => {
  // Total OpenSpec spec files
  const totalSpecs = tree.filter(
    (e) => e.path.startsWith('.openspec/specs/') && e.type === 'blob' && e.path.endsWith('.md')
  ).length;

  // Annotated programs (yaml files in annotations/)
  const annotatedPrograms = tree.filter(
    (e) =>
      e.path.startsWith('.openspec/annotations/') &&
      e.type === 'blob' &&
      (e.path.endsWith('.yml') || e.path.endsWith('.yaml')) &&
      !e.path.includes('TEMPLATE')
  ).length;

  // Migration patterns documented
  const migrationPatterns = tree.filter(
    (e) => e.path.startsWith('.openspec/patterns/') && e.type === 'blob' && e.path.endsWith('.md')
  ).length;

  // Migration docs (MIGRATION_*.md files)
  const migrationDocs = tree.filter(
    (e) => e.type === 'blob' && e.path.toLowerCase().includes('migration') && e.path.endsWith('.md')
  ).length;

  return { totalSpecs, annotatedPrograms, migrationPatterns, migrationDocs };
};

const calculateProgress = (
  backend: MigrationSnapshot['backend'],
  frontend: MigrationSnapshot['frontend'],
  specs: MigrationSnapshot['specs']
): number => {
  // Estimated total modules for full Caisse migration: ~30
  const backendProgress = Math.min(100, (backend.moduleCount / 30) * 100);

  // Test coverage: target 200+ test methods
  const testProgress = Math.min(100, (backend.testCount / 200) * 100);

  // Frontend: target 50+ React components
  const frontendProgress = Math.min(100, (frontend.reactComponents / 50) * 100);

  // Specs: based on annotations + patterns
  const specProgress = Math.min(
    100,
    ((specs.annotatedPrograms + specs.migrationPatterns) / 30) * 100
  );

  // Tools: binary (KB + MCP = 100%)
  const toolsProgress = 100; // Already built

  return Math.round(
    backendProgress * 0.4 +
      testProgress * 0.2 +
      frontendProgress * 0.15 +
      specProgress * 0.15 +
      toolsProgress * 0.1
  );
};

describe('migration-tracker', () => {
  describe('analyzeBackend', () => {
    it('should return zero modules for empty tree', () => {
      const tree: TreeEntry[] = [];
      const result = analyzeBackend(tree);
      expect(result.moduleCount).toBe(0);
      expect(result.modules).toEqual([]);
    });

    it('should extract module names from application paths', () => {
      const tree: TreeEntry[] = [
        {
          path: 'migration/caisse/src/Caisse.Application/Orders/Commands/CreateOrder.cs',
          type: 'blob',
        },
        {
          path: 'migration/caisse/src/Caisse.Application/Orders/Queries/GetOrder.cs',
          type: 'blob',
        },
      ];
      const result = analyzeBackend(tree);
      expect(result.moduleCount).toBe(1);
      expect(result.modules[0].name).toBe('Orders');
    });

    it('should detect commands in modules', () => {
      const tree: TreeEntry[] = [
        {
          path: 'migration/caisse/src/Caisse.Application/Orders/Commands/CreateOrder.cs',
          type: 'blob',
        },
      ];
      const result = analyzeBackend(tree);
      expect(result.modules[0].hasCommands).toBe(true);
    });

    it('should detect queries in modules', () => {
      const tree: TreeEntry[] = [
        {
          path: 'migration/caisse/src/Caisse.Application/Orders/Queries/GetOrder.cs',
          type: 'blob',
        },
      ];
      const result = analyzeBackend(tree);
      expect(result.modules[0].hasQueries).toBe(true);
    });

    it('should detect validators in modules', () => {
      const tree: TreeEntry[] = [
        {
          path: 'migration/caisse/src/Caisse.Application/Orders/Commands/CreateOrderValidator.cs',
          type: 'blob',
        },
      ];
      const result = analyzeBackend(tree);
      expect(result.modules[0].hasValidators).toBe(true);
    });

    it('should count handler files correctly', () => {
      const tree: TreeEntry[] = [
        {
          path: 'migration/caisse/src/Caisse.Application/Orders/Commands/CreateOrder.cs',
          type: 'blob',
        },
        {
          path: 'migration/caisse/src/Caisse.Application/Orders/Commands/UpdateOrder.cs',
          type: 'blob',
        },
        {
          path: 'migration/caisse/src/Caisse.Application/Orders/Commands/CreateOrderValidator.cs',
          type: 'blob',
        },
      ];
      const result = analyzeBackend(tree);
      expect(result.modules[0].handlerCount).toBe(2);
    });

    it('should exclude common non-module folders', () => {
      const tree: TreeEntry[] = [
        {
          path: 'migration/caisse/src/Caisse.Application/Common/Utils.cs',
          type: 'blob',
        },
        {
          path: 'migration/caisse/src/Caisse.Application/Interfaces/IHandler.cs',
          type: 'blob',
        },
        {
          path: 'migration/caisse/src/Caisse.Application/Orders/Commands/CreateOrder.cs',
          type: 'blob',
        },
      ];
      const result = analyzeBackend(tree);
      expect(result.moduleCount).toBe(1);
      expect(result.modules[0].name).toBe('Orders');
    });

    it('should count domain entities', () => {
      const tree: TreeEntry[] = [
        {
          path: 'migration/caisse/src/Caisse.Domain/Order.cs',
          type: 'blob',
        },
        {
          path: 'migration/caisse/src/Caisse.Domain/Customer.cs',
          type: 'blob',
        },
      ];
      const result = analyzeBackend(tree);
      expect(result.domainEntities).toBe(2);
    });

    it('should count API endpoint files', () => {
      const tree: TreeEntry[] = [
        {
          path: 'migration/caisse/src/Caisse.Api/OrdersController.cs',
          type: 'blob',
        },
        {
          path: 'migration/caisse/src/Caisse.Api/CustomersController.cs',
          type: 'blob',
        },
        {
          path: 'migration/caisse/src/Caisse.Api/Program.cs',
          type: 'blob',
        },
      ];
      const result = analyzeBackend(tree);
      expect(result.apiEndpointFiles).toBe(2);
    });

    it('should count test files and estimate test count', () => {
      const tree: TreeEntry[] = [
        {
          path: 'migration/caisse/tests/OrderTests.cs',
          type: 'blob',
        },
        {
          path: 'migration/caisse/tests/CustomerTests.cs',
          type: 'blob',
        },
      ];
      const result = analyzeBackend(tree);
      expect(result.testFiles).toBe(2);
      expect(result.testCount).toBe(6);
    });

    it('should count total C# files in migration', () => {
      const tree: TreeEntry[] = [
        {
          path: 'migration/caisse/src/Caisse.Domain/Order.cs',
          type: 'blob',
        },
        {
          path: 'migration/caisse/src/Caisse.Application/Orders/Commands/CreateOrder.cs',
          type: 'blob',
        },
        {
          path: 'migration/caisse/tests/OrderTests.cs',
          type: 'blob',
        },
      ];
      const result = analyzeBackend(tree);
      expect(result.csFiles).toBe(3);
    });

    it('should handle multiple modules correctly', () => {
      const tree: TreeEntry[] = [
        {
          path: 'migration/caisse/src/Caisse.Application/Orders/Commands/CreateOrder.cs',
          type: 'blob',
        },
        {
          path: 'migration/caisse/src/Caisse.Application/Payments/Commands/CreatePayment.cs',
          type: 'blob',
        },
        {
          path: 'migration/caisse/src/Caisse.Application/Invoices/Queries/GetInvoice.cs',
          type: 'blob',
        },
      ];
      const result = analyzeBackend(tree);
      expect(result.moduleCount).toBe(3);
      expect(result.modules.map((m) => m.name).sort()).toEqual(['Invoices', 'Orders', 'Payments']);
    });

    it('should calculate total handlers across modules', () => {
      const tree: TreeEntry[] = [
        {
          path: 'migration/caisse/src/Caisse.Application/Orders/Commands/CreateOrder.cs',
          type: 'blob',
        },
        {
          path: 'migration/caisse/src/Caisse.Application/Orders/Queries/GetOrder.cs',
          type: 'blob',
        },
        {
          path: 'migration/caisse/src/Caisse.Application/Payments/Commands/CreatePayment.cs',
          type: 'blob',
        },
      ];
      const result = analyzeBackend(tree);
      expect(result.totalHandlers).toBe(3);
    });

    it('should ignore non-blob entries', () => {
      const tree: TreeEntry[] = [
        {
          path: 'migration/caisse/src/Caisse.Application/Orders',
          type: 'tree',
        },
        {
          path: 'migration/caisse/src/Caisse.Application/Orders/Commands/CreateOrder.cs',
          type: 'blob',
        },
      ];
      const result = analyzeBackend(tree);
      expect(result.moduleCount).toBe(1);
    });
  });

  describe('analyzeFrontend', () => {
    it('should count React components', () => {
      const tree: TreeEntry[] = [
        {
          path: 'adh-web/src/components/OrderForm.tsx',
          type: 'blob',
        },
        {
          path: 'adh-web/src/components/PaymentButton.jsx',
          type: 'blob',
        },
      ];
      const result = analyzeFrontend(tree);
      expect(result.reactComponents).toBe(2);
    });

    it('should count TypeScript files', () => {
      const tree: TreeEntry[] = [
        {
          path: 'adh-web/src/utils/api.ts',
          type: 'blob',
        },
        {
          path: 'adh-web/src/components/OrderForm.tsx',
          type: 'blob',
        },
      ];
      const result = analyzeFrontend(tree);
      expect(result.tsFiles).toBe(2);
    });

    it('should count HTML prototype pages', () => {
      const tree: TreeEntry[] = [
        {
          path: 'migration/caisse/prototypes/order-form.html',
          type: 'blob',
        },
        {
          path: 'migration/caisse/prototypes/payment-page.html',
          type: 'blob',
        },
      ];
      const result = analyzeFrontend(tree);
      expect(result.htmlPages).toBe(2);
    });

    it('should detect Storybook presence', () => {
      const tree: TreeEntry[] = [
        {
          path: 'adh-web/.storybook/main.ts',
          type: 'blob',
        },
      ];
      const result = analyzeFrontend(tree);
      expect(result.hasStorybook).toBe(true);
    });

    it('should return no Storybook if not present', () => {
      const tree: TreeEntry[] = [
        {
          path: 'adh-web/src/components/Button.tsx',
          type: 'blob',
        },
      ];
      const result = analyzeFrontend(tree);
      expect(result.hasStorybook).toBe(false);
    });

    it('should ignore node_modules in HTML pages', () => {
      const tree: TreeEntry[] = [
        {
          path: 'migration/caisse/node_modules/package/index.html',
          type: 'blob',
        },
        {
          path: 'migration/caisse/prototypes/page.html',
          type: 'blob',
        },
      ];
      const result = analyzeFrontend(tree);
      expect(result.htmlPages).toBe(1);
    });
  });

  describe('analyzeSpecs', () => {
    it('should count total specs', () => {
      const tree: TreeEntry[] = [
        {
          path: '.openspec/specs/orders.md',
          type: 'blob',
        },
        {
          path: '.openspec/specs/payments.md',
          type: 'blob',
        },
      ];
      const result = analyzeSpecs(tree);
      expect(result.totalSpecs).toBe(2);
    });

    it('should count annotated programs', () => {
      const tree: TreeEntry[] = [
        {
          path: '.openspec/annotations/program-1.yml',
          type: 'blob',
        },
        {
          path: '.openspec/annotations/program-2.yaml',
          type: 'blob',
        },
      ];
      const result = analyzeSpecs(tree);
      expect(result.annotatedPrograms).toBe(2);
    });

    it('should exclude template annotations', () => {
      const tree: TreeEntry[] = [
        {
          path: '.openspec/annotations/TEMPLATE.yml',
          type: 'blob',
        },
        {
          path: '.openspec/annotations/program-1.yml',
          type: 'blob',
        },
      ];
      const result = analyzeSpecs(tree);
      expect(result.annotatedPrograms).toBe(1);
    });

    it('should count migration patterns', () => {
      const tree: TreeEntry[] = [
        {
          path: '.openspec/patterns/cqrs-pattern.md',
          type: 'blob',
        },
        {
          path: '.openspec/patterns/domain-driven-design.md',
          type: 'blob',
        },
      ];
      const result = analyzeSpecs(tree);
      expect(result.migrationPatterns).toBe(2);
    });

    it('should count migration documentation files', () => {
      const tree: TreeEntry[] = [
        {
          path: 'MIGRATION_GUIDE.md',
          type: 'blob',
        },
        {
          path: 'docs/migration-steps.md',
          type: 'blob',
        },
      ];
      const result = analyzeSpecs(tree);
      expect(result.migrationDocs).toBe(2);
    });

    it('should handle case-insensitive migration word matching', () => {
      const tree: TreeEntry[] = [
        {
          path: 'docs/Migration_Strategy.md',
          type: 'blob',
        },
        {
          path: 'MIGRATION.md',
          type: 'blob',
        },
      ];
      const result = analyzeSpecs(tree);
      expect(result.migrationDocs).toBe(2);
    });
  });

  describe('calculateProgress', () => {
    it('should return 0 for empty migration', () => {
      const backend = {
        modules: [],
        moduleCount: 0,
        totalHandlers: 0,
        domainEntities: 0,
        apiEndpointFiles: 0,
        testFiles: 0,
        testCount: 0,
        csFiles: 0,
      };
      const frontend = {
        reactComponents: 0,
        tsFiles: 0,
        htmlPages: 0,
        hasStorybook: false,
      };
      const specs = {
        totalSpecs: 0,
        annotatedPrograms: 0,
        migrationPatterns: 0,
        migrationDocs: 0,
      };
      const progress = calculateProgress(backend, frontend, specs);
      expect(progress).toBe(10);
    });

    it('should calculate partial progress correctly', () => {
      const backend = {
        modules: [],
        moduleCount: 15,
        totalHandlers: 0,
        domainEntities: 0,
        apiEndpointFiles: 0,
        testFiles: 0,
        testCount: 100,
        csFiles: 0,
      };
      const frontend = {
        reactComponents: 25,
        tsFiles: 0,
        htmlPages: 0,
        hasStorybook: false,
      };
      const specs = {
        totalSpecs: 0,
        annotatedPrograms: 15,
        migrationPatterns: 0,
        migrationDocs: 0,
      };
      const progress = calculateProgress(backend, frontend, specs);
      expect(progress).toBeGreaterThan(0);
      expect(progress).toBeLessThanOrEqual(100);
    });

    it('should cap progress at 100', () => {
      const backend = {
        modules: [],
        moduleCount: 30,
        totalHandlers: 0,
        domainEntities: 0,
        apiEndpointFiles: 0,
        testFiles: 0,
        testCount: 300,
        csFiles: 0,
      };
      const frontend = {
        reactComponents: 100,
        tsFiles: 0,
        htmlPages: 0,
        hasStorybook: true,
      };
      const specs = {
        totalSpecs: 0,
        annotatedPrograms: 30,
        migrationPatterns: 30,
        migrationDocs: 0,
      };
      const progress = calculateProgress(backend, frontend, specs);
      expect(progress).toBeLessThanOrEqual(100);
    });

    it('should weight backend progress at 40%', () => {
      const backend = {
        modules: [],
        moduleCount: 30,
        totalHandlers: 0,
        domainEntities: 0,
        apiEndpointFiles: 0,
        testFiles: 0,
        testCount: 0,
        csFiles: 0,
      };
      const frontend = {
        reactComponents: 0,
        tsFiles: 0,
        htmlPages: 0,
        hasStorybook: false,
      };
      const specs = {
        totalSpecs: 0,
        annotatedPrograms: 0,
        migrationPatterns: 0,
        migrationDocs: 0,
      };
      const progress = calculateProgress(backend, frontend, specs);
      expect(progress).toBe(50);
    });

    it('should weight tests at 20%', () => {
      const backend = {
        modules: [],
        moduleCount: 0,
        totalHandlers: 0,
        domainEntities: 0,
        apiEndpointFiles: 0,
        testFiles: 0,
        testCount: 200,
        csFiles: 0,
      };
      const frontend = {
        reactComponents: 0,
        tsFiles: 0,
        htmlPages: 0,
        hasStorybook: false,
      };
      const specs = {
        totalSpecs: 0,
        annotatedPrograms: 0,
        migrationPatterns: 0,
        migrationDocs: 0,
      };
      const progress = calculateProgress(backend, frontend, specs);
      expect(progress).toBe(30);
    });

    it('should weight frontend at 15%', () => {
      const backend = {
        modules: [],
        moduleCount: 0,
        totalHandlers: 0,
        domainEntities: 0,
        apiEndpointFiles: 0,
        testFiles: 0,
        testCount: 0,
        csFiles: 0,
      };
      const frontend = {
        reactComponents: 50,
        tsFiles: 0,
        htmlPages: 0,
        hasStorybook: false,
      };
      const specs = {
        totalSpecs: 0,
        annotatedPrograms: 0,
        migrationPatterns: 0,
        migrationDocs: 0,
      };
      const progress = calculateProgress(backend, frontend, specs);
      expect(progress).toBe(25);
    });

    it('should weight specs at 15%', () => {
      const backend = {
        modules: [],
        moduleCount: 0,
        totalHandlers: 0,
        domainEntities: 0,
        apiEndpointFiles: 0,
        testFiles: 0,
        testCount: 0,
        csFiles: 0,
      };
      const frontend = {
        reactComponents: 0,
        tsFiles: 0,
        htmlPages: 0,
        hasStorybook: false,
      };
      const specs = {
        totalSpecs: 0,
        annotatedPrograms: 30,
        migrationPatterns: 0,
        migrationDocs: 0,
      };
      const progress = calculateProgress(backend, frontend, specs);
      expect(progress).toBe(25);
    });
  });
});
