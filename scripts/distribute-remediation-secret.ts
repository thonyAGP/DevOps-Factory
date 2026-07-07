/**
 * distribute-remediation-secret.ts
 *
 * Pushes the Claude Code OAuth token (subscription auth, no API key) as the
 * `CLAUDE_CODE_OAUTH_TOKEN` secret onto every managed repo in one pass, so you
 * don't have to click through 25 repo settings pages. `claude-code-action`
 * runs *inside* each target repo, so the secret has to live in each repo —
 * this just automates the tedium.
 *
 * The secret sitting in a repo is inert: an agent only runs there when the repo
 * is BOTH in REMEDIATION_CONFIG.enabledRepos AND has the ai-remediation.yml
 * workflow deployed. So distributing the secret broadly is safe; remediation
 * stays gated centrally.
 *
 * Security:
 * - the token is read from the env var CLAUDE_CODE_OAUTH_TOKEN, never an arg
 * - it is passed to `gh` over stdin (`--body-file -`), never on the command
 *   line (argv is visible in `ps`) and is never printed
 *
 * Usage (run locally, where `gh` is authenticated as the repo owner):
 *   export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
 *   pnpm distribute-remediation-secret                 # all managed repos
 *   pnpm distribute-remediation-secret -- --only zentra,statusline
 *   pnpm distribute-remediation-secret -- --dry-run    # list targets, set nothing
 *   pnpm distribute-remediation-secret -- --include-hidden
 */

import { execFileSync } from 'node:child_process';
import { KNOWN_PROJECTS, type ProjectConfig } from '../factory.config.js';

const SECRET_NAME = 'CLAUDE_CODE_OAUTH_TOKEN';

export interface SelectOptions {
  only?: string[]; // repo names or full names to restrict to (case-insensitive)
  includeHidden?: boolean;
}

/**
 * Pure target selection: which repos get the secret. Hidden repos are excluded
 * unless includeHidden; `only` restricts by short name or `owner/name`.
 */
export const selectSecretTargets = (
  projects: ProjectConfig[],
  opts: SelectOptions = {}
): ProjectConfig[] => {
  const only = opts.only?.map((s) => s.toLowerCase());
  return projects.filter((p) => {
    if (!opts.includeHidden && p.hidden) return false;
    if (!only || only.length === 0) return true;
    return only.includes(p.name.toLowerCase()) || only.includes(p.repo.toLowerCase());
  });
};

const parseArgs = (
  argv: string[]
): { only?: string[]; includeHidden: boolean; dryRun: boolean } => {
  const dryRun = argv.includes('--dry-run');
  const includeHidden = argv.includes('--include-hidden');
  const onlyIdx = argv.indexOf('--only');
  const only =
    onlyIdx !== -1 && argv[onlyIdx + 1]
      ? argv[onlyIdx + 1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
  return { only, includeHidden, dryRun };
};

/** Set the secret on one repo via gh, token passed over stdin. Returns true on success. */
const setSecret = (repo: string, token: string): boolean => {
  try {
    execFileSync('gh', ['secret', 'set', SECRET_NAME, '--repo', repo, '--body-file', '-'], {
      input: token,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
};

const main = (): void => {
  const { only, includeHidden, dryRun } = parseArgs(process.argv.slice(2));

  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (!dryRun) {
    if (!token) {
      console.error('✗ CLAUDE_CODE_OAUTH_TOKEN is not set. Export it first:');
      console.error('    export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...');
      process.exit(1);
    }
    if (!token.startsWith('sk-ant-oat')) {
      console.error(
        '✗ CLAUDE_CODE_OAUTH_TOKEN does not look like a subscription OAuth token ' +
          '(expected prefix sk-ant-oat…). Refusing — did you paste an API key by mistake?'
      );
      process.exit(1);
    }
  }

  const targets = selectSecretTargets(KNOWN_PROJECTS, { only, includeHidden });
  if (targets.length === 0) {
    console.log('No matching repos.');
    return;
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}Setting ${SECRET_NAME} on ${targets.length} repo(s):`);
  let ok = 0;
  const failed: string[] = [];
  for (const t of targets) {
    if (dryRun) {
      console.log(`  • ${t.repo}`);
      continue;
    }
    if (setSecret(t.repo, token as string)) {
      ok++;
      console.log(`  ✓ ${t.repo}`);
    } else {
      failed.push(t.repo);
      console.log(`  ✗ ${t.repo} (gh secret set failed — admin rights? repo exists?)`);
    }
  }

  if (!dryRun) {
    console.log(`\nDone: ${ok}/${targets.length} set.`);
    if (failed.length) {
      console.log(`Failed: ${failed.join(', ')}`);
      process.exit(1);
    }
  }
};

const isDirectRun =
  !process.env.VITEST &&
  process.argv[1]?.replace(/\\/g, '/').endsWith('distribute-remediation-secret.ts');
if (isDirectRun) main();
