/**
 * remediation-dispatch.ts
 *
 * The saut #3 trigger: reads the security registry and dispatches a bounded
 * coding agent onto the worst-graded repos to fix their central-scan findings.
 *
 * This is the event-driven-ephemeral-agent model, NOT a persistent session:
 * the Factory (durable state) selects targets from the registry (durable
 * state), fires a short-lived agent per repo via workflow_dispatch, and the
 * agent dies after opening its PR. No always-on session anywhere.
 *
 * Safety is layered and fail-closed:
 * - REMEDIATION_CONFIG.enabled must be true (default false → no-op)
 * - only repos in REMEDIATION_CONFIG.enabledRepos are eligible (default empty)
 * - only repos at/below minGrade qualify
 * - a fleet-wide daily quota caps dispatches
 * - --dry-run lists targets without firing
 *
 * Usage: pnpm remediation-dispatch [-- --dry-run]
 * Cron: none by default — manual dispatch until explicitly opted in
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { REMEDIATION_CONFIG, type RemediationConfig } from '../factory.config.js';
import { logActivity } from './activity-logger.js';
import { sh } from './shell-utils.js';

type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

interface RepoRisk {
  name: string;
  repo: string;
  risk: number;
  grade: Grade;
  reasons: string[];
}
interface SecurityRegistry {
  date: string;
  repos: RepoRisk[];
}
interface Quota {
  date: string;
  count: number;
  maxPerDay: number;
}

const REGISTRY_PATH = 'data/security-registry.json';
const QUOTA_PATH = 'data/remediation-quota.json';

const GRADE_RANK: Record<Grade, number> = { A: 0, B: 1, C: 2, D: 3, F: 4 };

/**
 * Pure target selection — the whole policy in one testable function.
 * A repo qualifies when: remediation is enabled, it is allowlisted, its grade
 * is at or below the threshold, and the daily quota still has room. Returned
 * worst-first, capped at the remaining quota.
 */
export const selectRemediationTargets = (
  registry: SecurityRegistry,
  config: RemediationConfig,
  remainingQuota: number
): RepoRisk[] => {
  if (!config.enabled || remainingQuota <= 0) return [];
  const allow = new Set(config.enabledRepos);
  const threshold = GRADE_RANK[config.minGrade];

  return registry.repos
    .filter((r) => allow.has(r.repo))
    .filter((r) => GRADE_RANK[r.grade] >= threshold)
    .sort((a, b) => b.risk - a.risk)
    .slice(0, remainingQuota);
};

const loadRegistry = (): SecurityRegistry | null => {
  if (!existsSync(REGISTRY_PATH)) return null;
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8')) as SecurityRegistry;
  } catch {
    return null;
  }
};

const loadQuota = (): Quota => {
  const today = new Date().toISOString().split('T')[0];
  if (!existsSync(QUOTA_PATH)) {
    return { date: today, count: 0, maxPerDay: REMEDIATION_CONFIG.maxPerDay };
  }
  try {
    const q = JSON.parse(readFileSync(QUOTA_PATH, 'utf-8')) as Quota;
    if (q.date !== today) return { date: today, count: 0, maxPerDay: REMEDIATION_CONFIG.maxPerDay };
    return q;
  } catch {
    return { date: today, count: 0, maxPerDay: REMEDIATION_CONFIG.maxPerDay };
  }
};

const saveQuota = (q: Quota): void => writeFileSync(QUOTA_PATH, JSON.stringify(q, null, 2));

/** Fire the bounded agent workflow in a target repo. Returns true on success. */
const dispatchAgent = (repo: string): boolean => {
  const out = sh(
    `gh workflow run ${REMEDIATION_CONFIG.workflowFile} --repo ${repo} 2>&1 && echo DISPATCHED`
  );
  return out.includes('DISPATCHED');
};

const main = (): void => {
  const dryRun = process.argv.slice(2).includes('--dry-run');

  if (!REMEDIATION_CONFIG.enabled) {
    console.log('Remediation disabled (REMEDIATION_CONFIG.enabled = false). No-op.');
    return;
  }

  const registry = loadRegistry();
  if (!registry) {
    console.log('No security-registry.json — run the security registry first. Skipping.');
    return;
  }

  const quota = loadQuota();
  const remaining = quota.maxPerDay - quota.count;
  const targets = selectRemediationTargets(registry, REMEDIATION_CONFIG, remaining);

  if (targets.length === 0) {
    console.log(
      `No eligible targets (allowlist=${REMEDIATION_CONFIG.enabledRepos.length}, ` +
        `grade≤${REMEDIATION_CONFIG.minGrade}, quota ${quota.count}/${quota.maxPerDay}).`
    );
    return;
  }

  console.log(`${targets.length} target(s) selected (quota ${quota.count}/${quota.maxPerDay}):`);
  let dispatched = 0;
  for (const t of targets) {
    console.log(`  ${t.grade} ${t.name} (risk ${t.risk}) — ${t.reasons.join(', ')}`);
    if (dryRun) continue;
    if (dispatchAgent(t.repo)) {
      dispatched++;
      quota.count++;
      saveQuota(quota);
      logActivity(
        'remediation-dispatch',
        'agent-dispatched',
        `grade ${t.grade}, risk ${t.risk}`,
        'warning',
        t.name
      );
    } else {
      console.log(`    [WARN] dispatch failed for ${t.repo} (workflow present + API key set?)`);
    }
  }

  if (!dryRun) {
    console.log(`\nDispatched ${dispatched} remediation agent(s).`);
    logActivity(
      'remediation-dispatch',
      'dispatch-complete',
      `${dispatched} agent(s) dispatched, quota ${quota.count}/${quota.maxPerDay}`,
      dispatched > 0 ? 'warning' : 'info'
    );
  }
};

const isDirectRun =
  !process.env.VITEST && process.argv[1]?.replace(/\\/g, '/').endsWith('remediation-dispatch.ts');
if (isDirectRun) main();
