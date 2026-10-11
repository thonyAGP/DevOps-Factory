/**
 * silence-watchdog-alerts.ts — politique d'alerte Telegram du watchdog : sobre.
 *
 * decide() (silence-watchdog.ts) calcule les transitions et leurs messages CANDIDATS ;
 * ce module dit, flux par flux, lesquels partent, en s'appuyant sur le plan d'incidents
 * du MEME passage (scripts/incidents/, CHG-012) :
 *  - panne (SILENCE, ROUGE, PANNE) et erreur de controle (secret absent, controle
 *    impossible), meme regle : un message a l'ouverture de l'alerte, ou a l'entree dans
 *    l'erreur, si son incident est NOUVEAU, ou ROUVERT au moins `cooldownHeures` apres sa
 *    fermeture (defaut 6 h, surcharge `incident.cooldownHeures` du flux) ; rouvert plus
 *    tot : silence ; alerte ou erreur qui dure : silence, jamais de rappel ;
 *  - retour a la normale : silence, sauf `notifyRecovery: true` sur le flux (et seulement
 *    si l'ouverture de cette alerte est partie).
 * L'anti-doublon est celui du watchdog (`alertOpenSince`, `errorOpenSince`) : un candidat
 * n'existe qu'a l'ouverture. Plan d'incidents en panne ou muet sur le flux : l'ouverture
 * part (jamais un silence par defaut). Un envoi echoue est annule (rollbackFailed) puis
 * rejoue au passage suivant (motif `rejeu`).
 *
 * Passage planifie redondant (deux crons par creneau de 6 h) : moins d'1 h apres un
 * passage complet, `--skip-if-recent` ne controle, n'ecrit ni ne pingue rien.
 *
 * Logique pure, aucun effet ; types seulement depuis silence-watchdog.ts (pas de cycle).
 */

import { VERDICT_STATUS } from './incidents/integration.js';
import type {
  Declaration,
  Decision,
  Flow,
  FlowState,
  Notification,
  WatchdogState,
} from './silence-watchdog.js';

const HOUR_MS = 3_600_000;

/** Option du cron : passage ignore si un passage complet a eu lieu il y a moins de RECENT_RUN_HOURS. */
export const SKIP_IF_RECENT = '--skip-if-recent';
export const RECENT_RUN_HOURS = 1;

/** Ce que le plan d'incidents du passage a fait d'une panne ou d'une erreur vue (PlanResult). */
export interface SightingEvent {
  flux: string;
  kind: 'nouveau' | 'occurrence' | 'rouvert';
  /** Fermeture que la reouverture interrompt (`rouvert`), sinon null. */
  fermeAvant: string | null;
  /** Cooldown du flux : `incident.cooldownHeures`, defaut 6 h. */
  cooldownHeures: number;
}

export type AlertOutcome = 'message' | 'silence' | 'rien';

/** Motifs fermes de la politique et ce que chacun donne. */
const OUTCOME_OF = {
  nouvel_incident: 'message',
  rouvert_hors_cooldown: 'message',
  /** Ouverture jamais remise (envoi echoue au passage precedent) : empreinte deja ouverte. */
  rejeu: 'message',
  /** Plan d'incidents en panne ou muet sur le flux : anti-doublon du watchdog seul. */
  plan_indisponible: 'message',
  retour_notifie: 'message',
  alerte_deja_ouverte: 'silence',
  /** Erreur de controle qui dure : annoncee a son entree seulement, aucun rappel. */
  erreur_deja_ouverte: 'silence',
  rouvert_dans_cooldown: 'silence',
  retour_silencieux: 'silence',
  retour_sans_alerte_envoyee: 'silence',
  flux_sain: 'rien',
  doute: 'rien',
  en_attente: 'rien',
} as const satisfies Readonly<Record<string, AlertOutcome>>;

export type AlertMotive = keyof typeof OUTCOME_OF;

export const outcomeOf = (motif: AlertMotive): AlertOutcome => OUTCOME_OF[motif];

export interface AlertDecision {
  flux: string;
  motif: AlertMotive;
}

export interface AlertPolicyInput {
  decl: Declaration;
  /** Etat d'avant le passage : derniere ouverture d'alerte partie (`lastAlertAt`). */
  prev: WatchdogState;
  /** Sortie de decide() : messages candidats, verdicts, etat du passage. */
  decision: Decision;
  /** `evenements` du plan d'incidents du passage ; null : plan en panne. */
  events: readonly SightingEvent[] | null;
  now: Date;
}

