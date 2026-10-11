/**
 * fixtures.ts — donnees de test partagees du plan d'incidents (aucun effet).
 */

import type { IncidentEnvelope } from './envelope.js';

export const HOUR_MS = 3_600_000;
/** 06:00 a Madrid. */
export const T0 = new Date('2026-10-11T04:00:00.000Z');
export const at = (hours: number): Date => new Date(T0.getTime() + hours * HOUR_MS);
export const iso = (hours: number): string => at(hours).toISOString();

export const DB_FLUX = 'db-backups';
export const DB_REPO = 'thonyAGP/db-backups';

/** Enveloppe valide (db-backups en silence, ouverte a T0) ; `over` remplace des champs. */
export const makeEnvelope = (over: Partial<IncidentEnvelope> = {}): IncidentEnvelope => ({
  version: 1,
  id: 'inc-db-backups-silence-202610110400',
  empreinte: `${DB_FLUX}:silence`,
  flux: DB_FLUX,
  classe: 'silence',
  source: { detecteur: 'silence-watchdog', typeFlux: 'github-commits', depot: DB_REPO },
  etat: 'ouvert',
  priorite: 'haute',
  impact: 'job_muet',
  premiereOccurrence: iso(0),
  derniereOccurrence: iso(0),
  occurrences: 1,
  ouvertures: 1,
  fermeLe: null,
  enquetes: { demandees: 0, horodatages: [] },
  derniereDecision: null,
  causedBy: null,
  incidentRootId: null,
  nonFiable: { detail: 'dernière preuve il y a 27 h (seuil 26 h)' },
  ...over,
});
