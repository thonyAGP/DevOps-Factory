/**
 * retire-private-workflows.ts
 *
 * Minutes-policy enforcement (the "Factory is the fleet's only Actions
 * consumer" doctrine): private repos share one 2000 free-min/month pool, and
 * the ~30 per-repo workflows historically deployed by scan-and-configure fire
 * on every push/PR — central Renovate's daily PRs alone can burn the whole
 * pool. This script removes those workflows from PRIVATE repos via one
 * cleanup PR per repo; their jobs are covered centrally (central-scan,
 * central-coverage, central renovate, self-heal, claude-review) or dropped.
 *
 * Safety:
 * - only files in FACTORY_RETIRED_WORKFLOWS are ever touched — a repo's own
 *   hand-written workflows are invisible to this script
 * - PRIVATE repos only (public repos have unlimited free minutes)
 * - one PR per repo, for human review — nothing is pushed to default branches
 * - --dry-run (default in CI) lists deletions without acting
 *
 * Usage: pnpm retire-private-workflows [-- --dry-run] [-- --only casasync]
 */

import { writeFileSync, unlinkSync } from 'node:fs';
import { KNOWN_PROJECTS, PRIVATE_WORKFLOW_ALLOWLIST } from '../factory.config.js';
import { logActivity } from './activity-logger.js';
import { sh, tmpDir } from './shell-utils.js';

/**
 * Every workflow file the Factory has ever deployed to managed repos and that
 * must NOT live in a private repo. Kept explicit (not derived) because this
 * drives deletions: anything absent from this list is never touched.
 */
export const FACTORY_RETIRED_WORKFLOWS: readonly string[] = [
  'accessibility-check.yml',
  'auto-codeowners.yml',
  'auto-label.yml',
  'auto-test-gen.yml',
  'branch-cleanup.yml',
  'business-metrics.yml',
  'claude-review.yml',
  'claude-usage-roi.yml',
  'competitive-analysis.yml',
  'config-drift.yml',
  'container-scan.yml',
  'coverage-gate.yml',
  'cron-monitor.yml',
  'dead-code-detection.yml',
  'dependency-size-check.yml',
  'env-sync-check.yml',
  'gitleaks.yml',
  'license-check.yml',
  'lighthouse.yml',
  'link-checker.yml',
  'mutation-testing.yml',
  'node-version-sync.yml',
  'openspec-drift.yml',
  'performance-budget.yml',
  'pr-description-ai.yml',
  'pr-risk-assessment.yml',
  'pr-size-limiter.yml',
  'qodo-merge.yml',
  'readme-freshness.yml',
  'sbom-generation.yml',
  'security-headers.yml',
  'self-healing.yml',
  'semgrep.yml',
  'seo-check.yml',
  'ssl-check.yml',
  'supply-chain-security.yml',
  'test-impact-analysis.yml',
  'type-coverage.yml',
  'typedoc-gen.yml',
  'uptime-monitor.yml',
  'weekly-digest.yml',
];

export interface RemoteWorkflowFile {
  name: string;
  sha: string;
}

/**
 * Pure selection: which of a repo's workflow files must be retired.
 * Intersection with the explicit retired list, minus the allowlist (defense
 * in depth — a file can never be both, but the invariant is cheap to hold).
 */
export const selectRetireTargets = (
  files: RemoteWorkflowFile[],
  retired: readonly string[] = FACTORY_RETIRED_WORKFLOWS,
  allowlist: readonly string[] = PRIVATE_WORKFLOW_ALLOWLIST
): RemoteWorkflowFile[] => {
  const allowNames = new Set(allowlist.map((p) => p.split('/').pop() as string));
  const retiredSet = new Set(retired);
  return files.filter((f) => retiredSet.has(f.name) && !allowNames.has(f.name));
};

const ghJson = <T>(cmd: string): T | null => {
  const out = sh(`gh ${cmd}`, { maxBuffer: 10 * 1024 * 1024 });
  if (!out) return null;
  try {
    return JSON.parse(out) as T;
  } catch {
    return null;
  }
};

const listWorkflowFiles = (repo: string): RemoteWorkflowFile[] => {
  const files = ghJson<{ name: string; sha: string; type: string }[]>(
    `api "repos/${repo}/contents/.github/workflows" 2>/dev/null`
  );
  if (!Array.isArray(files)) return [];
  return files.filter((f) => f.type === 'file').map((f) => ({ name: f.name, sha: f.sha }));
};

const isPrivateRepo = (repo: string): boolean =>
  sh(`gh api "repos/${repo}" --jq .private`) === 'true';

