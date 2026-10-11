/**
 * envelope.ts — contrat IncidentEnvelope v1 (CHG-012, etape 1 : plan de controle).
 *
 * Schema JSON ferme et versionne. parseEnvelope() reconstruit une enveloppe typee
 * depuis une valeur inconnue et rejette tout champ inconnu (a tous les niveaux),
 * toute valeur hors liste fermee et toute incoherence (empreinte, compteurs,
 * dates). `nonFiable` porte les DONNEES libres (detail du controle, extraits de
 * journaux) : jamais interpretees, jamais executees, jamais une instruction.
 *
 * Contrat lisible : docs/contrats/incident-envelope.md
 */

import {
  SchemaError,
  bool,
  count,
  date,
  dateOrNull,
  isIsoDate,
  isRecord,
  parseWith,
  pick,
  sub,
  text,
  textOrNull,
  type Json,
  type ParseResult,
} from './schema.js';

export const ENVELOPE_VERSION = 1;

/** Plafonds et valeurs par defaut du plan de controle : source unique. */
export const INCIDENT_LIMITS = {
  /** Enquetes demandees au plus par incident, reouvertures comprises. */
  maxInvestigationsPerIncident: 2,
  /** Delai minimal entre deux demandes d'enquete (surcharge : `incident.cooldownHeures`). */
  defaultCooldownHours: 6,
  /** Un incident ne dans ce delai apres une PR du reparateur ou de l'analyste lui est rattache. */
  correlationWindowHours: 24,
  /** Dossiers qui sonnent par jour civil Europe/Madrid (la priorite critique passe outre). */
  dailyRingCap: 7,
  /** Longueur maximale de `nonFiable.detail`. */
  maxDetailLength: 500,
} as const;

export const FLOW_TYPES = [
  'github-commits',
  'github-file-date',
  'github-workflow-runs',
  'https',
] as const;
export const SYMPTOM_CLASSES = [
  'silence',
  'echec_workflow',
  'http_ko',
  'erreur',
  'secret_absent',
] as const;
export const INCIDENT_STATES = [
  'ouvert',
  'enquete_demandee',
  'diagnostique',
  'ferme',
  'rouvert',
] as const;
/** Ordonnees de la plus basse a la plus haute. */
export const PRIORITIES = ['basse', 'normale', 'haute', 'critique'] as const;
export const IMPACTS = [
  'service_indisponible',
  'job_muet',
  'ci_rouge',
  'surveillance_aveugle',
] as const;
/** Etape 1 : seul `silence-watchdog` produit des incidents ; les deux autres sont reserves. */
export const DETECTORS = ['silence-watchdog', 'cliquet', 'producteur'] as const;
export const DECISION_MOTIVES = [
  'nouvel_incident',
  'rouvert_hors_cooldown',
  'incident_ferme',
  'enquete_en_cours',
  'deja_diagnostique',
  'priorite_sous_seuil',
  'plafond_atteint',
  'cooldown',
] as const;

export type FlowType = (typeof FLOW_TYPES)[number];
export type SymptomClass = (typeof SYMPTOM_CLASSES)[number];
export type IncidentState = (typeof INCIDENT_STATES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Impact = (typeof IMPACTS)[number];
export type Detector = (typeof DETECTORS)[number];
export type DecisionMotive = (typeof DECISION_MOTIVES)[number];

export interface IncidentSource {
  detecteur: Detector;
  typeFlux: FlowType | null;
  /** Depot `owner/repo` concerne (flux GitHub, ou surcharge `incident.depot`). */
  depot: string | null;
}
export interface InvestigationLog {
  demandees: number;
  /** Une date par enquete demandee, dans l'ordre. */
  horodatages: string[];
}
export interface DecisionRecord {
  enquete: boolean;
  motif: DecisionMotive;
  horodatage: string;
}
/** Donnees NON FIABLES : stockees masquees et bornees, jamais interpretees. */
export interface UntrustedData {
  detail: string;
}

export interface IncidentEnvelope {
  version: typeof ENVELOPE_VERSION;
  id: string;
  /** Empreinte logique `<flux>:<classe>` : une empreinte = un incident. */
  empreinte: string;
  flux: string;
  classe: SymptomClass;
  source: IncidentSource;
  etat: IncidentState;
  priorite: Priority;
  impact: Impact;
  premiereOccurrence: string;
  derniereOccurrence: string;
  occurrences: number;
  /** 1 a la creation, +1 a chaque reouverture. */
  ouvertures: number;
  /** Renseigne si et seulement si `etat` = `ferme`. */
  fermeLe: string | null;
  enquetes: InvestigationLog;
  derniereDecision: DecisionRecord | null;
  /** PR soupconnee, reference `owner/repo#n` (format des references Rappels). */
  causedBy: string | null;
  incidentRootId: string | null;
  nonFiable: UntrustedData;
}

export const FLUX_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export const ID_RE = /^inc-[A-Za-z0-9._-]{1,160}$/;
export const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const PR_REF_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9]\d*$/;
const MAX_COUNT = 1_000_000;

