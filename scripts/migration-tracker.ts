/**
 * migration-tracker.ts
 *
 * Tracks the migration progress of Lecteur_Magic (Magic Unipaas → .NET 8 / React).
 * Scans the repo via GitHub API to count migrated modules, entities, tests, specs.
 * Stores weekly snapshots in data/migration-history.json.
 *
 * Run: pnpm migration-tracker
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const REPO = 'thonyAGP/lecteur-magic';
const HISTORY_PATH = 'data/migration-history.json';

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
  date: string;
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
  tools: {
    csprojCount: number;
    kbIndexed: boolean;
    mcpServer: boolean;
  };
  overall: {
    progressPercent: number;
    totalFiles: number;
  };
}

interface MigrationHistory {
  repo: string;
  lastUpdated: string;
  snapshots: MigrationSnapshot[];
}

const getRepoTree = (): TreeEntry[] => {
  try {
    const raw = execSync(`gh api "repos/${REPO}/git/trees/master?recursive=1"`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
    }).trim();
    const data = JSON.parse(raw) as { tree: TreeEntry[] };
    return data.tree;
  } catch (e: unknown) {
    const err = e as { message?: string };
    console.error(`Failed to fetch repo tree: ${err.message?.slice(0, 200)}`);
    process.exit(1);
  }
};

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
    (e) =>
      e.type === 'blob' &&
      (e.path.includes('MIGRATION') || e.path.includes('migration')) &&
      e.path.endsWith('.md')
  ).length;

  return { totalSpecs, annotatedPrograms, migrationPatterns, migrationDocs };
};

const analyzeTools = (tree: TreeEntry[]): MigrationSnapshot['tools'] => {
  const csprojCount = tree.filter((e) => e.type === 'blob' && e.path.endsWith('.csproj')).length;

  const kbIndexed = tree.some((e) => e.path.includes('MagicKnowledgeBase/'));
  const mcpServer = tree.some((e) => e.path.includes('MagicMcp/'));

  return { csprojCount, kbIndexed, mcpServer };
};

const calculateProgress = (
  backend: MigrationSnapshot['backend'],
  frontend: MigrationSnapshot['frontend'],
  specs: MigrationSnapshot['specs']
): number => {
  // Weighted progress based on:
  // - Backend modules migrated (40%)
  // - Tests written (20%)
  // - Frontend components (15%)
  // - Specs documented (15%)
  // - Tools/Infrastructure (10%)

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

const main = () => {
  console.log('DevOps-Factory: Migration Tracker');
  console.log(`Scanning ${REPO}...\n`);

  const tree = getRepoTree();
  console.log(`  ${tree.length} files in repo tree`);

  const backend = analyzeBackend(tree);
  console.log(`\n  Backend (Caisse.API):`);
  console.log(`    ${backend.moduleCount} CQRS modules migrated`);
  console.log(`    ${backend.totalHandlers} command/query handlers`);
  console.log(`    ${backend.domainEntities} domain entities`);
  console.log(`    ${backend.apiEndpointFiles} API files`);
  console.log(`    ${backend.testFiles} test files (~${backend.testCount} tests)`);
  console.log(`    ${backend.csFiles} C# files total`);

  if (backend.modules.length > 0) {
    console.log(`\n    Modules:`);
    for (const m of backend.modules) {
      const flags = [
        m.hasCommands ? 'C' : '-',
        m.hasQueries ? 'Q' : '-',
        m.hasValidators ? 'V' : '-',
      ].join('');
      console.log(`      [${flags}] ${m.name} (${m.handlerCount} handlers)`);
    }
  }

  const frontend = analyzeFrontend(tree);
  console.log(`\n  Frontend (adh-web):`);
  console.log(`    ${frontend.reactComponents} React components`);
  console.log(`    ${frontend.tsFiles} TypeScript files`);
  console.log(`    ${frontend.htmlPages} HTML prototype pages`);
  console.log(`    Storybook: ${frontend.hasStorybook ? 'yes' : 'no'}`);

  const specs = analyzeSpecs(tree);
  console.log(`\n  OpenSpec:`);
  console.log(`    ${specs.totalSpecs} total specs`);
  console.log(`    ${specs.annotatedPrograms} annotated programs`);
  console.log(`    ${specs.migrationPatterns} migration patterns`);
  console.log(`    ${specs.migrationDocs} migration docs`);

  const tools = analyzeTools(tree);
  console.log(`\n  Tools:`);
  console.log(`    ${tools.csprojCount} csproj projects`);
  console.log(`    KB indexed: ${tools.kbIndexed}`);
  console.log(`    MCP server: ${tools.mcpServer}`);

  const progressPercent = calculateProgress(backend, frontend, specs);
  console.log(`\n  Overall progress: ${progressPercent}%`);

  // Build snapshot
  const snapshot: MigrationSnapshot = {
    date: new Date().toISOString().split('T')[0],
    backend,
    frontend,
    specs,
    tools,
    overall: {
      progressPercent,
      totalFiles: tree.filter((e) => e.type === 'blob').length,
    },
  };

  // Save history
  if (!existsSync('data')) mkdirSync('data', { recursive: true });

  let history: MigrationHistory;
  if (existsSync(HISTORY_PATH)) {
    try {
      history = JSON.parse(readFileSync(HISTORY_PATH, 'utf-8')) as MigrationHistory;
    } catch {
      history = { repo: REPO, lastUpdated: '', snapshots: [] };
    }
  } else {
    history = { repo: REPO, lastUpdated: '', snapshots: [] };
  }

  // Replace today's snapshot if exists, otherwise append
  const existingIdx = history.snapshots.findIndex((s) => s.date === snapshot.date);
  if (existingIdx >= 0) {
    history.snapshots[existingIdx] = snapshot;
  } else {
    history.snapshots.push(snapshot);
  }

  // Keep last 90 snapshots
  if (history.snapshots.length > 90) {
    history.snapshots = history.snapshots.slice(-90);
  }

  history.lastUpdated = new Date().toISOString();

  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
  console.log(`\nHistory saved to ${HISTORY_PATH} (${history.snapshots.length} snapshots)`);

  // Also write latest snapshot for dashboard consumption
  writeFileSync('data/migration-latest.json', JSON.stringify(snapshot, null, 2));
  console.log('Latest snapshot saved to data/migration-latest.json');
};

main();
