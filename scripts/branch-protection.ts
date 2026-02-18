/**
 * branch-protection.ts
 *
 * Applies branch protection rules to all repos with CI.
 * - No force push, no branch deletion
 * - Require CI status checks to pass
 * - No required PR reviews (solo dev workflow)
 *
 * Note: Branch protection only works on public repos with GitHub Free plan.
 * Private repos will be skipped with a warning.
 *
 * Run: pnpm protect-branches
 * Cron: weekly audit via GitHub Actions
 */

import { execSync } from 'node:child_process';
import { KNOWN_PROJECTS, type ProjectConfig } from '../factory.config.js';

interface RepoInfo {
  private: boolean;
  default_branch: string;
}

interface ProtectionResult {
  project: string;
  repo: string;
  branch: string;
  status: 'protected' | 'already' | 'skipped_private' | 'error';
  reason?: string;
}

const LABEL = 'branch-protection';

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30000, stdio: 'pipe' }).trim();
  } catch {
    return '';
  }
};

const shResult = (cmd: string): { ok: boolean; output: string } => {
  try {
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 30000, stdio: 'pipe' }).trim();
    return { ok: true, output };
  } catch (e: unknown) {
    const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string };
    const output = err.stderr?.toString() || err.stdout?.toString() || err.message || '';
    return { ok: false, output };
  }
};

const getRepoInfo = (repo: string): RepoInfo | null => {
  const result = sh(
    `gh api "repos/${repo}" --jq "{private: .private, default_branch: .default_branch}"`
  );
  if (!result) return null;
  try {
    return JSON.parse(result) as RepoInfo;
  } catch {
    return null;
  }
};

const isAlreadyProtected = (repo: string, branch: string): boolean => {
  const result = shResult(`gh api "repos/${repo}/branches/${branch}/protection" --jq ".url"`);
  return result.ok && !!result.output;
};

const CI_CHECK_PATTERNS = ['ci', 'build', 'test', 'lint', 'typecheck'];

const getExistingChecks = (repo: string): string[] => {
  const result = sh(
    `gh api "repos/${repo}/actions/workflows" --jq "[.workflows[].name]" 2>/dev/null`
  );
  try {
    const all = JSON.parse(result || '[]') as string[];
    return all.filter((name) => CI_CHECK_PATTERNS.some((p) => name.toLowerCase().includes(p)));
  } catch {
    return [];
  }
};

const applyProtection = (
  repo: string,
  branch: string,
  checks: string[]
): { ok: boolean; error: string } => {
  const checksJson =
    checks.length > 0
      ? `"required_status_checks": {"strict": true, "contexts": ${JSON.stringify(checks)}},`
      : '';

  const payload = `{
    ${checksJson}
    "enforce_admins": true,
    "required_pull_request_reviews": null,
    "restrictions": null,
    "allow_force_pushes": false,
    "allow_deletions": false,
    "required_linear_history": false,
    "required_conversation_resolution": false
  }`;

  const tmpFile = '/tmp/branch-protection-payload.json';
  try {
    execSync(`cat > ${tmpFile} << 'BPEOF'\n${payload}\nBPEOF`, { encoding: 'utf-8' });
  } catch {
    return { ok: false, error: 'Failed to write payload' };
  }

  const result = shResult(
    `gh api -X PUT "repos/${repo}/branches/${branch}/protection" --input ${tmpFile}`
  );

  if (!result.ok) {
    if (result.output.includes('upgrade your plan') || result.output.includes('not available')) {
      return { ok: false, error: 'Requires GitHub Pro/Team plan (private repo)' };
    }
    if (result.output.includes('Resource not accessible') || result.output.includes('403')) {
      return { ok: false, error: 'FACTORY_PAT needs "Administration: Write" permission' };
    }
    return { ok: false, error: result.output.slice(0, 200) };
  }

  return { ok: true, error: '' };
};

const processRepo = (project: ProjectConfig): ProtectionResult => {
  const info = getRepoInfo(project.repo);
  if (!info) {
    return {
      project: project.name,
      repo: project.repo,
      branch: '?',
      status: 'error',
      reason: 'Cannot fetch repo info',
    };
  }

  const branch = info.default_branch;

  // Skip private repos on Free plan
  if (info.private) {
    return {
      project: project.name,
      repo: project.repo,
      branch,
      status: 'skipped_private',
      reason: 'Private repo - requires Pro/Team plan',
    };
  }

  // Check if already protected
  if (isAlreadyProtected(project.repo, branch)) {
    return { project: project.name, repo: project.repo, branch, status: 'already' };
  }

  // Get CI workflow names for required checks
  const workflows = getExistingChecks(project.repo);

  // Apply protection
  const result = applyProtection(project.repo, branch, workflows);

  if (result.ok) {
    return { project: project.name, repo: project.repo, branch, status: 'protected' };
  }

  return {
    project: project.name,
    repo: project.repo,
    branch,
    status: 'error',
    reason: result.error,
  };
};

