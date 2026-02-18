/**
 * scan-and-configure.ts
 *
 * Scans all GitHub repos for the authenticated user,
 * detects project type, and creates PRs to add missing
 * DevOps-Factory workflows.
 *
 * Run: pnpm scan
 * Cron: every 6h via GitHub Actions
 */

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

interface Repo {
  name: string;
  full_name: string;
  default_branch: string;
  archived: boolean;
  fork: boolean;
  private: boolean;
  language: string | null;
}

interface RepoAnalysis {
  repo: Repo;
  stack: 'nextjs' | 'node' | 'dotnet' | 'unknown';
  packageManager: 'pnpm' | 'npm' | 'yarn' | 'none';
  hasClaudeReview: boolean;
  hasSelfHealing: boolean;
  hasQodoMerge: boolean;
  hasCI: boolean;
  hasGitleaks: boolean;
  hasRenovate: boolean;
  hasHusky: boolean;
  hasSemgrep: boolean;
  hasLicenseCheck: boolean;
  hasNodeVersionSync: boolean;
  hasEnvSyncCheck: boolean;
  hasOpenSpecDrift: boolean;
  hasOpenSpec: boolean;
  hasPrisma: boolean;
  hasBranchCleanup: boolean;
  hasStaleBot: boolean;
  hasPrDescriptionAI: boolean;
  hasAccessibilityCheck: boolean;
  hasDeadCodeDetection: boolean;
  hasSbomGeneration: boolean;
  hasCronMonitor: boolean;
  hasAutoLabel: boolean;
  hasCodeRabbit: boolean;
  hasMutationTesting: boolean;
  hasPerformanceBudget: boolean;
  hasTestImpactAnalysis: boolean;
  hasDevContainer: boolean;
  hasTypeCoverage: boolean;
  hasDependencySizeCheck: boolean;
  hasSupplyChainSecurity: boolean;
  hasContainerScan: boolean;
  hasSecurityHeaders: boolean;
  hasPrRiskAssessment: boolean;
  hasPrSizeLimiter: boolean;
  hasReleaseDrafter: boolean;
  hasReadmeFreshness: boolean;
  hasConfigDrift: boolean;
}

const IGNORED_REPOS = ['DevOps-Factory', 'Parametrage_Claude', 'Migration_Pc1_vers_Pc2', '.github'];

const TEMPLATES_DIR = 'templates';

