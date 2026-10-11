/**
 * correlation.test.ts — causedBy / incidentRootId : incident ne dans les 24 h apres une PR.
 */

import { describe, expect, it } from 'vitest';

import { correlate, type RepairPr } from './correlation.js';
import { iso, makeEnvelope } from './fixtures.js';

const FACTORY = 'thonyAGP/DevOps-Factory';
const ROOT_ID = 'inc-devops-factory-workflows-echec_workflow-202610080400';

const pr = (over: Partial<RepairPr> = {}): RepairPr => ({
  depot: FACTORY,
  numero: 3324,
  auteur: 'reparateur',
  horodatage: iso(-3),
  incidentId: null,
  ...over,
});

const birth = (hours = 0, depot: string | null = FACTORY) => ({ depot, at: iso(hours) });

describe('causedBy — incident né d’une réparation', () => {
  it('should link an incident born 3 h after a repair PR on the same repo', () => {
    // Arrange
    const prs = [pr()];

    // Act
    const link = correlate(birth(), prs, []);

    // Assert
    expect(link).toEqual({ causedBy: 'thonyAGP/DevOps-Factory#3324', incidentRootId: null });
  });

  it('should propagate the root of the incident the PR was fixing', () => {
    const parent = makeEnvelope({ id: 'inc-ci-parent-202610100400', incidentRootId: ROOT_ID });
    const fixing = pr({ auteur: 'analyste', incidentId: parent.id });

    expect(correlate(birth(), [fixing], [parent]).incidentRootId).toBe(ROOT_ID);
    expect(correlate(birth(), [fixing], [{ ...parent, incidentRootId: null }]).incidentRootId).toBe(
      parent.id
    );
    expect(correlate(birth(), [pr({ incidentId: ROOT_ID })], []).incidentRootId).toBe(ROOT_ID);
  });

  it('should pick the most recent PR when several qualify, whatever the repo case', () => {
    const prs = [pr({ numero: 10, horodatage: iso(-20) }), pr({ numero: 11, horodatage: iso(-2) })];
    expect(correlate(birth(0, 'thonyagp/devops-factory'), prs, []).causedBy).toBe(
      'thonyAGP/DevOps-Factory#11'
    );
  });
});

describe('causedBy — pas de rattachement', () => {
  it.each<[string, RepairPr[], ReturnType<typeof birth>]>([
    ['the PR is older than 24 h', [pr({ horodatage: iso(-25) })], birth()],
    ['the PR comes after the incident', [pr({ horodatage: iso(1) })], birth()],
    ['the PR is on another repo', [pr({ depot: 'thonyAGP/db-backups' })], birth()],
    ['the incident has no known repo', [pr()], birth(0, null)],
    ['the PR reference is not usable', [pr({ numero: 0 }), pr({ horodatage: 'hier' })], birth()],
    ['no PR is known (étape 1)', [], birth()],
  ])('should not link when %s', (_label, prs, b) => {
    expect(correlate(b, prs, [])).toEqual({ causedBy: null, incidentRootId: null });
  });
});
