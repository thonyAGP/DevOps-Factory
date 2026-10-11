/**
 * decision.ts — « enquete necessaire ? » : deterministe, journalisee, motif ferme.
 *
 * La premiere regle qui s'applique donne le motif :
 *  1. etat ferme -> non (incident_ferme) ; enquete_demandee -> non (enquete_en_cours) ;
 *     diagnostique -> non (deja_diagnostique)
 *  2. priorite sous le seuil (haute par defaut) -> non (priorite_sous_seuil)
 *  3. maxInvestigationsPerIncident deja demandees -> non (plafond_atteint)
 *  4. derniere demande plus recente que le cooldown du flux -> non (cooldown)
 *  5. sinon oui : ouvert -> nouvel_incident ; rouvert -> rouvert_hors_cooldown
 *
 * La decision est POSEE sur l'enveloppe (etat, compteur, derniereDecision) ;
 * rien n'est declenche ici (etape 2 : routine analyste).
 */

import { INVESTIGATION_THRESHOLD, priorityRank } from './config.js';
import {
  INCIDENT_LIMITS,
  type DecisionMotive,
  type IncidentEnvelope,
  type Priority,
} from './envelope.js';
import { requestInvestigation } from './lifecycle.js';

const HOUR_MS = 3_600_000;

export interface InvestigationDecision {
  enquete: boolean;
  motif: DecisionMotive;
}

export interface DecisionOptions {
  cooldownHeures: number;
  seuil?: Priority;
}

const no = (motif: DecisionMotive): InvestigationDecision => ({ enquete: false, motif });

export const decideInvestigation = (
  e: IncidentEnvelope,
  opts: DecisionOptions,
  now: Date
): InvestigationDecision => {
  if (e.etat === 'ferme') return no('incident_ferme');
  if (e.etat === 'enquete_demandee') return no('enquete_en_cours');
  if (e.etat === 'diagnostique') return no('deja_diagnostique');
  if (priorityRank(e.priorite) < priorityRank(opts.seuil ?? INVESTIGATION_THRESHOLD)) {
    return no('priorite_sous_seuil');
  }
  if (e.enquetes.demandees >= INCIDENT_LIMITS.maxInvestigationsPerIncident) {
    return no('plafond_atteint');
  }
  const last = e.enquetes.horodatages.at(-1);
  if (last !== undefined && now.getTime() - Date.parse(last) < opts.cooldownHeures * HOUR_MS) {
    return no('cooldown');
  }
  return {
    enquete: true,
    motif: e.etat === 'rouvert' ? 'rouvert_hors_cooldown' : 'nouvel_incident',
  };
};

/** Pose la decision sur l'enveloppe : `derniereDecision` toujours, demande d'enquete si oui. */
export const applyInvestigationDecision = (
  e: IncidentEnvelope,
  d: InvestigationDecision,
  now: Date
): IncidentEnvelope => {
  const nowIso = now.toISOString();
  const decided: IncidentEnvelope = {
    ...e,
    derniereDecision: { enquete: d.enquete, motif: d.motif, horodatage: nowIso },
  };
  return d.enquete ? requestInvestigation(decided, nowIso) : decided;
};

export const describeDecision = (d: InvestigationDecision): string =>
  d.enquete ? `enquête demandée (${d.motif})` : `pas d'enquête (${d.motif})`;