const readSource = (o: Json): IncidentSource => {
  const s = sub(o, 'source', ['detecteur', 'typeFlux', 'depot']);
  return {
    detecteur: pick(s, 'detecteur', DETECTORS),
    typeFlux: s.typeFlux === null ? null : pick(s, 'typeFlux', FLOW_TYPES),
    depot: textOrNull(s, 'depot', REPO_RE),
  };
};

const readInvestigations = (o: Json): InvestigationLog => {
  const s = sub(o, 'enquetes', ['demandees', 'horodatages']);
  const demandees = count(s, 'demandees', 0, INCIDENT_LIMITS.maxInvestigationsPerIncident);
  const raw: unknown = s.horodatages;
  const items: unknown[] = Array.isArray(raw) ? raw : [];
  const horodatages = items.filter(isIsoDate);
  const ordered = horodatages.slice(1).every((h, i) => Date.parse(h) >= Date.parse(horodatages[i]));
  if (!Array.isArray(raw) || horodatages.length !== items.length || items.length !== demandees) {
    throw new SchemaError('enquetes.horodatages : une date ISO UTC par enquête demandée');
  }
  if (!ordered) throw new SchemaError('enquetes.horodatages : dates croissantes attendues');
  return { demandees, horodatages };
};

const readDecision = (o: Json): DecisionRecord | null => {
  if (o.derniereDecision === null) return null;
  const d = sub(o, 'derniereDecision', ['enquete', 'motif', 'horodatage']);
  return {
    enquete: bool(d, 'enquete'),
    motif: pick(d, 'motif', DECISION_MOTIVES),
    horodatage: date(d, 'horodatage'),
  };
};

const readUntrusted = (o: Json): UntrustedData => {
  const n = sub(o, 'nonFiable', ['detail']);
  const max = INCIDENT_LIMITS.maxDetailLength;
  if (typeof n.detail !== 'string' || n.detail.length > max) {
    throw new SchemaError(`nonFiable.detail : texte de ${max} caractères au plus`);
  }
  return { detail: n.detail };
};

/**
 * Chaque champ est lu par un lecteur strict (un champ manquant le fait echouer) ;
 * l'enveloppe reconstruite est la liste fermee des cles : toute autre cle d'entree
 * est un champ inconnu, donc rejetee.
 */
const buildEnvelope = (input: unknown): IncidentEnvelope => {
  if (!isRecord(input)) throw new SchemaError('objet attendu');
  if (input.version !== ENVELOPE_VERSION) {
    throw new SchemaError(`version non supportée (attendu ${ENVELOPE_VERSION})`);
  }
  const flux = text(input, 'flux', FLUX_RE);
  const classe = pick(input, 'classe', SYMPTOM_CLASSES);
  if (input.empreinte !== `${flux}:${classe}`) throw new SchemaError('empreinte ≠ <flux>:<classe>');
  const etat = pick(input, 'etat', INCIDENT_STATES);
  const premiereOccurrence = date(input, 'premiereOccurrence');
  const derniereOccurrence = date(input, 'derniereOccurrence');
  if (Date.parse(derniereOccurrence) < Date.parse(premiereOccurrence)) {
    throw new SchemaError('derniereOccurrence antérieure à premiereOccurrence');
  }
  const fermeLe = dateOrNull(input, 'fermeLe');
  if ((etat === 'ferme') !== (fermeLe !== null)) {
    throw new SchemaError('fermeLe : renseigné si et seulement si etat = ferme');
  }
  const occurrences = count(input, 'occurrences', 1, MAX_COUNT);
  const enquetes = readInvestigations(input);
  if ((etat === 'enquete_demandee' || etat === 'diagnostique') && enquetes.demandees === 0) {
    throw new SchemaError(`etat ${etat} sans enquête demandée`);
  }
  const envelope: IncidentEnvelope = {
    version: ENVELOPE_VERSION,
    id: text(input, 'id', ID_RE),
    empreinte: `${flux}:${classe}`,
    flux,
    classe,
    source: readSource(input),
    etat,
    priorite: pick(input, 'priorite', PRIORITIES),
    impact: pick(input, 'impact', IMPACTS),
    premiereOccurrence,
    derniereOccurrence,
    occurrences,
    ouvertures: count(input, 'ouvertures', 1, occurrences),
    fermeLe,
    enquetes,
    derniereDecision: readDecision(input),
    causedBy: textOrNull(input, 'causedBy', PR_REF_RE),
    incidentRootId: textOrNull(input, 'incidentRootId', ID_RE),
    nonFiable: readUntrusted(input),
  };
  const unknownKeys = Object.keys(input).filter((k) => !Object.hasOwn(envelope, k));
  if (unknownKeys.length > 0) throw new SchemaError(`champ inconnu ${unknownKeys.join(', ')}`);
  return envelope;
};

/**
 * Valide une valeur inconnue contre le schema v1 ferme. Rend une enveloppe
 * neuve (jamais l'objet d'entree), ou l'erreur du premier ecart trouve.
 */
export const parseEnvelope = (input: unknown): ParseResult<IncidentEnvelope> =>
  parseWith(() => buildEnvelope(input), 'enveloppe');
