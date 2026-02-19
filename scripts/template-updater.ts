/**
 * template-updater.ts
 *
 * Reads the weekly veille report and checks DevOps-Factory templates
 * for outdated tool versions. Creates a GitHub issue with recommendations
 * for non-breaking updates and warnings for breaking ones.
 *
 * Run: pnpm template-update
 * Trigger: After weekly-veille.yml completes
 */

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface VeilleUpdate {
  source: string;
  category: string;
  type: string;
  version?: string;
  date: string;
  summary: string;
  url: string;
  breaking: boolean;
}

interface VeilleReport {
  date: string;
  updates: VeilleUpdate[];
  synthesis: string;
  recommendations: string[];
}

interface VersionMatch {
  file: string;
  tool: string;
  currentVersion: string;
  latestVersion: string;
  breaking: boolean;
  line: number;
}

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 15000 }).trim();
  } catch {
    return '';
  }
};

// --- Version extraction from templates ---

const VERSION_PATTERNS: { tool: string; regex: RegExp; veilleSource: string }[] = [
  {
    tool: 'Node.js',
    regex: /node-version:\s*['"]?(\d+)/g,
    veilleSource: 'Next.js', // Node version often tied to Next.js
  },
  {
    tool: 'pnpm',
    regex: /version:\s*(\d+)\s*#?\s*pnpm|pnpm.*version:\s*(\d+)/g,
    veilleSource: 'pnpm',
  },
  {
    tool: '.NET',
    regex: /dotnet-version:\s*['"]?(\d+\.\d+)/g,
    veilleSource: '.NET',
  },
  {
    tool: 'actions/checkout',
    regex: /actions\/checkout@v(\d+)/g,
    veilleSource: 'GitHub Actions',
  },
  {
    tool: 'actions/setup-node',
    regex: /actions\/setup-node@v(\d+)/g,
    veilleSource: 'GitHub Actions',
  },
];

const TEMPLATES_DIR = 'templates';

const scanTemplates = (): Map<string, { version: string; files: string[]; lines: number[] }> => {
  const results = new Map<string, { version: string; files: string[]; lines: number[] }>();

  if (!existsSync(TEMPLATES_DIR)) return results;

  const files = readdirSync(TEMPLATES_DIR, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml') || f.endsWith('.json'));

  for (const file of files) {
    const filePath = join(TEMPLATES_DIR, file);
    const content = readFileSync(filePath, 'utf-8');

    for (const pattern of VERSION_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(content)) !== null) {
        const version = match[1] || match[2];
        if (!version) continue;

        // Find line number
        const lineIdx = content.substring(0, match.index).split('\n').length;

        const key = pattern.tool;
        const existing = results.get(key);
        if (existing) {
          if (!existing.files.includes(file)) {
            existing.files.push(file);
            existing.lines.push(lineIdx);
          }
        } else {
          results.set(key, { version, files: [file], lines: [lineIdx] });
        }
      }
    }
  }

  return results;
};

// --- Compare with veille data ---

const loadLatestVeille = (): VeilleReport | null => {
  const historyPath = 'data/veille-history.json';
  if (!existsSync(historyPath)) return null;
  try {
    const history = JSON.parse(readFileSync(historyPath, 'utf-8')) as VeilleReport[];
    return history.length > 0 ? history[0] : null;
  } catch {
    return null;
  }
};

const extractLatestStableVersion = (updates: VeilleUpdate[], source: string): string | null => {
  const sourceUpdates = updates
    .filter((u) => u.source === source && u.version)
    .filter((u) => {
      const v = u.version || '';
      // Skip pre-releases
      return (
        !v.includes('alpha') && !v.includes('beta') && !v.includes('canary') && !v.includes('rc')
      );
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return sourceUpdates.length > 0 ? sourceUpdates[0].version || null : null;
};

const hasBreakingUpdate = (updates: VeilleUpdate[], source: string): boolean => {
  return updates.some((u) => u.source === source && u.breaking);
};

// --- Report generation ---

const generateUpdateReport = (
  templateVersions: Map<string, { version: string; files: string[]; lines: number[] }>,
  veille: VeilleReport
): string => {
  const lines: string[] = [
    '## Template Update Report',
    '',
    `> Based on veille from ${veille.date}`,
    '',
  ];

  const actionable: VersionMatch[] = [];
  const watchlist: string[] = [];

  // Check pnpm major version
  const pnpmUpdate = veille.updates.find(
    (u) => u.source === 'pnpm' && u.version && !u.version.includes('alpha')
  );
  const pnpmTemplate = templateVersions.get('pnpm');
  if (pnpmUpdate && pnpmTemplate) {
    const latestMajor = pnpmUpdate.version?.match(/v?(\d+)\./)?.[1];
    if (latestMajor && latestMajor !== pnpmTemplate.version) {
      if (pnpmUpdate.breaking) {
        watchlist.push(
          `pnpm v${latestMajor} detected (current: v${pnpmTemplate.version}) - **BREAKING** - monitor before updating`
        );
      } else {
        actionable.push({
          file: pnpmTemplate.files[0],
          tool: 'pnpm',
          currentVersion: pnpmTemplate.version,
          latestVersion: latestMajor,
          breaking: false,
          line: pnpmTemplate.lines[0],
        });
      }
    }
  }

  // Check for breaking changes in monitored tools
  for (const source of ['Vitest', 'Prisma', 'Next.js', 'Fastify', 'Playwright']) {
    if (hasBreakingUpdate(veille.updates, source)) {
      const latest = extractLatestStableVersion(veille.updates, source);
      watchlist.push(
        `${source} ${latest || ''} has breaking changes - review before updating templates`
      );
    }
  }

  // Report
  if (actionable.length > 0) {
    lines.push('### Recommended Updates');
    lines.push('');
    lines.push('| Tool | Current | Latest | File | Action |');
    lines.push('|------|---------|--------|------|--------|');
    for (const a of actionable) {
      lines.push(
        `| ${a.tool} | v${a.currentVersion} | v${a.latestVersion} | \`${a.file}\` | Update |`
      );
    }
    lines.push('');
  }

  if (watchlist.length > 0) {
    lines.push('### Watchlist (Breaking Changes)');
    lines.push('');
    for (const w of watchlist) {
      lines.push(`- ${w}`);
    }
    lines.push('');
  }

  if (actionable.length === 0 && watchlist.length === 0) {
    lines.push('### All templates are up to date');
    lines.push('');
    lines.push("No version updates needed based on this week's veille.");
    lines.push('');
  }

  // Template inventory
  lines.push('### Template Inventory');
  lines.push('');
  lines.push('| Tool | Version in Templates | Files |');
  lines.push('|------|---------------------|-------|');
  for (const [tool, info] of templateVersions) {
    lines.push(`| ${tool} | v${info.version} | ${info.files.length} file(s) |`);
  }
  lines.push('');

  lines.push('---');
  lines.push('*Auto-generated by DevOps-Factory Template Updater*');

  return lines.join('\n');
};

// --- Main ---

const main = (): void => {
  const factoryRepo = process.env.GITHUB_REPOSITORY ?? 'thonyAGP/DevOps-Factory';

  console.log('\nTemplate Updater\n');

  // 1. Load latest veille
  console.log('Loading latest veille report...');
  const veille = loadLatestVeille();
  if (!veille) {
    console.log('  No veille report found. Run pnpm veille first.');
    return;
  }
  console.log(`  Veille from ${veille.date}: ${veille.updates.length} updates`);

  // 2. Scan templates
  console.log('Scanning templates...');
  const templateVersions = scanTemplates();
  console.log(`  Found ${templateVersions.size} versioned tools across templates`);

  for (const [tool, info] of templateVersions) {
    console.log(`  - ${tool}: v${info.version} (${info.files.length} files)`);
  }

  // 3. Generate report
  console.log('\nGenerating update report...');
  const report = generateUpdateReport(templateVersions, veille);

  // 4. Save locally
  writeFileSync('data/template-update-report.md', report);
  console.log('Report saved to data/template-update-report.md');

  // 5. Post as GitHub issue comment (append to veille issue) in CI
  if (process.env.GITHUB_ACTIONS) {
    const LABEL = 'veille';
    const existing = sh(
      `gh issue list --repo ${factoryRepo} --label "${LABEL}" --state open --json number --jq ".[0].number"`
    );
    if (existing) {
      const tmpFile = '/tmp/template-update-body.md';
      writeFileSync(tmpFile, report);
      sh(`gh issue comment ${existing} --repo ${factoryRepo} --body-file "${tmpFile}"`);
      console.log(`  Appended to veille issue #${existing}`);
    }
  }

  console.log('\nTemplate update check complete.');
};

main();
