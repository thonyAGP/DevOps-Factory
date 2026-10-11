/**
 * integration.ts — branchement du plan d'incidents dans le watchdog (CHG-012, etape 1).
 *
 * Apres le calcul des verdicts d'un passage : chaque verdict non-OK devient (ou
 * alimente) un incident, un retour a la normale le ferme, et la decision
 * « enquete necessaire ? » est POSEE sur l'enveloppe. Rien n'est envoye ni
 * declenche. Les alertes Telegram et data/silence-watchdog-state.json sont ceux
 * du watchdog, calcules et ecrits AVANT ce plan, qui ne peut ni les bloquer ni
 * les modifier. Une panne de ce plan est une ERREUR du passage (code de sortie
 * non nul, cliquet /fail) : jamais un echec silencieux.
 */

import type {
  CheckOutcome,
  Declaration,
  Deps,
  Flow,
  Verdict,
  WatchdogState,
} from '../silence-watchdog.js';
import { parseFlowIncidentConfig, resolveSeverity, type FlowIncidentConfig } from './config.js';
import { correlate, type RepairPr } from './correlation.js';
import { applyInvestigationDecision, decideInvestigation, describeDecision } from './decision.js';
import type { IncidentEnvelope, IncidentSource } from './envelope.js';
import { errorClassOf, failureClassOf, fingerprintOf } from './fingerprint.js';
import {
  birthOf,
  closeIncident,
  createIncident,
  isOpen,
  recordOccurrence,
  reopenIncident,
  shouldClose,
  type Observation,
} from './lifecycle.js';
import {
  ensureMemory,
  INCIDENTS_DIR,
  INCIDENTS_PATH,
  loadIncidents,
  serializeIncidents,
  type StoreIo,
} from './store.js';

/** Statuts de verdict de silence-watchdog.ts (les tests verifient la correspondance). */
export const VERDICT_STATUS = {
  ok: 'OK',
  erreur: 'ERREUR',
  enAttente: 'EN ATTENTE',
  doutePrefix: 'DOUTE ',
} as const;
/** Mots d'alerte du watchdog (alertWord) : SILENCE, ROUGE, PANNE. */
export const ALERT_STATUSES: readonly string[] = ['SILENCE', 'ROUGE', 'PANNE'];

/** Traduit le verdict d'un flux en observation ; un statut inconnu est une erreur, jamais devine. */
export const observationOf = (
  flow: Flow,
  verdict: Verdict,
  outcome: CheckOutcome | undefined
): Observation => {
  const { status, line } = verdict;
  if (flow.pending || status === VERDICT_STATUS.enAttente) return { kind: 'ignore' };
  if (status === VERDICT_STATUS.ok) return { kind: 'sain' };
  if (status === VERDICT_STATUS.erreur) {
    const error = outcome?.kind === 'error' ? outcome.error : line;
    return { kind: 'erreur', classe: errorClassOf(error), detail: line };
  }
  if (status.startsWith(VERDICT_STATUS.doutePrefix)) return { kind: 'doute' };
  if (ALERT_STATUSES.includes(status)) {
    return { kind: 'panne', classe: failureClassOf(flow.type), detail: line };
  }
  throw new Error(`statut de verdict inconnu « ${status} » (${flow.id})`);
};

export interface PlanInput {
  decl: Declaration;
  outcomes: Record<string, CheckOutcome>;
  verdicts: readonly Verdict[];
  /** Etat calcule par le watchdog pour ce passage : date la naissance d'une alerte deja ouverte. */
  state: WatchdogState;
  now: Date;
  /** PR recentes du reparateur ou de l'analyste. Etape 1 : aucune source, liste vide. */
  recentPrs?: readonly RepairPr[];
}

export interface PlanResult {
  incidents: IncidentEnvelope[];
  journal: string[];
  /** Ids passes a `enquete_demandee` par CE passage : point d'accroche de l'etape 2. */
  enquetesDemandees: string[];
}

interface Ctx {
  input: PlanInput;
  nowIso: string;
  known: readonly IncidentEnvelope[];
  byFingerprint: Map<string, IncidentEnvelope>;
  journal: string[];
  enquetesDemandees: string[];
}

type Failure = Extract<Observation, { kind: 'panne' | 'erreur' }>;

const depotOf = (flow: Flow, cfg: FlowIncidentConfig): string | null =>
  cfg.depot ?? ('repo' in flow ? flow.repo : null);

/** Ferme les incidents ouverts du flux que l'observation dement (retour a la normale...). */
const closeFor = (flow: Flow, obs: Observation, ctx: Ctx): void => {
  for (const e of [...ctx.byFingerprint.values()]) {
    if (e.flux !== flow.id || !isOpen(e) || !shouldClose(e.classe, obs)) continue;
    ctx.byFingerprint.set(e.empreinte, closeIncident(e, ctx.nowIso));
    ctx.journal.push(`[incident] ${e.empreinte} : fermé ${e.id}`);
  }
};

