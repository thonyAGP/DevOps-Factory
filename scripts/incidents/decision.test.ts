/**
 * decision.test.ts — « enquete necessaire ? » : deterministe, motif ferme, plafond, cooldown.
 */

import { describe, expect, it } from 'vitest';

import { applyInvestigationDecision, decideInvestigation, describeDecision } from './decision.js';
import { INCIDENT_LIMITS } from './envelope.js';
import { at, iso, makeEnvelope } from './fixtures.js';

const DEFAULT = { cooldownHeures: INCIDENT_LIMITS.defaultCooldownHours };

/** Incident rouvert apres une premiere enquete demandee a T0. */
const reopenedAfterOne = () =>
  makeEnvelope({
    etat: 'rouvert',
    occurrences: 2,
    ouvertures: 2,
    derniereOccurrence: iso(2),
    enquetes: { demandees: 1, horodatages: [iso(0)] },
  });

describe('enquête nécessaire — oui', () => {
  it('should request an investigation once when an incident is new and its priority reaches the threshold', () => {
    // Arrange
    const e = makeEnvelope();

    // Act
    const d = decideInvestigation(e, DEFAULT, at(0));
    const after = applyInvestigationDecision(e, d, at(0));

    // Assert
    expect(d).toEqual({ enquete: true, motif: 'nouvel_incident' });
    expect(after.etat).toBe('enquete_demandee');
    expect(after.enquetes).toEqual({ demandees: 1, horodatages: [iso(0)] });
    expect(after.derniereDecision).toEqual({
      enquete: true,
      motif: 'nouvel_incident',
      horodatage: iso(0),
    });
  });

  it('should request a second investigation when a reopened incident is past its cooldown', () => {
    expect(decideInvestigation(reopenedAfterOne(), DEFAULT, at(6))).toEqual({
      enquete: true,
      motif: 'rouvert_hors_cooldown',
    });
  });
});

describe('enquête nécessaire — non, motif journalisé', () => {
  it('should not ask again when an investigation is already requested (second red pass)', () => {
    const asked = makeEnvelope({
      etat: 'enquete_demandee',
      enquetes: { demandees: 1, horodatages: [iso(0)] },
    });
    const d = decideInvestigation(asked, DEFAULT, at(6));
    const after = applyInvestigationDecision(asked, d, at(6));

    expect(d).toEqual({ enquete: false, motif: 'enquete_en_cours' });
    expect(after.enquetes.demandees).toBe(1);
    expect(after.derniereDecision?.motif).toBe('enquete_en_cours');
  });

  it('should not ask during the cooldown when an incident reopens too soon', () => {
    expect(decideInvestigation(reopenedAfterOne(), DEFAULT, at(2))).toEqual({
      enquete: false,
      motif: 'cooldown',
    });
  });

  it('should honour a per-flow cooldown override', () => {
    const d = decideInvestigation(reopenedAfterOne(), { cooldownHeures: 12 }, at(6));
    expect(d).toEqual({ enquete: false, motif: 'cooldown' });
  });

  it('should stop at maxInvestigationsPerIncident even past the cooldown', () => {
    const capped = makeEnvelope({
      etat: 'rouvert',
      occurrences: 3,
      ouvertures: 3,
      enquetes: { demandees: 2, horodatages: [iso(0), iso(12)] },
    });
    expect(decideInvestigation(capped, DEFAULT, at(48))).toEqual({
      enquete: false,
      motif: 'plafond_atteint',
    });
  });

  it('should not ask when the priority is below the threshold', () => {
    const blind = makeEnvelope({ priorite: 'normale' });
    expect(decideInvestigation(blind, DEFAULT, at(0)).motif).toBe('priorite_sous_seuil');
    expect(decideInvestigation(blind, { ...DEFAULT, seuil: 'normale' }, at(0)).enquete).toBe(true);
  });

  it('should not ask for a diagnosed or a closed incident', () => {
    const diagnosed = makeEnvelope({
      etat: 'diagnostique',
      enquetes: { demandees: 1, horodatages: [iso(0)] },
    });
    const closed = makeEnvelope({ etat: 'ferme', fermeLe: iso(6) });

    expect(decideInvestigation(diagnosed, DEFAULT, at(6)).motif).toBe('deja_diagnostique');
    expect(decideInvestigation(closed, DEFAULT, at(6)).motif).toBe('incident_ferme');
  });

  it('should describe the decision with its closed motive', () => {
    expect(describeDecision({ enquete: true, motif: 'nouvel_incident' })).toBe(
      'enquête demandée (nouvel_incident)'
    );
    expect(describeDecision({ enquete: false, motif: 'cooldown' })).toBe(
      "pas d'enquête (cooldown)"
    );
  });
});
