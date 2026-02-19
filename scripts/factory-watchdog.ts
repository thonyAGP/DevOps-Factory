/**
 * factory-watchdog.ts
 *
 * Monitors all DevOps-Factory workflows for total and partial failures.
 * Detects "hidden" failures where the workflow exits 0 but logs contain
 * error patterns (e.g. shell escaping bugs, provider timeouts).
 *
 * Run: pnpm watchdog
 * Cron: every 6h via GitHub Actions
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';

// Partial failure patterns split into healable (code bugs) vs informational (env/transient)
const HEALABLE_PATTERNS = [
  'All providers failed',
  '/bin/sh:',
  'Failed to upload',
  'Cannot find module',
  'Failed to create PR',
  'All uploads failed',
];

const INFORMATIONAL_PATTERNS = [
  'ETIMEDOUT',
  'ECONNREFUSED',
  'rate limit exceeded',
  'Could not resolve host',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'gh: not found',
];

const ALL_PARTIAL_PATTERNS = [...HEALABLE_PATTERNS, ...INFORMATIONAL_PATTERNS];

const COOLDOWN_PATH = 'data/self-heal-cooldowns.json';
const FACTORY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Workflows where failures should trigger self-heal
const SELF_HEALABLE_WORKFLOWS = [
  'Factory CI',
  'CI Health Check',
  'Quality Score',
  'Coverage Audit',
  'AI Test Writer',
  'Dependency Intelligence',
  'Feedback Collector',
  'Test Scaffold',
  'Coverage Baseline',
];

const LABEL = 'factory-watchdog';

interface WorkflowRun {
  id: number;
  name: string;
  conclusion: string | null;
  status: string;
  html_url: string;
  created_at: string;
  head_branch: string;
}

interface WatchdogResult {
  workflow: string;
  status: 'pass' | 'total_failure' | 'partial_failure' | 'no_runs';
  run: WorkflowRun | null;
  patterns: string[];
}

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 60000, maxBuffer: 5 * 1024 * 1024 }).trim();
  } catch {
    return '';
  }
};

const getLatestRunSimple = (repo: string): WorkflowRun[] => {
  const result = sh(
    `gh api "repos/${repo}/actions/runs?per_page=30&status=completed" --jq "[.workflow_runs[:30] | .[] | {id, name, conclusion, status, html_url, created_at, head_branch}]"`
  );
  try {
    return JSON.parse(result || '[]') as WorkflowRun[];
  } catch {
    return [];
  }
};

const getRunLogs = (repo: string, runId: number): string => {
  return sh(`gh run view ${runId} --repo ${repo} --log 2>&1 | tail -200`);
};

const detectPartialFailures = (logs: string): string[] => {
  return ALL_PARTIAL_PATTERNS.filter((pattern) =>
    logs.toLowerCase().includes(pattern.toLowerCase())
  );
};

const hasHealablePatterns = (patterns: string[]): boolean => {
  return patterns.some((p) => HEALABLE_PATTERNS.some((hp) => p.toLowerCase() === hp.toLowerCase()));
};

const getExistingIssues = (repo: string): Array<{ number: number; title: string }> => {
  const result = sh(
    `gh issue list --repo ${repo} --label "${LABEL}" --state open --json number,title --jq "[.[] | {number, title}]"`
  );
  try {
    return JSON.parse(result || '[]') as Array<{ number: number; title: string }>;
  } catch {
    return [];
  }
};

const loadCooldowns = (): Record<string, number> => {
  if (!existsSync(COOLDOWN_PATH)) return {};
  try {
    return JSON.parse(readFileSync(COOLDOWN_PATH, 'utf-8')) as Record<string, number>;
  } catch {
    return {};
  }
};

const saveCooldown = (repo: string): void => {
  const cooldowns = loadCooldowns();
  cooldowns[repo] = Date.now();
  writeFileSync(COOLDOWN_PATH, JSON.stringify(cooldowns, null, 2));
};

const getLastSelfHealForRepo = (repo: string): number => {
  // Local file: works within same CI run
  const cooldowns = loadCooldowns();
  const localTs = cooldowns[repo] ?? 0;
  if (localTs > 0) return localTs;

  // API fallback: check most recent ai-fix PR (any state) on target repo
  const prDate = sh(
    `gh pr list --repo ${repo} --search "head:ai-fix/" --state all --limit 1 --json createdAt --jq ".[0].createdAt" 2>/dev/null`
  );
  if (prDate && prDate !== 'null' && prDate !== '') {
    return new Date(prDate).getTime();
  }

  return 0;
};

const triggerSelfHeal = (repo: string, run: WorkflowRun): boolean => {
  // Guard: cooldown 24h for factory (persistent via API fallback)
  const lastAttempt = getLastSelfHealForRepo(repo);
  if (Date.now() - lastAttempt < FACTORY_COOLDOWN_MS) {
    const hoursAgo = ((Date.now() - lastAttempt) / 3600000).toFixed(1);
    console.log(`  [SKIP HEAL] ${repo}: last attempt ${hoursAgo}h ago (cooldown 24h)`);
    return false;
  }

  // Guard: don't heal failures on ai-fix branches
  if (run.head_branch.startsWith('ai-fix/')) {
    console.log(`  [SKIP HEAL] ${repo}: failure on ai-fix branch`);
    return false;
  }

  try {
    execSync(
      `gh workflow run self-heal.yml --repo ${repo} -f repo="${repo}" -f run_id="${run.id}"`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    saveCooldown(repo);
    console.log(`  [HEAL] Triggered self-heal for ${repo} (run ${run.id})`);
    return true;
  } catch (e) {
    console.error(`  [ERROR] Failed to trigger self-heal:`, e);
    return false;
  }
};

const ensureLabel = (repo: string): void => {
  sh(
    `gh label create "${LABEL}" --repo ${repo} --color "d93f0b" --description "Factory workflow anomaly detected" --force`
  );
};

const createIssue = (repo: string, result: WatchdogResult): void => {
  if (!result.run) return;

  const severity = result.status === 'total_failure' ? 'FAILURE' : 'PARTIAL FAILURE';
  const title = `[Watchdog] ${severity}: ${result.workflow}`;

  const patternList =
    result.patterns.length > 0
      ? `### Detected patterns\n${result.patterns.map((p) => `- \`${p}\``).join('\n')}\n`
      : '';

  const body = `## Factory Watchdog Alert

| Field | Value |
|-------|-------|
| **Workflow** | ${result.workflow} |
| **Severity** | ${severity} |
| **Conclusion** | \`${result.run.conclusion}\` |
| **Run** | [View run](${result.run.html_url}) |
| **Date** | ${result.run.created_at} |

${patternList}
### Action required
${
  result.status === 'total_failure'
    ? 'Workflow failed completely. Check the run logs for details.'
    : 'Workflow exited with success but contains error patterns in logs. The workflow may need explicit error handling.'
}

---
*Auto-generated by Factory Watchdog*`;

  ensureLabel(repo);

  const bodyFile = '/tmp/watchdog-issue-body.md';
  writeFileSync(bodyFile, body);
  try {
    execSync(
      `gh issue create --repo ${repo} --title "${title}" --body-file ${bodyFile} --label "${LABEL}"`,
      { encoding: 'utf-8', stdio: 'inherit' }
    );
    console.log(`  [CREATED] Issue: ${title}`);
  } catch (e) {
    console.error(`  [ERROR] Failed to create issue:`, e);
  }
  try {
    unlinkSync(bodyFile);
  } catch {
    /* ignore */
  }
};

