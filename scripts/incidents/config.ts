/**
 * config.ts — severite par classe de symptome et surcharges par flux.
 *
 * Surcharge : cle optionnelle `incident` d'un flux de data/silence-watchdog.json,
 *   "incident": { "cooldownHeures": 12, "priorite": "critique", "depot": "owner/repo" }
 * Toute valeur invalide leve une erreur : le plan d'incidents s'arrete en ERREUR
 * (code de sortie non nul), une surcharge n'est jamais ignoree en silence.
 */

import {
  INCIDENT_LIMITS,
  PRIORITIES,
  REPO_RE,
  type Impact,
  type Priority,
  type SymptomClass,
} from './envelope.js';
import { isErrorClass } from './fingerprint.js';
import { isOneOf, isRecord } from './schema.js';

export interface FlowIncidentConfig {
  cooldownHeures: number;
  priorite: Priority | null;
  depot: string | null;
}

export interface Severity {
  impact: Impact;
  priorite: Priority;
}

/** Priorite a partir de laquelle une enquete est demandee. */
export const INVESTIGATION_THRESHOLD: Priority = 'haute';

/** Impact et priorite par defaut de chaque classe de symptome. */
export const CLASS_SEVERITY: Readonly<Record<SymptomClass, Severity>> = {
  silence: { impact: 'job_muet', priorite: 'haute' },
  echec_workflow: { impact: 'ci_rouge', priorite: 'haute' },
  http_ko: { impact: 'service_indisponible', priorite: 'haute' },
  erreur: { impact: 'surveillance_aveugle', priorite: 'normale' },
  secret_absent: { impact: 'surveillance_aveugle', priorite: 'normale' },
};

const MAX_COOLDOWN_HOURS = 24 * 30;
const CONFIG_KEYS = ['cooldownHeures', 'priorite', 'depot'];

export const priorityRank = (p: Priority): number => PRIORITIES.indexOf(p);

/** Lit et valide la cle `incident` d'un flux (absente : valeurs par defaut). */
export const parseFlowIncidentConfig = (raw: unknown, flowId: string): FlowIncidentConfig => {
  const where = `flux ${flowId}, clé incident`;
  if (raw === undefined) {
    return { cooldownHeures: INCIDENT_LIMITS.defaultCooldownHours, priorite: null, depot: null };
  }
  if (!isRecord(raw)) throw new Error(`${where} : objet attendu`);
  const unknownKeys = Object.keys(raw).filter((k) => !CONFIG_KEYS.includes(k));
  if (unknownKeys.length > 0) throw new Error(`${where} : champ inconnu ${unknownKeys.join(', ')}`);
  const {
    cooldownHeures = INCIDENT_LIMITS.defaultCooldownHours,
    priorite = null,
    depot = null,
  } = raw;
  if (
    typeof cooldownHeures !== 'number' ||
    !Number.isFinite(cooldownHeures) ||
    cooldownHeures < 0 ||
    cooldownHeures > MAX_COOLDOWN_HOURS
  ) {
    throw new Error(`${where} : cooldownHeures entre 0 et ${MAX_COOLDOWN_HOURS} attendu`);
  }
  if (priorite !== null && !isOneOf(PRIORITIES, priorite)) {
    throw new Error(`${where} : priorite parmi ${PRIORITIES.join(', ')}`);
  }
  if (depot !== null && (typeof depot !== 'string' || !REPO_RE.test(depot))) {
    throw new Error(`${where} : depot au format owner/repo`);
  }
  return { cooldownHeures, priorite, depot };
};

/**
 * Severite d'une classe pour un flux. La surcharge de priorite vise la PANNE du
 * flux : elle ne s'applique pas aux classes d'erreur (controle impossible).
 */
export const resolveSeverity = (classe: SymptomClass, cfg: FlowIncidentConfig): Severity => {
  const base = CLASS_SEVERITY[classe];
  return cfg.priorite && !isErrorClass(classe) ? { ...base, priorite: cfg.priorite } : base;
};
