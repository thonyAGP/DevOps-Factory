/**
 * lifecycle.ts — cycle de vie ferme d'un incident, transitions pures.
 *
 *   ouvert -> enquete_demandee -> diagnostique -> ferme
 *   ferme -> rouvert -> enquete_demandee | ferme
 *
 * Une empreinte = un incident : une alerte dont l'empreinte est deja ouverte est
 * une OCCURRENCE ; une panne apres fermeture ROUVRE le meme incident (occurrences
 * cumulees). Toute transition hors table leve une erreur.
 */

import {
  ENVELOPE_VERSION,
  INCIDENT_LIMITS,
  type Impact,
  type IncidentEnvelope,
  type IncidentSource,
  type IncidentState,
  type Priority,
  type SymptomClass,
} from './envelope.js';
import { fingerprintOf, isErrorClass } from './fingerprint.js';
import { isIsoDate } from './schema.js';

export const TRANSITIONS: Readonly<Record<IncidentState, readonly IncidentState[]>> = {
  ouvert: ['enquete_demandee', 'ferme'],
  enquete_demandee: ['diagnostique', 'ferme'],
  diagnostique: ['ferme'],
  ferme: ['rouvert'],
  rouvert: ['enquete_demandee', 'ferme'],
};

export const OPEN_STATES: readonly IncidentState[] = [
  'ouvert',
  'enquete_demandee',
  'diagnostique',
  'rouvert',
];

export const isOpen = (e: Pick<IncidentEnvelope, 'etat'>): boolean => OPEN_STATES.includes(e.etat);

export const canTransition = (from: IncidentState, to: IncidentState): boolean =>
  TRANSITIONS[from].includes(to);

const moveTo = (e: IncidentEnvelope, to: IncidentState): IncidentEnvelope => {
  if (!canTransition(e.etat, to)) {
    throw new Error(`transition interdite ${e.etat} → ${to} (${e.id})`);
  }
  return { ...e, etat: to };
};

/** Ce qu'un passage du watchdog a observe pour un flux. */
export type Observation =
  /** Controle fait, flux sain (verdict OK) : retour a la normale. */
  | { kind: 'sain' }
  /** Controle fait, echec sous le seuil d'alerte (verdict DOUTE n/m). */
  | { kind: 'doute' }
  /** Controle fait, alerte confirmee (verdict SILENCE, ROUGE ou PANNE). */
  | { kind: 'panne'; classe: SymptomClass; detail: string }
  /** Controle impossible (verdict ERREUR) : le flux n'a pas ete observe. */
  | { kind: 'erreur'; classe: SymptomClass; detail: string }
  /** Flux en attente : jamais controle, rien ne change. */
  | { kind: 'ignore' };

/**
 * Un incident OUVERT de ce flux se ferme-t-il sur cette observation ?
 * Jamais sur une erreur de controle ni sur un doute (aucun faux retour a la normale).
 */
export const shouldClose = (classe: SymptomClass, obs: Observation): boolean => {
  switch (obs.kind) {
    case 'sain':
      return true;
    case 'doute':
      return isErrorClass(classe);
    case 'panne':
      return classe !== obs.classe;
    case 'erreur':
      return isErrorClass(classe) && classe !== obs.classe;
    case 'ignore':
      return false;
  }
};

