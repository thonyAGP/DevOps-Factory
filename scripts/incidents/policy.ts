/**
 * policy.ts — moteur de politiques deterministe (CHG-012).
 *
 * Toute action recommandee par l'analyste passe par ici. Le modele RECOMMANDE,
 * ce module DECIDE : `abstention`, `pr_preparee` ou `auto`. `auto` n'est possible
 * que pour une remediation PRE-ECRITE de AUTO_ALLOWED, vide et gelee tant que la
 * politique de promotion (decision 3 d'Anthony) n'est pas ecrite. En mode
 * `shadow` (defaut), la sortie est TOUJOURS `abstention`, quoi qu'on lui passe.
 */

import type { IncidentEnvelope } from './envelope.js';
import { isOneOf } from './schema.js';

export const RECOMMENDED_ACTIONS = [
  'rien',
  'humain',
  'pr',
  'relancer_job',
  'repousser_rappel',
] as const;
export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];

export const POLICY_OUTPUTS = ['abstention', 'pr_preparee', 'auto'] as const;
export type PolicyOutput = (typeof POLICY_OUTPUTS)[number];

export const POLICY_MODES = ['shadow', 'actif'] as const;
export type PolicyMode = (typeof POLICY_MODES)[number];

export const DEFAULT_POLICY_MODE: PolicyMode = 'shadow';

/** Remediations pre-ecrites autorisees en automatique. VIDE : rien n'est automatique. */
export const AUTO_ALLOWED: readonly RecommendedAction[] = Object.freeze([]);

export type PolicyMotive =
  | 'mode_shadow'
  | 'action_inconnue'
  | 'incident_ferme'
  | 'sans_diagnostic'
  | 'action_humaine_ou_nulle'
  | 'action_pre_ecrite'
  | 'pr_proposee'
  | 'action_non_autorisee';

export interface PolicyInput {
  envelope: IncidentEnvelope;
  /** Sortie de l'analyste : donnee NON FIABLE, validee ici contre la liste fermee. */
  action: unknown;
  mode?: PolicyMode;
  autoAllowed?: readonly RecommendedAction[];
}

export interface PolicyDecision {
  sortie: PolicyOutput;
  motif: PolicyMotive;
}

const abstain = (motif: PolicyMotive): PolicyDecision => ({ sortie: 'abstention', motif });

export const decidePolicy = (input: PolicyInput): PolicyDecision => {
  // Seule la valeur exacte `actif` sort du mode shadow : toute autre valeur s'abstient.
  if ((input.mode ?? DEFAULT_POLICY_MODE) !== 'actif') return abstain('mode_shadow');
  const action = input.action;
  if (!isOneOf(RECOMMENDED_ACTIONS, action)) return abstain('action_inconnue');
  const etat = input.envelope.etat;
  if (etat === 'ferme') return abstain('incident_ferme');
  if (etat !== 'diagnostique') return abstain('sans_diagnostic');
  if (action === 'rien' || action === 'humain') return abstain('action_humaine_ou_nulle');
  if ((input.autoAllowed ?? AUTO_ALLOWED).includes(action)) {
    return { sortie: 'auto', motif: 'action_pre_ecrite' };
  }
  if (action === 'pr') return { sortie: 'pr_preparee', motif: 'pr_proposee' };
  return abstain('action_non_autorisee');
};