const BRANCH = 'devops-factory/retire-private-workflows';

const createRetirePR = (repo: string, targets: RemoteWorkflowFile[]): string | null => {
  const defaultBranch = sh(`gh api "repos/${repo}" --jq .default_branch`) || 'main';
  const baseSha = sh(`gh api "repos/${repo}/git/ref/heads/${defaultBranch}" --jq .object.sha`);
  if (!baseSha) return null;

  const branchRef = sh(
    `gh api "repos/${repo}/git/refs" -f ref="refs/heads/${BRANCH}" -f sha="${baseSha}" 2>&1`
  );
  if (!branchRef.includes(BRANCH)) return null;

  let deleted = 0;
  for (const t of targets) {
    const res = sh(
      `gh api -X DELETE "repos/${repo}/contents/.github/workflows/${t.name}" ` +
        `-f message="chore: retire ${t.name} (covered by the central factory)" ` +
        `-f sha="${t.sha}" -f branch="${BRANCH}"`
    );
    if (res.includes('commit')) deleted++;
  }
  if (deleted === 0) return null;

  const names = targets.map((t) => `- \`${t.name}\``).join('\n');
  const body =
    `Retire les workflows par-repo couverts par l'usine centrale (repo public → minutes illimitées), ` +
    `pour que ce repo privé ne consomme plus le pool 2000 min/mois :\n\n${names}\n\n` +
    `Couverture centrale : sécurité/duplication → Central Security Scan (hebdo), ` +
    `couverture → Central Coverage (hebdo), dépendances → Central Renovate (quotidien), ` +
    `self-heal & review → workflows Factory. Restent ici : la CI, auto-merge-deps et ` +
    `l'agent de remédiation (dispatch uniquement).\n\n*Généré par DevOps-Factory (minutes policy)*`;
  // Body goes through a file: inline shell strings would let the markdown
  // backticks be executed as command substitutions.
  const bodyFile = `${tmpDir}/retire-body-${targets[0].sha.slice(0, 8)}.md`;
  writeFileSync(bodyFile, body);
  const pr = sh(
    `gh pr create --repo ${repo} --head ${BRANCH} --base ${defaultBranch} ` +
      `--title "chore: retirer les workflows couverts par l'usine centrale (économie de minutes)" ` +
      `--body-file "${bodyFile}"`
  );
  try {
    unlinkSync(bodyFile);
  } catch {
    /* best effort */
  }
  return pr.match(/(https:\/\/[^\s]+)/)?.[1] || null;
};

const main = (): void => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const onlyIdx = args.indexOf('--only');
  const only =
    onlyIdx !== -1 && args[onlyIdx + 1]
      ? args[onlyIdx + 1].split(',').map((s) => s.trim().toLowerCase())
      : null;

  const projects = KNOWN_PROJECTS.filter((p) => !p.hidden).filter(
    (p) =>
      !only ||
      only.includes(p.name.toLowerCase()) ||
      only.includes(p.repo.toLowerCase()) ||
      only.includes(p.repo.split('/')[1].toLowerCase())
  );

  let totalFiles = 0;
  let prs = 0;
  for (const project of projects) {
    if (!isPrivateRepo(project.repo)) {
      console.log(`  [SKIP] ${project.name}: public (free minutes)`);
      continue;
    }
    const files = listWorkflowFiles(project.repo);
    const targets = selectRetireTargets(files);
    if (targets.length === 0) {
      console.log(`  [OK]   ${project.name}: nothing to retire`);
      continue;
    }
    totalFiles += targets.length;
    console.log(
      `  [${dryRun ? 'DRY' : 'PR '}]  ${project.name}: ${targets.length} workflow(s) → ${targets
        .map((t) => t.name)
        .join(', ')}`
    );
    if (dryRun) continue;

    const url = createRetirePR(project.repo, targets);
    if (url) {
      prs++;
      console.log(`         PR: ${url}`);
      logActivity(
        'redeploy-templates',
        'retire-workflows',
        `${targets.length} workflow(s) retired`,
        'warning',
        project.name
      );
    } else {
      console.log(`         [WARN] PR creation failed (branch already exists?)`);
    }
  }

  console.log(
    `\n${dryRun ? '[dry-run] ' : ''}${totalFiles} workflow file(s) across fleet${
      dryRun ? ' would be retired' : `, ${prs} PR(s) opened`
    }.`
  );
};

const isDirectRun =
  !process.env.VITEST &&
  process.argv[1]?.replace(/\\/g, '/').endsWith('retire-private-workflows.ts');
if (isDirectRun) main();