/** Texte libre ramene sur une ligne, sans caractere de controle, borne. */
export const sanitizeDetail = (detail: string): string => {
  const flat = detail
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const max = INCIDENT_LIMITS.maxDetailLength;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** `inc-<flux>-<classe>-<AAAAMMJJhhmm de la naissance>` : lisible, unique par empreinte. */
export const incidentId = (flux: string, classe: SymptomClass, birthIso: string): string =>
  `inc-${flux}-${classe}-${birthIso.slice(0, 16).replace(/[-:T]/g, '')}`;

export interface NewIncident {
  flux: string;
  classe: SymptomClass;
  source: IncidentSource;
  priorite: Priority;
  impact: Impact;
  detail: string;
  /** Instant du passage, ISO UTC. */
  now: string;
  /** Debut connu de la panne (ex. `alertOpenSince` du watchdog), sinon `now`. */
  birth?: string | null;
  causedBy: string | null;
  incidentRootId: string | null;
}

/** Naissance retenue : le debut connu s'il est une date ISO anterieure ou egale a `now`. */
export const birthOf = (now: string, birth?: string | null): string =>
  isIsoDate(birth) && Date.parse(birth) <= Date.parse(now) ? birth : now;

export const createIncident = (n: NewIncident): IncidentEnvelope => {
  const premiereOccurrence = birthOf(n.now, n.birth);
  return {
    version: ENVELOPE_VERSION,
    id: incidentId(n.flux, n.classe, premiereOccurrence),
    empreinte: fingerprintOf(n.flux, n.classe),
    flux: n.flux,
    classe: n.classe,
    source: n.source,
    etat: 'ouvert',
    priorite: n.priorite,
    impact: n.impact,
    premiereOccurrence,
    derniereOccurrence: n.now,
    occurrences: 1,
    ouvertures: 1,
    fermeLe: null,
    enquetes: { demandees: 0, horodatages: [] },
    derniereDecision: null,
    causedBy: n.causedBy,
    incidentRootId: n.incidentRootId,
    nonFiable: { detail: sanitizeDetail(n.detail) },
  };
};

/** Un passage qui revoit la panne : detail du controle et severite courante. */
export interface Sighting {
  detail: string;
  now: string;
  priorite: Priority;
  impact: Impact;
}

const sighted = (e: IncidentEnvelope, s: Sighting) => ({
  occurrences: e.occurrences + 1,
  derniereOccurrence: s.now,
  priorite: s.priorite,
  impact: s.impact,
  nonFiable: { detail: sanitizeDetail(s.detail) },
});

/** Empreinte deja ouverte : une occurrence de plus, jamais un nouvel incident. */
export const recordOccurrence = (e: IncidentEnvelope, s: Sighting): IncidentEnvelope => {
  if (!isOpen(e)) throw new Error(`occurrence sur un incident fermé (${e.id}) : le rouvrir`);
  return { ...e, ...sighted(e, s) };
};

/** Nouvelle panne apres fermeture : le MEME incident, rouvert, occurrences cumulees. */
export const reopenIncident = (e: IncidentEnvelope, s: Sighting): IncidentEnvelope => ({
  ...moveTo(e, 'rouvert'),
  ...sighted(e, s),
  ouvertures: e.ouvertures + 1,
  fermeLe: null,
});

/** Retour a la normale (ou symptome qui disparait) : ferme, horodate. */
export const closeIncident = (e: IncidentEnvelope, nowIso: string): IncidentEnvelope => ({
  ...moveTo(e, 'ferme'),
  fermeLe: nowIso,
});

/** Pose la demande d'enquete (compteur + horodatage). Ne declenche rien. */
export const requestInvestigation = (e: IncidentEnvelope, nowIso: string): IncidentEnvelope => {
  if (e.enquetes.demandees >= INCIDENT_LIMITS.maxInvestigationsPerIncident) {
    throw new Error(
      `plafond de ${INCIDENT_LIMITS.maxInvestigationsPerIncident} enquêtes atteint (${e.id})`
    );
  }
  return {
    ...moveTo(e, 'enquete_demandee'),
    enquetes: {
      demandees: e.enquetes.demandees + 1,
      horodatages: [...e.enquetes.horodatages, nowIso],
    },
  };
};

/** Etape 2 : une sortie valide de l'analyste a ete ingeree. Rien ne l'appelle en etape 1. */
export const markDiagnosed = (e: IncidentEnvelope): IncidentEnvelope => moveTo(e, 'diagnostique');