/** Empreinte ouverte : occurrence ; fermee : reouverture ; inconnue : nouvel incident. */
const openOrSight = (
  flow: Flow,
  obs: Failure,
  cfg: FlowIncidentConfig,
  ctx: Ctx
): { next: IncidentEnvelope; event: string } => {
  const severity = resolveSeverity(obs.classe, cfg);
  const existing = ctx.byFingerprint.get(fingerprintOf(flow.id, obs.classe));
  const sighting = { detail: obs.detail, now: ctx.nowIso, ...severity };
  if (existing && isOpen(existing)) {
    const next = recordOccurrence(existing, sighting);
    return { next, event: `occurrence ${next.occurrences} de ${next.id}` };
  }
  if (existing) {
    const next = reopenIncident(existing, sighting);
    return { next, event: `rouvert ${next.id} (ouverture ${next.ouvertures})` };
  }
  const source: IncidentSource = {
    detecteur: 'silence-watchdog',
    typeFlux: flow.type,
    depot: depotOf(flow, cfg),
  };
  const alertSince = obs.kind === 'panne' ? ctx.input.state.flows[flow.id]?.alertOpenSince : null;
  const birth = birthOf(ctx.nowIso, alertSince);
  const link = correlate({ depot: source.depot, at: birth }, ctx.input.recentPrs ?? [], ctx.known);
  const next = createIncident({
    flux: flow.id,
    classe: obs.classe,
    source,
    ...severity,
    detail: obs.detail,
    now: ctx.nowIso,
    birth,
    ...link,
  });
  return { next, event: `nouveau ${next.id}` };
};

const sight = (flow: Flow, obs: Failure, ctx: Ctx): void => {
  const cfg = parseFlowIncidentConfig(flow.incident, flow.id);
  const { next, event } = openOrSight(flow, obs, cfg, ctx);
  const decision = decideInvestigation(next, { cooldownHeures: cfg.cooldownHeures }, ctx.input.now);
  const final = applyInvestigationDecision(next, decision, ctx.input.now);
  ctx.byFingerprint.set(final.empreinte, final);
  if (decision.enquete) ctx.enquetesDemandees.push(final.id);
  const parts = [
    `[incident] ${final.empreinte} : ${event}`,
    `état ${final.etat}, priorité ${final.priorite}`,
    describeDecision(decision),
  ];
  if (final.causedBy) parts.push(`causé par ${final.causedBy}`);
  ctx.journal.push(parts.join(' ; '));
};

/** Coeur pur : incidents du passage precedent + verdicts du passage -> incidents, journal. */
export const planIncidents = (
  previous: readonly IncidentEnvelope[],
  input: PlanInput
): PlanResult => {
  const ctx: Ctx = {
    input,
    nowIso: input.now.toISOString(),
    known: previous,
    byFingerprint: new Map(previous.map((e) => [e.empreinte, e])),
    journal: [],
    enquetesDemandees: [],
  };
  const verdicts = new Map(input.verdicts.map((v) => [v.id, v]));
  for (const flow of input.decl.flows) {
    const verdict = verdicts.get(flow.id);
    if (!verdict) continue; // flux sans verdict : aucune observation, aucune affirmation
    const obs = observationOf(flow, verdict, input.outcomes[flow.id]);
    closeFor(flow, obs, ctx);
    if (obs.kind === 'panne' || obs.kind === 'erreur') sight(flow, obs, ctx);
  }
  return {
    incidents: [...ctx.byFingerprint.values()],
    journal: ctx.journal,
    enquetesDemandees: ctx.enquetesDemandees,
  };
};

export interface IncidentPlaneArgs {
  input: PlanInput;
  io: Pick<Deps, 'readFile' | 'writeFile' | 'writeFileAtomic'>;
  dryRun: boolean;
  /** Masque les secrets connus du passage (jetons, secrets des flux). */
  redact: (text: string) => string;
  log: (msg: string) => void;
  /** Erreurs du passage : une panne du plan y est ajoutee (code de sortie non nul). */
  errors: string[];
}

/** Effets : lit data/incidents/, journalise, ecrit hors dry-run. Ne leve jamais. */
export const runIncidentPlane = (args: IncidentPlaneArgs): PlanResult | null => {
  const { io, dryRun, redact, log } = args;
  try {
    const store: StoreIo = { readFile: io.readFile, write: io.writeFileAtomic ?? io.writeFile };
    const loaded = loadIncidents(store);
    if (!loaded.ok) throw new Error(`${loaded.error} (fichier laissé intact)`);
    // Le detail d'un verdict peut citer une erreur ou une reponse distante : masque avant stockage.
    const verdicts = args.input.verdicts.map((v) => ({ ...v, line: redact(v.line) }));
    const plan = planIncidents(loaded.value, { ...args.input, verdicts });
    for (const line of plan.journal) log(line);
    const open = plan.incidents.filter(isOpen).length;
    // ETAPE 2 (CHG-012), point d'accroche : `plan.enquetesDemandees` liste les incidents
    // passes a `enquete_demandee` par ce passage. L'etape 2 y branchera le declencheur de
    // la routine « analyste » (API fire, ou repli planifie qui relit data/incidents/), puis
    // le moteur de politiques (policy.ts) et le budget d'attention (budget.ts) avant tout
    // dossier Rappels. Etape 1 : rien n'est declenche, la demande reste posee sur l'enveloppe.
    log(
      `[incidents] ${open} ouvert(s), ${plan.enquetesDemandees.length} enquête(s) demandée(s) ce passage, aucune déclenchée (étape 1)`
    );
    if (dryRun) {
      log(`[incidents] dry-run : ${INCIDENTS_DIR}/ non écrit`);
      return plan;
    }
    const content = serializeIncidents(plan.incidents);
    if (redact(content) !== content) throw new Error('secret détecté, écriture refusée');
    store.write(INCIDENTS_PATH, content);
    ensureMemory(store);
    log(`[incidents] ${INCIDENTS_PATH} écrit (${plan.incidents.length} incident(s))`);
    return plan;
  } catch (e) {
    args.errors.push(`incidents : ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
};