const gh = (cmd: string): string => {
  try {
    return execSync(`gh ${cmd}`, { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
};

const ghJson = <T>(cmd: string): T => {
  const result = gh(cmd);
  return JSON.parse(result || '[]') as T;
};

const listRepos = (): Repo[] => {
  const repos = ghJson<Repo[]>(
    'api user/repos --paginate --jq "[.[] | {name, full_name, default_branch, archived, fork, private: .private, language}]"'
  );
  return repos.filter((r) => !r.archived && !r.fork && !IGNORED_REPOS.includes(r.name));
};

const fileExistsInRepo = (repo: string, path: string): boolean => {
  const result = gh(`api repos/${repo}/contents/${path} --jq '.name' 2>/dev/null`);
  return result.length > 0;
};

const analyzeRepo = (repo: Repo): RepoAnalysis => {
  const hasPackageJson = fileExistsInRepo(repo.full_name, 'package.json');
  const hasCsproj = repo.language === 'C#' || fileExistsInRepo(repo.full_name, '*.csproj');

  let stack: RepoAnalysis['stack'] = 'unknown';
  let packageManager: RepoAnalysis['packageManager'] = 'none';

  if (hasPackageJson) {
    const hasNextConfig =
      fileExistsInRepo(repo.full_name, 'next.config.js') ||
      fileExistsInRepo(repo.full_name, 'next.config.mjs') ||
      fileExistsInRepo(repo.full_name, 'next.config.ts');

    stack = hasNextConfig ? 'nextjs' : 'node';

    if (fileExistsInRepo(repo.full_name, 'pnpm-lock.yaml')) {
      packageManager = 'pnpm';
    } else if (fileExistsInRepo(repo.full_name, 'yarn.lock')) {
      packageManager = 'yarn';
    } else {
      packageManager = 'npm';
    }
  } else if (hasCsproj) {
    stack = 'dotnet';
  }

  const hasClaudeReview = fileExistsInRepo(repo.full_name, '.github/workflows/claude-review.yml');
  const hasSelfHealing = fileExistsInRepo(repo.full_name, '.github/workflows/self-healing.yml');
  const hasQodoMerge = fileExistsInRepo(repo.full_name, '.github/workflows/qodo-merge.yml');

  // Check for any CI workflow
  const workflowsDir = gh(
    `api repos/${repo.full_name}/contents/.github/workflows --jq '.[].name' 2>/dev/null`
  );
  const hasCI =
    workflowsDir.includes('ci.yml') ||
    workflowsDir.includes('CI') ||
    workflowsDir.includes('build') ||
    workflowsDir.includes('test');
  const hasGitleaks = workflowsDir.includes('gitleaks') || workflowsDir.includes('secret');
  const hasRenovate =
    fileExistsInRepo(repo.full_name, 'renovate.json') ||
    fileExistsInRepo(repo.full_name, '.github/renovate.json');
  const hasHusky = fileExistsInRepo(repo.full_name, '.husky/pre-commit');
  const hasSemgrep = workflowsDir.includes('semgrep') || workflowsDir.includes('sast');
  const hasLicenseCheck = workflowsDir.includes('license');
  const hasNodeVersionSync = workflowsDir.includes('node-version-sync');
  const hasEnvSyncCheck = workflowsDir.includes('env-sync');
  const hasOpenSpecDrift = workflowsDir.includes('openspec-drift');
  const hasOpenSpec = fileExistsInRepo(repo.full_name, '.openspec/spec.md');
  const hasPrisma = fileExistsInRepo(repo.full_name, 'prisma/schema.prisma');
  const hasBranchCleanup =
    workflowsDir.includes('branch-cleanup') || workflowsDir.includes('cleanup');
  const hasStaleBot = workflowsDir.includes('stale');
  const hasPrDescriptionAI = workflowsDir.includes('pr-description');
  const hasAccessibilityCheck =
    workflowsDir.includes('accessibility') || workflowsDir.includes('a11y');
  const hasDeadCodeDetection = workflowsDir.includes('dead-code') || workflowsDir.includes('knip');
  const hasSbomGeneration = workflowsDir.includes('sbom');
  const hasCronMonitor = workflowsDir.includes('cron-monitor');
  const hasAutoLabel = workflowsDir.includes('auto-label') || workflowsDir.includes('labeler');
  const hasCodeRabbit =
    fileExistsInRepo(repo.full_name, '.coderabbit.yaml') ||
    fileExistsInRepo(repo.full_name, '.coderabbit.yml');
  const hasMutationTesting = workflowsDir.includes('mutation') || workflowsDir.includes('stryker');
  const hasPerformanceBudget =
    workflowsDir.includes('performance-budget') || workflowsDir.includes('bundle-size');
  const hasTestImpactAnalysis =
    workflowsDir.includes('test-impact') || workflowsDir.includes('affected-test');
  const hasDevContainer = fileExistsInRepo(repo.full_name, '.devcontainer/devcontainer.json');
  const hasTypeCoverage = workflowsDir.includes('type-coverage');
  const hasDependencySizeCheck =
    workflowsDir.includes('dependency-size') || workflowsDir.includes('dep-size');
  const hasSupplyChainSecurity = workflowsDir.includes('supply-chain');
  const hasContainerScan =
    workflowsDir.includes('container-scan') || workflowsDir.includes('trivy');
  const hasSecurityHeaders = workflowsDir.includes('security-headers');
  const hasPrRiskAssessment =
    workflowsDir.includes('pr-risk') || workflowsDir.includes('risk-assessment');
  const hasPrSizeLimiter = workflowsDir.includes('pr-size');
  const hasReleaseDrafter = workflowsDir.includes('release-drafter');
  const hasReadmeFreshness = workflowsDir.includes('readme-freshness');
  const hasConfigDrift = workflowsDir.includes('config-drift');

  return {
    repo,
    stack,
    packageManager,
    hasClaudeReview,
    hasSelfHealing,
    hasQodoMerge,
    hasCI,
    hasGitleaks,
    hasRenovate,
    hasHusky,
    hasSemgrep,
    hasLicenseCheck,
    hasNodeVersionSync,
    hasEnvSyncCheck,
    hasOpenSpecDrift,
    hasOpenSpec,
    hasPrisma,
    hasBranchCleanup,
    hasStaleBot,
    hasPrDescriptionAI,
    hasAccessibilityCheck,
    hasDeadCodeDetection,
    hasSbomGeneration,
    hasCronMonitor,
    hasAutoLabel,
    hasCodeRabbit,
    hasMutationTesting,
    hasPerformanceBudget,
    hasTestImpactAnalysis,
    hasDevContainer,
    hasTypeCoverage,
    hasDependencySizeCheck,
    hasSupplyChainSecurity,
    hasContainerScan,
    hasSecurityHeaders,
    hasPrRiskAssessment,
    hasPrSizeLimiter,
    hasReleaseDrafter,
    hasReadmeFreshness,
    hasConfigDrift,
  };
};

const createConfigPR = (analysis: RepoAnalysis): void => {
  const { repo } = analysis;
  const branchName = `devops-factory/add-workflows`;
  const filesToAdd: { path: string; template: string }[] = [];

  if (!analysis.hasCI && analysis.stack !== 'unknown') {
    filesToAdd.push({
      path: '.github/workflows/ci.yml',
      template: `${TEMPLATES_DIR}/ci-standard.yml`,
    });
  }

  if (!analysis.hasClaudeReview && analysis.stack !== 'unknown') {
    filesToAdd.push({
      path: '.github/workflows/claude-review.yml',
      template: `${TEMPLATES_DIR}/claude-review.yml`,
    });
  }

  if (!analysis.hasSelfHealing && analysis.stack !== 'unknown') {
    filesToAdd.push({
      path: '.github/workflows/self-healing.yml',
      template: `${TEMPLATES_DIR}/self-healing.yml`,
    });
  }

  if (!analysis.hasQodoMerge && analysis.stack !== 'unknown') {
    filesToAdd.push({
      path: '.github/workflows/qodo-merge.yml',
      template: `${TEMPLATES_DIR}/qodo-merge.yml`,
    });
  }

  if (!analysis.hasGitleaks && analysis.stack !== 'unknown') {
    filesToAdd.push({
      path: '.github/workflows/gitleaks.yml',
      template: `${TEMPLATES_DIR}/gitleaks.yml`,
    });
  }

  if (!analysis.hasRenovate && analysis.stack !== 'unknown') {
    filesToAdd.push({
      path: 'renovate.json',
      template: `${TEMPLATES_DIR}/renovate.json`,
    });
  }

  // Semgrep SAST for Node.js projects
  if (!analysis.hasSemgrep && (analysis.stack === 'node' || analysis.stack === 'nextjs')) {
    filesToAdd.push({
      path: '.github/workflows/semgrep.yml',
      template: `${TEMPLATES_DIR}/semgrep.yml`,
    });
  }

  // License compliance check for Node.js projects
  if (!analysis.hasLicenseCheck && (analysis.stack === 'node' || analysis.stack === 'nextjs')) {
    filesToAdd.push({
      path: '.github/workflows/license-check.yml',
      template: `${TEMPLATES_DIR}/license-check.yml`,
    });
  }

  // Node.js version sync
  if (!analysis.hasNodeVersionSync && (analysis.stack === 'node' || analysis.stack === 'nextjs')) {
    filesToAdd.push({
      path: '.github/workflows/node-version-sync.yml',
      template: `${TEMPLATES_DIR}/node-version-sync.yml`,
    });
  }

  // .env sync check
  if (!analysis.hasEnvSyncCheck && (analysis.stack === 'node' || analysis.stack === 'nextjs')) {
    filesToAdd.push({
      path: '.github/workflows/env-sync-check.yml',
      template: `${TEMPLATES_DIR}/env-sync-check.yml`,
    });
  }

  // OpenSpec drift detection (only for repos with .openspec)
  if (!analysis.hasOpenSpecDrift && analysis.hasOpenSpec) {
    filesToAdd.push({
      path: '.github/workflows/openspec-drift.yml',
      template: `${TEMPLATES_DIR}/openspec-drift.yml`,
    });
  }

  // Prisma migration safety check
  if (analysis.hasPrisma && analysis.stack !== 'unknown') {
    const hasPrismaMigCheck = fileExistsInRepo(
      analysis.repo.full_name,
      '.github/workflows/prisma-migration-check.yml'
    );
    if (!hasPrismaMigCheck) {
      filesToAdd.push({
        path: '.github/workflows/prisma-migration-check.yml',
        template: `${TEMPLATES_DIR}/prisma-migration-check.yml`,
      });
    }
  }

  // Husky hooks for Node.js projects
  if (!analysis.hasHusky && (analysis.stack === 'node' || analysis.stack === 'nextjs')) {
    filesToAdd.push(
      {
        path: '.husky/pre-commit',
        template: `${TEMPLATES_DIR}/husky/pre-commit`,
      },
      {
        path: '.husky/commit-msg',
        template: `${TEMPLATES_DIR}/husky/commit-msg`,
      },
      {
        path: 'commitlint.config.js',
        template: `${TEMPLATES_DIR}/husky/commitlint.config.js`,
      }
    );
  }

  // Phase 3: Branch & artifact cleanup
  if (!analysis.hasBranchCleanup && analysis.stack !== 'unknown') {
    filesToAdd.push({
      path: '.github/workflows/branch-cleanup.yml',
      template: `${TEMPLATES_DIR}/branch-cleanup.yml`,
    });
  }

  // Phase 3: Stale issue/PR bot
  if (!analysis.hasStaleBot && analysis.stack !== 'unknown') {
    filesToAdd.push({
      path: '.github/workflows/stale-bot.yml',
      template: `${TEMPLATES_DIR}/stale-bot.yml`,
    });
  }

  // Phase 3: AI PR description
  if (!analysis.hasPrDescriptionAI && analysis.stack !== 'unknown') {
    filesToAdd.push({
      path: '.github/workflows/pr-description-ai.yml',
      template: `${TEMPLATES_DIR}/pr-description-ai.yml`,
    });
  }

  // Wave 1: Accessibility check (frontend projects only)
  if (!analysis.hasAccessibilityCheck && analysis.stack === 'nextjs') {
    filesToAdd.push({
      path: '.github/workflows/accessibility-check.yml',
      template: `${TEMPLATES_DIR}/accessibility-check.yml`,
    });
  }

  // Wave 1: Dead code detection (Node.js projects)
  if (
    !analysis.hasDeadCodeDetection &&
    (analysis.stack === 'node' || analysis.stack === 'nextjs')
  ) {
    filesToAdd.push({
      path: '.github/workflows/dead-code-detection.yml',
      template: `${TEMPLATES_DIR}/dead-code-detection.yml`,
    });
  }

  // Wave 1: SBOM generation (all projects with code)
  if (!analysis.hasSbomGeneration && analysis.stack !== 'unknown') {
    filesToAdd.push({
      path: '.github/workflows/sbom-generation.yml',
      template: `${TEMPLATES_DIR}/sbom-generation.yml`,
    });
  }

  // Wave 1: Cron job monitor (all projects)
  if (!analysis.hasCronMonitor && analysis.stack !== 'unknown') {
    filesToAdd.push({
      path: '.github/workflows/cron-monitor.yml',
      template: `${TEMPLATES_DIR}/cron-monitor.yml`,
    });
  }

  // Wave 1: Auto PR labels (all projects)
  if (!analysis.hasAutoLabel && analysis.stack !== 'unknown') {
    filesToAdd.push(
      {
        path: '.github/workflows/auto-label.yml',
        template: `${TEMPLATES_DIR}/auto-label.yml`,
      },
      {
        path: '.github/labeler.yml',
        template: `${TEMPLATES_DIR}/labeler.yml`,
      }
    );
  }

  // Wave 2: CodeRabbit config (all projects)
  if (!analysis.hasCodeRabbit && analysis.stack !== 'unknown') {
    filesToAdd.push({
      path: '.coderabbit.yaml',
      template: `${TEMPLATES_DIR}/coderabbit.yaml`,
    });
  }

  // Wave 2: Mutation testing (Node.js projects with tests)
  if (!analysis.hasMutationTesting && (analysis.stack === 'node' || analysis.stack === 'nextjs')) {
    filesToAdd.push({
      path: '.github/workflows/mutation-testing.yml',
      template: `${TEMPLATES_DIR}/mutation-testing.yml`,
    });
  }

  // Wave 2: Performance budget (frontend projects)
  if (!analysis.hasPerformanceBudget && analysis.stack === 'nextjs') {
    filesToAdd.push({
      path: '.github/workflows/performance-budget.yml',
      template: `${TEMPLATES_DIR}/performance-budget.yml`,
    });
  }

  // Wave 2: Test impact analysis (Node.js projects)
  if (
    !analysis.hasTestImpactAnalysis &&
    (analysis.stack === 'node' || analysis.stack === 'nextjs')
  ) {
    filesToAdd.push({
      path: '.github/workflows/test-impact-analysis.yml',
      template: `${TEMPLATES_DIR}/test-impact-analysis.yml`,
    });
  }

  // Wave 2: Dev container (all projects)
  if (!analysis.hasDevContainer && analysis.stack !== 'unknown') {
    filesToAdd.push({
      path: '.devcontainer/devcontainer.json',
      template: `${TEMPLATES_DIR}/devcontainer/devcontainer.json`,
    });
  }

  // Wave 3: Type coverage (Node.js/TS projects)
  if (!analysis.hasTypeCoverage && (analysis.stack === 'node' || analysis.stack === 'nextjs')) {
    filesToAdd.push({
      path: '.github/workflows/type-coverage.yml',
      template: `${TEMPLATES_DIR}/type-coverage.yml`,
    });
  }

  // Wave 3: Dependency size check (Node.js projects)
  if (
    !analysis.hasDependencySizeCheck &&
    (analysis.stack === 'node' || analysis.stack === 'nextjs')
  ) {
    filesToAdd.push({
      path: '.github/workflows/dependency-size-check.yml',
      template: `${TEMPLATES_DIR}/dependency-size-check.yml`,
    });
  }

  // Wave 3: Supply chain security (Node.js projects)
  if (
    !analysis.hasSupplyChainSecurity &&
    (analysis.stack === 'node' || analysis.stack === 'nextjs')
  ) {
    filesToAdd.push({
      path: '.github/workflows/supply-chain-security.yml',
      template: `${TEMPLATES_DIR}/supply-chain-security.yml`,
    });
  }

  // Wave 3: Container scanning (projects with Dockerfile)
  if (!analysis.hasContainerScan && analysis.stack !== 'unknown') {
    filesToAdd.push({
      path: '.github/workflows/container-scan.yml',
      template: `${TEMPLATES_DIR}/container-scan.yml`,
    });
  }

  // Wave 3: Security headers (frontend/web projects)
  if (!analysis.hasSecurityHeaders && analysis.stack === 'nextjs') {
    filesToAdd.push({
      path: '.github/workflows/security-headers.yml',
      template: `${TEMPLATES_DIR}/security-headers.yml`,
    });
  }

  // Wave 3: PR risk assessment (all projects)
  if (!analysis.hasPrRiskAssessment && analysis.stack !== 'unknown') {
    filesToAdd.push({
      path: '.github/workflows/pr-risk-assessment.yml',
      template: `${TEMPLATES_DIR}/pr-risk-assessment.yml`,
    });
  }

  // Wave 3: PR size limiter (all projects)
  if (!analysis.hasPrSizeLimiter && analysis.stack !== 'unknown') {
    filesToAdd.push({
      path: '.github/workflows/pr-size-limiter.yml',
      template: `${TEMPLATES_DIR}/pr-size-limiter.yml`,
    });
  }

  // Wave 3: Release drafter (all projects)
  if (!analysis.hasReleaseDrafter && analysis.stack !== 'unknown') {
    filesToAdd.push(
      {
        path: '.github/workflows/release-drafter.yml',
        template: `${TEMPLATES_DIR}/release-drafter.yml`,
      },
      {
        path: '.github/release-drafter-config.yml',
        template: `${TEMPLATES_DIR}/release-drafter-config.yml`,
      }
    );
  }

  // Wave 3: README freshness (all projects)
  if (!analysis.hasReadmeFreshness && analysis.stack !== 'unknown') {
    filesToAdd.push({
      path: '.github/workflows/readme-freshness.yml',
      template: `${TEMPLATES_DIR}/readme-freshness.yml`,
    });
  }

  // Wave 3: Config drift detector (Node.js projects)
  if (!analysis.hasConfigDrift && (analysis.stack === 'node' || analysis.stack === 'nextjs')) {
    filesToAdd.push({
      path: '.github/workflows/config-drift.yml',
      template: `${TEMPLATES_DIR}/config-drift.yml`,
    });
  }

  if (filesToAdd.length === 0) {
    console.log(`  [SKIP] ${repo.name}: all workflows present`);
    return;
  }

  // Check if PR already exists
  const existingPR = gh(
    `pr list --repo ${repo.full_name} --head ${branchName} --json number --jq '.[0].number'`
  );
  if (existingPR) {
    console.log(`  [SKIP] ${repo.name}: PR #${existingPR} already exists`);
    return;
  }

  console.log(`  [CREATE] ${repo.name}: adding ${filesToAdd.length} workflow(s)`);

  // Create branch and add files via GitHub API (no local clone needed)
  const defaultBranch = repo.default_branch;
  const baseSha = gh(
    `api repos/${repo.full_name}/git/ref/heads/${defaultBranch} --jq '.object.sha'`
  );

  if (!baseSha) {
    console.log(`  [ERROR] ${repo.name}: cannot get base SHA`);
    return;
  }

  // Create branch
  gh(
    `api repos/${repo.full_name}/git/refs --method POST -f ref="refs/heads/${branchName}" -f sha="${baseSha}" 2>/dev/null`
  );

  // Add each file
  for (const file of filesToAdd) {
    const content = execSync(`base64 -w 0 ${file.template}`, {
      encoding: 'utf-8',
    }).trim();

    gh(
      `api repos/${repo.full_name}/contents/${file.path} --method PUT -f message="chore: add ${file.path} from DevOps-Factory" -f content="${content}" -f branch="${branchName}"`
    );
  }

  // Create PR
  const fileList = filesToAdd.map((f) => `- \`${f.path}\``).join('\n');
  gh(
    `pr create --repo ${repo.full_name} --head ${branchName} --base ${defaultBranch} --title "chore: add DevOps-Factory AI workflows" --body "## DevOps-Factory Auto-Configuration

### Added workflows
${fileList}

### What this enables
- **CI Pipeline**: Lint, typecheck, test, build on every push/PR
- **Claude Code Review**: AI review on every PR (Haiku for speed, Sonnet for complex changes)
- **Self-Healing CI**: Automatic fix PRs when CI fails on main
- **Qodo Merge**: Complementary AI review via Gemini
- **Secret Scanning**: Gitleaks detects exposed API keys and tokens
- **Renovate**: Automated dependency updates (patches automerged)
- **Husky Hooks**: Pre-commit (lint-staged) + commit-msg (commitlint)
- **Semgrep SAST**: Security scanning for OWASP Top 10 vulnerabilities
- **License Check**: Detects copyleft (GPL/AGPL) dependencies
- **Node Version Sync**: Ensures consistent Node.js version across configs
- **.env Sync**: Validates .env.example stays in sync with code usage
- **OpenSpec Drift**: Detects code changes without spec updates
- **Prisma Migration Safety**: Warns on destructive migration operations
- **Branch Cleanup**: Weekly cleanup of merged branches and old artifacts
- **Stale Bot**: Auto-closes inactive issues/PRs after 30 days
- **PR Description AI**: Auto-generates PR descriptions from diff analysis
- **Accessibility Check**: WCAG 2.1 AA scanning with axe-core/pa11y
- **Dead Code Detection**: Knip finds unused files, exports, dependencies
- **SBOM Generation**: Software Bill of Materials for EU compliance
- **Cron Monitor**: Alerts when scheduled workflows fail
- **Auto PR Labels**: Labels PRs by changed paths + size (S/M/L/XL)
- **CodeRabbit AI Review**: Automated code review with path-specific rules
- **Mutation Testing**: Stryker verifies test suite effectiveness weekly
- **Performance Budget**: Bundle size tracking with 500KB JS budget on PRs
- **Test Impact Analysis**: Only runs tests affected by changed files
- **Dev Container**: Standardized dev environment (Node 20, extensions, auto-setup)
- **Type Coverage**: Blocks PRs introducing \`any\` types, tracks strict coverage
- **Dependency Size Check**: Alerts when new deps exceed 50KB gzip
- **Supply Chain Security**: npm audit + signature verification + malicious pkg detection
- **Container Scan**: Trivy vulnerability scanning for Docker images
- **Security Headers**: Weekly HSTS/CSP/X-Frame-Options validation
- **PR Risk Assessment**: Scores PR risk (size, critical files, test ratio)
- **PR Size Limiter**: Warns on large PRs (>400 lines)
- **Release Drafter**: Auto-generates release notes from merged PRs
- **README Freshness**: Monthly check for stale README content
- **Config Drift**: Detects divergence from standard configs (tsconfig, eslint, prettier)

### Required secrets
Make sure these secrets are configured in your repo settings:
- \\\`ANTHROPIC_API_KEY\\\`: For Claude Code reviews
- \\\`OPENAI_KEY\\\`: For Qodo Merge (or configure Gemini)

> Auto-generated by [DevOps-Factory](https://github.com/thonyAGP/DevOps-Factory)"`
  );
};

const generateReport = (analyses: RepoAnalysis[]): string => {
  const timestamp = new Date().toISOString();
  const active = analyses.filter((a) => a.stack !== 'unknown');
  const configured = active.filter((a) => a.hasClaudeReview && a.hasSelfHealing);

  let report = `# DevOps-Factory Scan Report\n\n`;
  report += `**Date**: ${timestamp}\n`;
  report += `**Total repos**: ${analyses.length}\n`;
  report += `**Active projects**: ${active.length}\n`;
  report += `**Fully configured**: ${configured.length}/${active.length}\n\n`;

  report += `| Repo | Stack | CI | Claude | SAST | Supply | Types | Risk | Drift | Release |\n`;
  report += `|------|-------|----|--------|------|--------|-------|------|-------|---------|\n`;

  for (const a of analyses.sort((x, y) => x.repo.name.localeCompare(y.repo.name))) {
    const ci = a.hasCI ? 'Y' : '-';
    const claude = a.hasClaudeReview ? 'Y' : '-';
    const sast = a.hasSemgrep ? 'Y' : '-';
    const supply = a.hasSupplyChainSecurity ? 'Y' : '-';
    const types = a.hasTypeCoverage ? 'Y' : '-';
    const risk = a.hasPrRiskAssessment ? 'Y' : '-';
    const drift = a.hasConfigDrift ? 'Y' : '-';
    const release = a.hasReleaseDrafter ? 'Y' : '-';
    report += `| ${a.repo.name} | ${a.stack} | ${ci} | ${claude} | ${sast} | ${supply} | ${types} | ${risk} | ${drift} | ${release} |\n`;
  }

  return report;
};

// Main execution
const main = () => {
  console.log('DevOps-Factory: Scanning repos...\n');

  const repos = listRepos();
  console.log(`Found ${repos.length} repos (excluding ignored)\n`);

  const analyses: RepoAnalysis[] = [];

  for (const repo of repos) {
    console.log(`Analyzing: ${repo.name} (${repo.language || 'unknown'})...`);
    const analysis = analyzeRepo(repo);
    analyses.push(analysis);

    if (analysis.stack !== 'unknown') {
      createConfigPR(analysis);
    } else {
      console.log(`  [SKIP] ${repo.name}: no detectable project stack`);
    }
  }

  const report = generateReport(analyses);
  console.log('\n' + report);

  // Write report to file for dashboard consumption
  writeFileSync(
    'dashboard/scan-report.json',
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        analyses: analyses.map((a) => ({
          name: a.repo.name,
          fullName: a.repo.full_name,
          stack: a.stack,
          packageManager: a.packageManager,
          hasCI: a.hasCI,
          hasClaudeReview: a.hasClaudeReview,
          hasSelfHealing: a.hasSelfHealing,
          hasQodoMerge: a.hasQodoMerge,
          hasGitleaks: a.hasGitleaks,
          hasRenovate: a.hasRenovate,
          hasHusky: a.hasHusky,
          hasSemgrep: a.hasSemgrep,
          hasLicenseCheck: a.hasLicenseCheck,
          hasNodeVersionSync: a.hasNodeVersionSync,
          hasEnvSyncCheck: a.hasEnvSyncCheck,
          hasOpenSpecDrift: a.hasOpenSpecDrift,
          hasOpenSpec: a.hasOpenSpec,
          hasPrisma: a.hasPrisma,
          hasBranchCleanup: a.hasBranchCleanup,
          hasStaleBot: a.hasStaleBot,
          hasPrDescriptionAI: a.hasPrDescriptionAI,
          hasAccessibilityCheck: a.hasAccessibilityCheck,
          hasDeadCodeDetection: a.hasDeadCodeDetection,
          hasSbomGeneration: a.hasSbomGeneration,
          hasCronMonitor: a.hasCronMonitor,
          hasAutoLabel: a.hasAutoLabel,
          hasCodeRabbit: a.hasCodeRabbit,
          hasMutationTesting: a.hasMutationTesting,
          hasPerformanceBudget: a.hasPerformanceBudget,
          hasTestImpactAnalysis: a.hasTestImpactAnalysis,
          hasDevContainer: a.hasDevContainer,
          hasTypeCoverage: a.hasTypeCoverage,
          hasDependencySizeCheck: a.hasDependencySizeCheck,
          hasSupplyChainSecurity: a.hasSupplyChainSecurity,
          hasContainerScan: a.hasContainerScan,
          hasSecurityHeaders: a.hasSecurityHeaders,
          hasPrRiskAssessment: a.hasPrRiskAssessment,
          hasPrSizeLimiter: a.hasPrSizeLimiter,
          hasReleaseDrafter: a.hasReleaseDrafter,
          hasReadmeFreshness: a.hasReadmeFreshness,
          hasConfigDrift: a.hasConfigDrift,
          defaultBranch: a.repo.default_branch,
        })),
      },
      null,
      2
    )
  );
};

main();