const main = () => {
  const repo = process.env.GITHUB_REPOSITORY ?? 'thonyAGP/DevOps-Factory';

  console.log(`\nFactory Watchdog - ${new Date().toISOString()}`);
  console.log(`Monitoring workflows for: ${repo}\n`);

  // Get all recent runs (deduplicated by workflow name - keep latest per workflow)
  const allRuns = getLatestRunSimple(repo);
  const latestByWorkflow = new Map<string, WorkflowRun>();
  for (const run of allRuns) {
    if (!latestByWorkflow.has(run.name)) {
      latestByWorkflow.set(run.name, run);
    }
  }

  console.log(`Found ${latestByWorkflow.size} workflows with recent runs\n`);

  const existingIssues = getExistingIssues(repo);
  const results: WatchdogResult[] = [];

  for (const [name, run] of latestByWorkflow) {
    process.stdout.write(`Checking ${name}... `);

    // Skip Factory CI itself to avoid self-referential loops
    if (name === 'Factory CI') {
      console.log('SKIP (self)');
      continue;
    }

    if (run.conclusion !== 'success') {
      // Total failure
      console.log(`FAIL (${run.conclusion})`);
      results.push({
        workflow: name,
        status: 'total_failure',
        run,
        patterns: [],
      });
      continue;
    }

    // Success - check for partial failures in logs
    const logs = getRunLogs(repo, run.id);
    const patterns = detectPartialFailures(logs);

    if (patterns.length > 0) {
      console.log(`PARTIAL FAIL (${patterns.length} patterns)`);
      results.push({
        workflow: name,
        status: 'partial_failure',
        run,
        patterns,
      });
    } else {
      console.log('PASS');
      results.push({
        workflow: name,
        status: 'pass',
        run,
        patterns: [],
      });
    }
  }

  // Create issues + trigger self-heal for total failures
  console.log('\n--- Issue Management ---\n');

  let created = 0;
  let healed = 0;
  for (const result of results) {
    if (result.status === 'pass') continue;

    const existing = existingIssues.find((i) => i.title.includes(result.workflow));
    if (existing) {
      console.log(`  [EXISTS] Issue #${existing.number} for ${result.workflow}`);
    } else {
      createIssue(repo, result);
      created++;
    }

    // Trigger self-heal for:
    // - Total failures on healable workflows
    // - Partial failures with healable patterns (code bugs, not env/transient issues)
    const shouldHeal =
      result.run &&
      SELF_HEALABLE_WORKFLOWS.includes(result.workflow) &&
      (result.status === 'total_failure' ||
        (result.status === 'partial_failure' && hasHealablePatterns(result.patterns)));

    if (shouldHeal && result.run) {
      if (triggerSelfHeal(repo, result.run)) healed++;
    }
  }

  // Auto-close resolved issues
  let closed = 0;
  for (const issue of existingIssues) {
    const matchingResult = results.find(
      (r) => r.status === 'pass' && issue.title.includes(r.workflow)
    );
    if (matchingResult) {
      try {
        execSync(
          `gh issue close ${issue.number} --repo ${repo} --comment "Workflow recovered. Auto-closing."`,
          { encoding: 'utf-8', stdio: 'inherit' }
        );
        console.log(`  [CLOSED] Issue #${issue.number} - ${matchingResult.workflow} recovered`);
        closed++;
      } catch {
        /* best effort */
      }
    }
  }

  // Summary
  const passing = results.filter((r) => r.status === 'pass').length;
  const totalFail = results.filter((r) => r.status === 'total_failure').length;
  const partialFail = results.filter((r) => r.status === 'partial_failure').length;

  console.log('\n--- Summary ---');
  console.log(`Passing: ${passing}/${results.length}`);
  if (totalFail > 0) console.log(`Total failures: ${totalFail}`);
  if (partialFail > 0) console.log(`Partial failures: ${partialFail}`);
  console.log(`Issues: ${created} created, ${closed} closed, ${healed} self-heals triggered`);

  if (totalFail > 0 || partialFail > 0) {
    console.log(`\nWARNING: ${totalFail + partialFail} workflow(s) with issues`);
  }
};

main();
