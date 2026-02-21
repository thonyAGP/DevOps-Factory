/**
 * cross-repo-update.ts
 *
 * Applies a file change (template, config, etc.) across multiple repos via PRs.
 * Useful for: Node upgrades, ESLint migrations, config standardization.
 *
 * Usage:
 *   pnpm cross-update -- --file .github/workflows/ci.yml --template templates/ci-standard.yml
 *   pnpm cross-update -- --file .nvmrc --content "22" --title "chore: upgrade to Node 22"
 *   pnpm cross-update -- --file renovate.json --template templates/renovate.json --stack node,nextjs
 *
 * Run: pnpm cross-update
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { jq, devNull } from './shell-utils.js';
import { logActivity } from './activity-logger.js';

interface Args {
  file: string; // target path in repos (e.g. ".github/workflows/ci.yml")
  template?: string; // local template file path
  content?: string; // direct content string
  title?: string; // PR title
  stack?: string[]; // filter by stack (e.g. ["node", "nextjs"])
  dryRun: boolean;
  repos?: string[]; // specific repos to target
}

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30000 }).trim();
  } catch {
    return '';
  }
};

const parseArgs = (): Args => {
  const argv = process.argv.slice(2);
  const args: Args = { file: '', dryRun: false };

  for (let i = 0; i < argv.length; i++) {
    const val = argv[i + 1];
    switch (argv[i]) {
      case '--file':
        args.file = val ?? '';
        i++;
        break;
      case '--template':
        args.template = val;
        i++;
        break;
      case '--content':
        args.content = val;
        i++;
        break;
      case '--title':
        args.title = val;
        i++;
        break;
      case '--stack':
        args.stack = val?.split(',') ?? [];
        i++;
        break;
      case '--repos':
        args.repos = val?.split(',') ?? [];
        i++;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
    }
  }

  if (!args.file) {
    console.error(
      'Usage: pnpm cross-update -- --file <path> --template <local-file> [--stack node,nextjs] [--dry-run]'
    );
    process.exit(1);
  }

  if (!args.template && !args.content) {
    console.error('Error: Must provide --template or --content');
    process.exit(1);
  }

  return args;
};

const getContent = (args: Args): string => {
  if (args.content) return args.content;
  if (args.template && existsSync(args.template)) {
    return readFileSync(args.template, 'utf-8');
  }
  console.error(`Template file not found: ${args.template}`);
  process.exit(1);
};

const getTargetRepos = (
  args: Args
): Array<{ name: string; fullName: string; defaultBranch: string }> => {
  const reportPath = 'dashboard/scan-report.json';
  if (!existsSync(reportPath)) {
    console.error('No scan report found. Run pnpm scan first.');
    process.exit(1);
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf-8')) as {
    analyses: Array<{ name: string; fullName: string; stack: string; defaultBranch: string }>;
  };

  let targets = report.analyses.filter((a) => a.stack !== 'unknown');

  if (args.stack && args.stack.length > 0) {
    targets = targets.filter((a) => args.stack!.includes(a.stack));
  }

  if (args.repos && args.repos.length > 0) {
    targets = targets.filter(
      (a) => args.repos!.includes(a.name) || args.repos!.includes(a.fullName)
    );
  }

  return targets.map((a) => ({
    name: a.name,
    fullName: a.fullName,
    defaultBranch: a.defaultBranch || 'main',
  }));
};

const createUpdatePR = (
  repo: { name: string; fullName: string; defaultBranch: string },
  targetPath: string,
  content: string,
  title: string,
  dryRun: boolean
): string | null => {
  const branchName = `devops-factory/cross-update-${targetPath.replace(/[/.]/g, '-')}`;

  // Check for existing PR
  const existingPR = sh(
    `gh pr list --repo ${repo.fullName} --head ${branchName} --json number --jq ${jq('.[0].number')}`
  );
  if (existingPR) {
    console.log(`  [SKIP] ${repo.name}: PR #${existingPR} already exists`);
    return null;
  }

  if (dryRun) {
    console.log(`  [DRY-RUN] Would update ${targetPath} in ${repo.name}`);
    return 'dry-run';
  }

  // Get base SHA
  const baseSha = sh(
    `gh api repos/${repo.fullName}/git/ref/heads/${repo.defaultBranch} --jq ${jq('.object.sha')}`
  );
  if (!baseSha) {
    console.log(`  [ERROR] ${repo.name}: cannot get base SHA`);
    return null;
  }

  // Create branch
  sh(
    `gh api repos/${repo.fullName}/git/refs --method POST -f ref="refs/heads/${branchName}" -f sha="${baseSha}" 2>${devNull}`
  );

  // Encode content
  const b64 = Buffer.from(content).toString('base64');

  // Check if file exists (for update vs create)
  const existing = sh(
    `gh api "repos/${repo.fullName}/contents/${targetPath}?ref=${repo.defaultBranch}" --jq ${jq('.sha')} 2>${devNull}`
  );

  let uploadCmd = `gh api repos/${repo.fullName}/contents/${targetPath} --method PUT -f message="chore: update ${targetPath} via cross-repo update" -f content="${b64}" -f branch="${branchName}"`;
  if (existing) {
    uploadCmd += ` -f sha="${existing}"`;
  }
  sh(uploadCmd);

  // Create PR
  const prUrl = sh(
    `gh pr create --repo ${repo.fullName} --head ${branchName} --base ${repo.defaultBranch} --title "${title}" --body "## Cross-Repo Update\n\nUpdating \\\`${targetPath}\\\` to match DevOps-Factory standard.\n\n> Auto-generated by [DevOps-Factory](https://github.com/thonyAGP/DevOps-Factory) cross-repo update tool."`
  );

  return prUrl.match(/(https:\/\/[^\s]+)/)?.[1] ?? prUrl;
};

const main = () => {
  const args = parseArgs();
  const content = getContent(args);
  const targets = getTargetRepos(args);
  const title = args.title ?? `chore: update ${args.file} via DevOps-Factory`;

  console.log(`Cross-Repo Update`);
  console.log(`  File: ${args.file}`);
  console.log(`  Source: ${args.template ?? '(inline content)'}`);
  console.log(`  Targets: ${targets.length} repo(s)`);
  console.log(`  Mode: ${args.dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  let created = 0;
  let skipped = 0;
  const failed = 0;

  for (const repo of targets) {
    console.log(`Processing: ${repo.name}...`);
    const result = createUpdatePR(repo, args.file, content, title, args.dryRun);
    if (result === 'dry-run') {
      created++;
    } else if (result) {
      console.log(`  [CREATED] PR: ${result}`);
      created++;
    } else {
      skipped++;
    }
  }

  console.log(`\nDone: ${created} PR(s) created, ${skipped} skipped, ${failed} failed`);

  if (!args.dryRun && created > 0) {
    logActivity(
      'scan-and-configure',
      'cross-update',
      `Cross-repo update: ${args.file} on ${created} repos`,
      'success'
    );
  }
};

main();