export interface AlertPolicyResult {
  /** Candidats retenus, a envoyer. */
  notifications: Notification[];
  /** Une decision par flux declare, dans l'ordre de la declaration. */
  decisions: AlertDecision[];
  /** Declaration invalide (`notifyRecovery` non booleen) : ERREUR du passage. */
  errors: string[];
}

const hoursSince = (iso: string, now: Date): number => (now.getTime() - Date.parse(iso)) / HOUR_MS;

/** Ouverture d'alerte, ou entree dans une erreur de controle : l'evenement du plan decide. */
const openingMotive = (event: SightingEvent | undefined, now: Date): AlertMotive => {
  if (!event) return 'plan_indisponible';
  if (event.kind === 'nouveau') return 'nouvel_incident';
  if (event.kind === 'occurrence') return 'rejeu';
  const closedFor = event.fermeAvant === null ? Infinity : hoursSince(event.fermeAvant, now);
  return closedFor < event.cooldownHeures ? 'rouvert_dans_cooldown' : 'rouvert_hors_cooldown';
};

/** Retour a la normale : silence, sauf `notifyRecovery: true` et ouverture partie. */
const recoveryMotive = (flow: Flow, before: FlowState | undefined): AlertMotive => {
  if (flow.notifyRecovery !== true) return 'retour_silencieux';
  const opened = before?.alertOpenSince ?? null;
  const sent = before?.lastAlertAt ?? null;
  if (opened === null || sent === null) return 'retour_sans_alerte_envoyee';
  return Date.parse(sent) >= Date.parse(opened) ? 'retour_notifie' : 'retour_sans_alerte_envoyee';
};

const motiveOf = (
  flow: Flow,
  candidate: Notification | undefined,
  input: AlertPolicyInput
): AlertMotive => {
  if (flow.pending) return 'en_attente';
  if (candidate?.kind === 'alerte' || candidate?.kind === 'erreur') {
    const event = input.events?.find((e) => e.flux === flow.id);
    return openingMotive(event, input.now);
  }
  if (candidate?.kind === 'retour') return recoveryMotive(flow, input.prev.flows[flow.id]);
  const status = input.decision.verdicts.find((v) => v.id === flow.id)?.status ?? '';
  if (status === VERDICT_STATUS.erreur) return 'erreur_deja_ouverte';
  if (input.decision.state.flows[flow.id]?.alertOpenSince) return 'alerte_deja_ouverte';
  return status.startsWith(VERDICT_STATUS.doutePrefix) ? 'doute' : 'flux_sain';
};

/** Decision par flux et messages a envoyer. L'etat n'est horodate qu'apres envoi (markDelivered). */
export const applyAlertPolicy = (input: AlertPolicyInput): AlertPolicyResult => {
  const candidates = new Map(input.decision.notifications.map((n) => [n.key, n]));
  const result: AlertPolicyResult = { notifications: [], decisions: [], errors: [] };
  for (const flow of input.decl.flows) {
    const { notifyRecovery } = flow;
    if (notifyRecovery !== undefined && typeof notifyRecovery !== 'boolean') {
      result.errors.push(`flux ${flow.id} : notifyRecovery doit valoir true ou false`);
    }
    const candidate = candidates.get(flow.id);
    const motif = motiveOf(flow, candidate, input);
    result.decisions.push({ flux: flow.id, motif });
    if (candidate && outcomeOf(motif) === 'message') result.notifications.push(candidate);
  }
  return result;
};

/** Ligne de journal : `[alerte] <flux> : message|silence|rien (<motif>)`. */
export const describeAlertDecision = (d: AlertDecision): string =>
  `[alerte] ${d.flux} : ${outcomeOf(d.motif)} (${d.motif})`;

/** Horodate les ouvertures d'alerte effectivement parties (`notifyRecovery` les relit). */
export const markDelivered = (
  state: WatchdogState,
  delivered: readonly Notification[],
  nowIso: string
): WatchdogState => {
  const flows = { ...state.flows };
  for (const n of delivered) {
    const flow = flows[n.key];
    if (flow && n.kind === 'alerte') flows[n.key] = { ...flow, lastAlertAt: nowIso };
  }
  return { ...state, flows };
};

/** Age (h) du dernier passage complet s'il date de moins de RECENT_RUN_HOURS, sinon null. */
export const recentRunAge = (state: WatchdogState, now: Date): number | null => {
  if (!state.lastRunAt) return null;
  const age = hoursSince(state.lastRunAt, now);
  return age >= 0 && age < RECENT_RUN_HOURS ? age : null;
};
