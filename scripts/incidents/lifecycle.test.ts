/**
 * lifecycle.test.ts — cycle de vie ferme : occurrence, fermeture, reouverture du MEME incident.
 */

import { describe, expect, it } from 'vitest';

import { INCIDENT_LIMITS, parseEnvelope, type IncidentEnvelope } from './envelope.js';
import { DB_FLUX, DB_REPO, iso, makeEnvelope } from './fixtures.js';
import {
  canTransition,
  closeIncident,
  createIncident,
  markDiagnosed,
  recordOccurrence,
  reopenIncident,
  requestInvestigation,
  sanitizeDetail,
  shouldClose,
  type Observation,
} from './lifecycle.js';

const sighting = (hours: number, detail = 'il y a 33 h (seuil 26 h)') => ({
  detail,
  now: iso(hours),
  priorite: 'haute' as const,
  impact: 'job_muet' as const,
});

const conforms = (e: IncidentEnvelope): boolean => parseEnvelope(e).ok;

const fresh = (birth?: string | null): IncidentEnvelope =>
  createIncident({
    flux: DB_FLUX,
    classe: 'silence',
    source: { detecteur: 'silence-watchdog', typeFlux: 'github-commits', depot: DB_REPO },
    priorite: 'haute',
    impact: 'job_muet',
    detail: 'dernière preuve il y a 27 h',
    now: iso(0),
    birth,
    causedBy: null,
    incidentRootId: null,
  });

describe('création', () => {
  it('should open a conforming incident with one occurrence when a fingerprint is new', () => {
    const e = fresh();

    expect(e).toMatchObject({
      id: 'inc-db-backups-silence-202610110400',
      empreinte: 'db-backups:silence',
      etat: 'ouvert',
      occurrences: 1,
      ouvertures: 1,
    });
    expect(conforms(e)).toBe(true);
  });

  it('should date the birth from a known earlier start, and ignore a later or invalid one', () => {
    expect(fresh(iso(-50)).premiereOccurrence).toBe(iso(-50));
    expect(fresh(iso(-50)).id).toBe('inc-db-backups-silence-202610090200');
    expect(fresh(iso(3)).premiereOccurrence).toBe(iso(0));
    expect(fresh('hier').premiereOccurrence).toBe(iso(0));
  });
});

describe('occurrence vs nouvel incident', () => {
  it('should add an occurrence to the same incident when its fingerprint is already open', () => {
    const e = recordOccurrence(fresh(), sighting(6));

    expect(e).toMatchObject({ id: fresh().id, occurrences: 2, derniereOccurrence: iso(6) });
    expect(conforms(e)).toBe(true);
  });

  it('should refuse an occurrence on a closed incident, which must be reopened', () => {
    const closed = closeIncident(fresh(), iso(6));
    expect(() => recordOccurrence(closed, sighting(12))).toThrow(/rouvrir/);
  });
});

describe('fermeture et réouverture', () => {
  it('should close with a timestamp when the stream is back to normal', () => {
    const closed = closeIncident(fresh(), iso(6));

    expect(closed).toMatchObject({ etat: 'ferme', fermeLe: iso(6) });
    expect(conforms(closed)).toBe(true);
  });

  it('should reopen the SAME incident with cumulated occurrences when it fails again', () => {
    const reopened = reopenIncident(closeIncident(fresh(), iso(6)), sighting(12));

    expect(reopened).toMatchObject({
      id: fresh().id,
      empreinte: 'db-backups:silence',
      etat: 'rouvert',
      occurrences: 2,
      ouvertures: 2,
      fermeLe: null,
    });
    expect(conforms(reopened)).toBe(true);
  });

  it('should refuse to close an incident twice', () => {
    expect(() => closeIncident(closeIncident(fresh(), iso(6)), iso(7))).toThrow(/interdite/);
  });
});

describe('enquêtes', () => {
  it('should record the request with its timestamp, and diagnose only after a request', () => {
    const asked = requestInvestigation(fresh(), iso(0));

    expect(asked.enquetes).toEqual({ demandees: 1, horodatages: [iso(0)] });
    expect(markDiagnosed(asked).etat).toBe('diagnostique');
    expect(() => markDiagnosed(fresh())).toThrow(/interdite/);
  });

  it('should refuse a request beyond maxInvestigationsPerIncident', () => {
    const capped = makeEnvelope({
      etat: 'rouvert',
      occurrences: 3,
      ouvertures: 3,
      enquetes: {
        demandees: INCIDENT_LIMITS.maxInvestigationsPerIncident,
        horodatages: [iso(0), iso(12)],
      },
    });
    expect(() => requestInvestigation(capped, iso(24))).toThrow(/plafond/);
  });

  it('should only allow the transitions of the closed table', () => {
    expect(canTransition('ouvert', 'enquete_demandee')).toBe(true);
    expect(canTransition('ferme', 'rouvert')).toBe(true);
    expect(canTransition('ferme', 'enquete_demandee')).toBe(false);
    expect(canTransition('diagnostique', 'enquete_demandee')).toBe(false);
  });
});

describe('fermeture selon l’observation', () => {
  const panne: Observation = { kind: 'panne', classe: 'silence', detail: 'x' };
  const otherError: Observation = { kind: 'erreur', classe: 'erreur', detail: 'GitHub HTTP 404' };
  const sameError: Observation = { kind: 'erreur', classe: 'secret_absent', detail: 'secret' };

  // Colonnes : incident `silence` (panne du flux) ferme ? incident `secret_absent` ferme ?
  it.each<[string, Observation, boolean, boolean]>([
    ['a healthy check', { kind: 'sain' }, true, true],
    ['a doubt below the threshold', { kind: 'doute' }, false, true],
    ['the same failure', panne, false, true],
    ['another control error', otherError, false, true],
    ['the same control error', sameError, false, false],
    ['a pending stream', { kind: 'ignore' }, false, false],
  ])('should decide closings on %s', (_label, obs, closesFailure, closesBlind) => {
    expect(shouldClose('silence', obs)).toBe(closesFailure);
    expect(shouldClose('secret_absent', obs)).toBe(closesBlind);
  });
});

describe('données non fiables', () => {
  it('should flatten control characters and bound the detail', () => {
    expect(sanitizeDetail('ligne 1\nligne 2\u0007\r\n  fin  ')).toBe('ligne 1 ligne 2 fin');
    const long = sanitizeDetail('x'.repeat(2000));
    expect(long).toHaveLength(INCIDENT_LIMITS.maxDetailLength);
    expect(long.endsWith('…')).toBe(true);
  });
});
