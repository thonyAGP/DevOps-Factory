/**
 * retire-private-workflows.test.ts
 *
 * The selection drives file DELETIONS in managed repos, so the invariants are
 * tested explicitly: only known factory files, never the allowlist, never a
 * repo's own workflows.
 */

import { describe, it, expect } from 'vitest';
import {
  selectRetireTargets,
  FACTORY_RETIRED_WORKFLOWS,
  type RemoteWorkflowFile,
} from './retire-private-workflows.js';
import { PRIVATE_WORKFLOW_ALLOWLIST } from '../factory.config.js';

const f = (name: string): RemoteWorkflowFile => ({ name, sha: `sha-${name}` });

describe('selectRetireTargets', () => {
  it('retires factory-deployed workflows', () => {
    const got = selectRetireTargets([f('semgrep.yml'), f('gitleaks.yml'), f('self-healing.yml')]);
    expect(got.map((x) => x.name)).toEqual(['semgrep.yml', 'gitleaks.yml', 'self-healing.yml']);
  });

  it('never touches a repo own custom workflows', () => {
    const got = selectRetireTargets([f('deploy-prod.yml'), f('my-custom-thing.yml')]);
    expect(got).toEqual([]);
  });

  it('never touches allowlisted workflows', () => {
    const got = selectRetireTargets([
      f('ci.yml'),
      f('auto-merge-deps.yml'),
      f('ai-remediation.yml'),
      f('prisma-migration-check.yml'),
    ]);
    expect(got).toEqual([]);
  });

  it('allowlist wins even if a name lands on both lists', () => {
    const got = selectRetireTargets([f('ci.yml')], ['ci.yml'], ['.github/workflows/ci.yml']);
    expect(got).toEqual([]);
  });

  it('mixes correctly: retire the covered ones, keep custom + allowlisted', () => {
    const got = selectRetireTargets([
      f('ci.yml'),
      f('coverage-gate.yml'),
      f('deploy-prod.yml'),
      f('claude-review.yml'),
    ]);
    expect(got.map((x) => x.name)).toEqual(['coverage-gate.yml', 'claude-review.yml']);
  });

  it('the retired list and the allowlist are disjoint (config invariant)', () => {
    const allowNames = new Set(PRIVATE_WORKFLOW_ALLOWLIST.map((p) => p.split('/').pop()));
    for (const name of FACTORY_RETIRED_WORKFLOWS) {
      expect(allowNames.has(name), `${name} is in both lists`).toBe(false);
    }
  });
});
