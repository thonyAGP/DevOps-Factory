/**
 * policy.test.ts — moteur de politiques : AUTO_ALLOWED vide, mode shadow = abstention TOUJOURS.
 */

import { describe, expect, it } from 'vitest';

import { INCIDENT_STATES, type IncidentEnvelope, type IncidentState } from './envelope.js';
import { iso, makeEnvelope } from './fixtures.js';
import { AUTO_ALLOWED, DEFAULT_POLICY_MODE, RECOMMENDED_ACTIONS, decidePolicy } from './policy.js';

const envelopeIn = (etat: IncidentState) =>
  makeEnvelope({
    etat,
    fermeLe: etat === 'ferme' ? iso(6) : null,
    enquetes: { demandees: 1, horodatages: [iso(0)] },
  });

const diagnosed = envelopeIn('diagnostique');

describe('AUTO_ALLOWED', () => {
  it('should be empty and frozen', () => {
    expect(AUTO_ALLOWED).toEqual([]);
    expect(Object.isFrozen(AUTO_ALLOWED)).toBe(true);
  });
});

describe('mode shadow (défaut) — abstention toujours', () => {
  const untrusted: unknown[] = [...RECOMMENDED_ACTIONS, 'supprimer_branche', '', null, 42];

  it('should default to the shadow mode', () => {
    expect(DEFAULT_POLICY_MODE).toBe('shadow');
  });

  it('should always abstain when the mode is shadow, for every action and every state', () => {
    // Arrange : toutes les actions (y compris non fiables) x tous les etats
    const outputs = INCIDENT_STATES.flatMap((etat) =>
      untrusted.flatMap((action) => [
        decidePolicy({ envelope: envelopeIn(etat), action }),
        decidePolicy({ envelope: envelopeIn(etat), action, mode: 'shadow' }),
      ])
    );

    // Assert
    expect(outputs).toHaveLength(INCIDENT_STATES.length * untrusted.length * 2);
    expect(outputs.every((d) => d.sortie === 'abstention' && d.motif === 'mode_shadow')).toBe(true);
  });

  it('should abstain even when an allowlist is forced in shadow mode', () => {
    const d = decidePolicy({
      envelope: diagnosed,
      action: 'relancer_job',
      autoAllowed: ['relancer_job'],
    });
    expect(d).toEqual({ sortie: 'abstention', motif: 'mode_shadow' });
  });
});

describe('mode actif — règles déterministes (non utilisé en étape 1)', () => {
  it.each<[string, IncidentEnvelope, unknown, string]>([
    ['an unknown action', diagnosed, 'tout_casser', 'action_inconnue'],
    ['a closed incident', envelopeIn('ferme'), 'pr', 'incident_ferme'],
    ['an undiagnosed incident', envelopeIn('enquete_demandee'), 'pr', 'sans_diagnostic'],
    ['a human gesture', diagnosed, 'humain', 'action_humaine_ou_nulle'],
    ['a remediation outside AUTO_ALLOWED', diagnosed, 'relancer_job', 'action_non_autorisee'],
  ])('should abstain on %s', (_label, envelope, action, motif) => {
    expect(decidePolicy({ envelope, action, mode: 'actif' })).toEqual({
      sortie: 'abstention',
      motif,
    });
  });

  it('should prepare a PR, and automate only a pre-written remediation of the allowlist', () => {
    expect(decidePolicy({ envelope: diagnosed, action: 'pr', mode: 'actif' }).sortie).toBe(
      'pr_preparee'
    );
    const auto = decidePolicy({
      envelope: diagnosed,
      action: 'relancer_job',
      mode: 'actif',
      autoAllowed: ['relancer_job'],
    });
    expect(auto).toEqual({ sortie: 'auto', motif: 'action_pre_ecrite' });
  });
});