const main = () => {
  const factoryRepo = process.env.GITHUB_REPOSITORY ?? 'thonyAGP/DevOps-Factory';
  const ciProjects = KNOWN_PROJECTS.filter((p) => p.hasCI);

  // Also protect DevOps-Factory itself
  const devopsFactory: ProjectConfig = {
    name: 'DevOps-Factory',
    repo: 'thonyAGP/DevOps-Factory',
    hasCI: true,
    stack: 'node',
    hasQodo: false,
    hasClaude: false,
    hasSelfHealing: false,
    hasHusky: true,
    hasRenovate: false,
    hasGitleaks: false,
    hasLighthouse: false,
    hasLinkChecker: false,
    vercel: false,
  };

  const allProjects = [...ciProjects, devopsFactory];

  console.log(`\nBranch Protection Audit - ${new Date().toISOString()}`);
  console.log(`Checking ${allProjects.length} repos\n`);

  // Ensure label exists
  sh(
    `gh label create "${LABEL}" --repo ${factoryRepo} --color 0e8a16 --description "Branch protection status" 2>/dev/null`
  );

  const results: ProtectionResult[] = [];

  for (const project of allProjects) {
    process.stdout.write(`[${project.name}] `);
    const result = processRepo(project);
    results.push(result);

    switch (result.status) {
      case 'protected':
        console.log(`PROTECTED (${result.branch})`);
        break;
      case 'already':
        console.log(`OK - already protected (${result.branch})`);
        break;
      case 'skipped_private':
        console.log(`SKIPPED - private repo (${result.branch})`);
        break;
      case 'error':
        console.log(`ERROR - ${result.reason}`);
        break;
    }
  }

  // Summary
  const protected_ = results.filter((r) => r.status === 'protected' || r.status === 'already');
  const skipped = results.filter((r) => r.status === 'skipped_private');
  const errors = results.filter((r) => r.status === 'error');

  console.log('\n--- Summary ---');
  console.log(`Protected:      ${protected_.length}/${allProjects.length}`);
  if (skipped.length > 0)
    console.log(`Skipped (plan):  ${skipped.length} (upgrade to Pro for private repos)`);
  if (errors.length > 0) console.log(`Errors:          ${errors.length}`);
  console.log('');

  // Create audit issue if there are unprotected repos
  if (process.env.GITHUB_ACTIONS === 'true' && skipped.length > 0) {
    const issueBody = [
      '## Branch Protection Audit',
      '',
      `**Date**: ${new Date().toISOString()}`,
      '',
      '### Protected',
      ...protected_.map((r) => `- ${r.project} (\`${r.branch}\`)`),
      '',
      '### Not Protected (GitHub Free plan limitation)',
      ...skipped.map((r) => `- ${r.project} (\`${r.repo}\`) - private repo`),
      '',
      '> Upgrade to GitHub Pro or make repos public to enable branch protection.',
      '',
      '---',
      '*Auto-generated by DevOps Factory Branch Protection Audit.*',
    ].join('\n');

    // Check for existing open audit issue
    const existing = sh(
      `gh issue list --repo ${factoryRepo} --label "${LABEL}" --state open --json number --jq ".[0].number"`
    );

    if (existing) {
      sh(`gh issue close ${existing} --repo ${factoryRepo}`);
    }

    const tmpFile = '/tmp/branch-protection-audit.md';
    try {
      execSync(`cat > ${tmpFile} << 'AUDITEOF'\n${issueBody}\nAUDITEOF`, { encoding: 'utf-8' });
      execSync(
        `gh issue create --repo ${factoryRepo} --title "Branch Protection Audit - ${new Date().toISOString().split('T')[0]}" --body-file ${tmpFile} --label "${LABEL}"`,
        { encoding: 'utf-8', stdio: 'inherit' }
      );
    } catch {
      console.error('Failed to create audit issue');
    }
  }
};

main();
