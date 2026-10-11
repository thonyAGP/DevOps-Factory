/**
 * silence-watchdog.ts
 *
 * Watchdog des pannes silencieuses : alerte (Telegram) quand un flux critique
 * N'A PAS produit son resultat attendu. Les flux sont observes de l'exterieur,
 * via l'API GitHub ou un GET HTTPS ; aucun flux surveille n'est modifie.
 *
 * Declaration : data/silence-watchdog.json
 * Etat persistant (anti-doublon) : data/silence-watchdog-state.json
 * Cadrage : .chantier/2026-10-08-watchdog-silence/change.md (invariants 1 a 5)
 *
 * Run : pnpm silence-watchdog [-- --dry-run | --skip-if-recent]
 * Cron : deux par creneau de 6 h (:00 et :30) via .github/workflows/silence-watchdog.yml ;
 * `--skip-if-recent` (cron seulement) : rien a refaire moins d'1 h apres un passage complet.
 *
 * Volontairement autonome : aucun import du reste du depot (le watchdog ne doit
 * pas tomber avec ce qu'il surveille). Logique pure separee des effets (deps).
 * Seules exceptions : son plan de controle d'incidents (scripts/incidents/, sans
 * dependance, CHG-012), appele AVANT les alertes, et sa politique d'alerte
 * (silence-watchdog-alerts.ts) qui s'appuie dessus : un message par incident (panne
 * ou erreur de controle) nouveau ou rouvert apres cooldown, jamais de rappel, retour
 * a la normale silencieux. Plan en panne : ERREUR du run, et l'anti-doublon du
 * watchdog decide seul (jamais un silence).
 *
 * Flux HTTPS authentifie (`auth`) : le secret est lu dans l'environnement, envoye
 * dans l'en-tete declare, masque dans tous les journaux ; absent => ERREUR du
 * watchdog (code de sortie non nul, message d'erreur de controle), jamais un faux
 * OK ni une alerte de panne.
 * Flux `pending` : declare, affiche [EN ATTENTE], jamais controle ni alerte.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { runIncidentPlane } from './incidents/integration.js';
import { writeFileAtomic as atomicWrite } from './incidents/store.js';
import {
  SKIP_IF_RECENT,
  applyAlertPolicy,
  describeAlertDecision,
  markDelivered,
  recentRunAge,
} from './silence-watchdog-alerts.js';

export const PREFIX = '🕯 Silence —';
export const DECL_PATH = 'data/silence-watchdog.json';
export const STATE_PATH = 'data/silence-watchdog-state.json';
const GITHUB_API = 'https://api.github.com';
const HOUR_MS = 3_600_000;
const COMMIT_PAGES = 3;
const RUNS_PER_WORKFLOW = 20;
const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);
const IGNORED_CONCLUSIONS = new Set(['cancelled', 'skipped', 'neutral', 'stale']);
export const PENDING_STATUS = 'EN ATTENTE';

// ---------------------------------------------------------------- types

interface FlowBase {
  id: string;
  label: string;
  /** Declare mais pas encore controlable : jamais controle ni alerte. */
  pending?: boolean;
  /** Pourquoi le flux attend (affiche avec [EN ATTENTE]). */
  pendingReason?: string;
  /**
   * Surcharges du plan d'incidents (CHG-012) : `{ cooldownHeures?, priorite?, depot? }`.
   * Lues et validees par scripts/incidents/config.ts, jamais par le watchdog.
   */
  incident?: unknown;
  /** `true` : message au retour a la normale (defaut : silencieux). Valide par la politique. */
  notifyRecovery?: unknown;
  /** Note libre pour le lecteur de la declaration, jamais lue par le code. */
  note?: string;
}
export interface CommitsFlow extends FlowBase {
  type: 'github-commits';
  repo: string;
  branch: string;
  messagePattern: string;
  thresholdHours: number;
}
export interface FileDateFlow extends FlowBase {
  type: 'github-file-date';
  repo: string;
  branch: string;
  path: string;
  dateRegex: string;
  thresholdHours: number;
}
export interface WorkflowRunsFlow extends FlowBase {
  type: 'github-workflow-runs';
  repo: string;
  branch?: string;
  workflows: string[];
  consecutiveRunFailures: number;
}
export interface HttpsAuth {
  /** En-tete porteur, ex. `x-cron-secret` ou `Authorization`. */
  header: string;
  /** Variable d'environnement qui contient le secret (jamais sa valeur). */
  env: string;
  /** Prefixe de la valeur, ex. `Bearer `. */
  prefix?: string;
}
export interface HttpsFlow extends FlowBase {
  type: 'https';
  url: string;
  expectStatus: number;
  /** Absent : le statut HTTP seul fait foi (ex. 401 attendu sans jeton). */
  expectJson?: Record<string, string>;
  consecutiveFailures: number;
  auth?: HttpsAuth;
}
export type Flow = CommitsFlow | FileDateFlow | WorkflowRunsFlow | HttpsFlow;
export interface Declaration {
  flows: Flow[];
}

export interface FlowState {
  alertOpenSince: string | null;
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  lastOkAt: string | null;
  /** Dernier message d'ouverture d'alerte PARTI (ajout du 12/10, absent des etats anterieurs). */
  lastAlertAt?: string | null;
  /** Erreur de controle en cours depuis : anti-doublon de ses messages (ajout du 12/10). */
  errorOpenSince?: string | null;
}
export interface WatchdogState {
  lastDailySummaryDate: string | null;
  /** Dernier passage complet hors dry-run : `--skip-if-recent` (ajout du 12/10). */
  lastRunAt?: string | null;
  flows: Record<string, FlowState>;
}

export interface CheckResult {
  healthy: boolean;
  detail: string;
  lastProofAt: string | null;
}
export type CheckOutcome =
  | { kind: 'checked'; result: CheckResult }
  | { kind: 'error'; error: string };

/** Message CANDIDAT : la politique d'alerte (silence-watchdog-alerts.ts) decide s'il part. */
export interface Notification {
  key: string; // flow id, or 'summary'
  kind: 'alerte' | 'retour' | 'erreur';
  text: string;
}
export interface Verdict {
  id: string;
  status: string;
  line: string;
}
export interface Decision {
  state: WatchdogState;
  notifications: Notification[];
  verdicts: Verdict[];
}

export interface WorkflowRun {
  conclusion: string | null;
  created_at: string;
}

// ---------------------------------------------------------------- pure logic

export const ageHours = (fromIso: string, now: Date): number =>
  (now.getTime() - new Date(fromIso).getTime()) / HOUR_MS;

export const formatAge = (hours: number): string => {
  if (hours < 1) return `${Math.max(0, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.floor(hours / 24)} j`;
};

export const madridParts = (now: Date): { date: string; hour: number } => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
};

export const formatMadrid = (iso: string): string =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Madrid',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

export const redact = (text: string, secrets: Array<string | undefined>): string =>
  secrets.reduce<string>((acc, s) => (s && s.length >= 4 ? acc.split(s).join('****') : acc), text);

export const freshnessResult = (
  lastIso: string | null,
  thresholdHours: number,
  now: Date,
  missingDetail: string
): CheckResult => {
  if (!lastIso) return { healthy: false, detail: missingDetail, lastProofAt: null };
  const age = ageHours(lastIso, now);
  return {
    healthy: age <= thresholdHours,
    detail: `dernière preuve le ${formatMadrid(lastIso)}, il y a ${formatAge(age)} (seuil ${thresholdHours} h)`,
    lastProofAt: lastIso,
  };
};

export const findLastMatchingCommit = (
  commits: Array<{ commit: { message: string; committer?: { date?: string } | null } }>,
  pattern: string
): string | null => {
  const re = new RegExp(pattern);
  const hit = commits.find((c) => re.test(c.commit.message));
  return hit?.commit.committer?.date ?? null;
};

export const extractFileDate = (content: string, dateRegex: string): string | null => {
  const m = new RegExp(dateRegex).exec(content);
  return m?.[1] ? `${m[1]}T00:00:00Z` : null;
};

export const evaluateWorkflowRuns = (
  runsByWorkflow: Record<string, WorkflowRun[]>,
  threshold: number,
  now: Date
): CheckResult => {
  const red: string[] = [];
  const redLastSuccess: Array<string | null> = [];
  let latestRun: string | null = null;
  for (const [wf, runs] of Object.entries(runsByWorkflow)) {
    const decisive = runs.filter((r) => !IGNORED_CONCLUSIONS.has(r.conclusion ?? ''));
    if (decisive[0] && (!latestRun || decisive[0].created_at > latestRun)) {
      latestRun = decisive[0].created_at;
    }
    const lastN = decisive.slice(0, threshold);
    const chronic =
      lastN.length >= threshold && lastN.every((r) => FAILED_CONCLUSIONS.has(r.conclusion ?? ''));
    if (!chronic) continue;
    const success = decisive.find((r) => r.conclusion === 'success')?.created_at ?? null;
    redLastSuccess.push(success);
    const since = success
      ? `dernier succès il y a ${formatAge(ageHours(success, now))}`
      : `aucun succès dans les ${runs.length} derniers runs`;
    red.push(`${wf} : ${threshold} échecs consécutifs (${since})`);
  }
  if (red.length === 0) {
    return {
      healthy: true,
      detail: `aucun workflow en échec chronique (${Object.keys(runsByWorkflow).join(', ')})`,
      lastProofAt: latestRun,
    };
  }
  const known = redLastSuccess.filter((s): s is string => s !== null).sort();
  return {
    healthy: false,
    detail: red.join(' ; '),
    lastProofAt: known.length === redLastSuccess.length ? (known[0] ?? null) : null,
  };
};

export const evaluateHttps = (
  flow: HttpsFlow,
  status: number,
  body: string,
  now: Date
): CheckResult => {
  const nowIso = now.toISOString();
  if (status !== flow.expectStatus) {
    return {
      healthy: false,
      detail: `HTTP ${status} (attendu ${flow.expectStatus})`,
      lastProofAt: null,
    };
  }
  if (!flow.expectJson) {
    return { healthy: true, detail: `HTTP ${status}, statut attendu`, lastProofAt: nowIso };
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { healthy: false, detail: 'réponse non JSON', lastProofAt: null };
  }
  const obj = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(flow.expectJson)) {
    if (obj[k] !== v) {
      return { healthy: false, detail: `${k}=${String(obj[k])} (attendu ${v})`, lastProofAt: null };
    }
  }
  return {
    healthy: true,
    detail: `HTTP ${status}, ${JSON.stringify(flow.expectJson)}`,
    lastProofAt: nowIso,
  };
};

/**
 * En-tetes d'un controle HTTPS. Un secret absent (ou vide : secret GitHub non
 * pose) leve une erreur : le watchdog n'a pas pu controler, ce n'est ni un OK
 * ni une panne du flux.
 */
export const httpsHeaders = (
  flow: HttpsFlow,
  env: Record<string, string | undefined>
): Record<string, string> => {
  if (!flow.auth) return {};
  const secret = env[flow.auth.env]?.trim();
  if (!secret) throw new Error(`secret ${flow.auth.env} absent`);
  return { [flow.auth.header]: `${flow.auth.prefix ?? ''}${secret}` };
};

/** Valeurs des secrets des flux authentifies, a masquer dans tous les journaux. */
export const authSecrets = (decl: Declaration, env: Record<string, string | undefined>): string[] =>
  decl.flows.flatMap((f) => {
    const value = f.type === 'https' && f.auth ? env[f.auth.env]?.trim() : undefined;
    return value ? [value] : [];
  });

export const pendingLine = (flow: Flow): string => {
  const base = 'déclaré, jamais contrôlé ni alerté';
  return flow.pendingReason ? `${base} (${flow.pendingReason})` : base;
};

export const failuresBeforeAlert = (flow: Flow): number =>
  flow.type === 'https' ? Math.max(1, flow.consecutiveFailures) : 1;

export const alertWord = (flow: Flow): string => {
  if (flow.type === 'github-workflow-runs') return 'ROUGE';
  if (flow.type === 'https') return 'PANNE';
  return 'SILENCE';
};

export const emptyFlowState = (): FlowState => ({
  alertOpenSince: null,
  consecutiveFailures: 0,
  lastCheckedAt: null,
  lastOkAt: null,
});

export const parseState = (raw: string | null): WatchdogState => {
  if (!raw) return { lastDailySummaryDate: null, flows: {} };
  try {
    const s = JSON.parse(raw) as Partial<WatchdogState>;
    // Lecture additive : un etat anterieur sans les champs du 12/10 reste valide.
    return {
      lastDailySummaryDate: s.lastDailySummaryDate ?? null,
      lastRunAt: s.lastRunAt ?? null,
      flows: s.flows ?? {},
    };
  } catch {
    return { lastDailySummaryDate: null, flows: {} };
  }
};

export const composeAlert = (flow: Flow, detail: string): string =>
  `${PREFIX} ${flow.label} : ${alertWord(flow)}. ${detail}`;

export const composeRecovery = (flow: Flow, since: string, detail: string): string =>
  `${PREFIX} ${flow.label} : retour à la normale (alerte ouverte depuis le ${formatMadrid(since)}). ${detail}`;

export const composeControlError = (flow: Flow, line: string): string =>
  `${PREFIX} ${flow.label} : ERREUR. ${line}`;

export const composeSummary = (
  date: string,
  verdicts: Verdict[],
  ages: Record<string, string>
): string => {
  const [, mm, dd] = date.split('-');
  const items = verdicts.map((v) => {
    const age = ages[v.id];
    return age ? `${v.id} ${v.status} (${age})` : `${v.id} ${v.status}`;
  });
  return `${PREFIX} récap du ${dd}/${mm} : ${items.join(' · ')}`;
};

/** Transition d'un flux controle : compteur d'echecs, ouverture/fermeture d'alerte. */
export const stepFlow = (
  flow: Flow,
  before: FlowState,
  r: CheckResult,
  nowIso: string
): { next: FlowState; notification: Notification | null; status: string } => {
  const failures = r.healthy ? 0 : before.consecutiveFailures + 1;
  const threshold = failuresBeforeAlert(flow);
  const alerting = failures >= threshold;
  const next: FlowState = {
    ...before,
    consecutiveFailures: failures,
    lastCheckedAt: nowIso,
    lastOkAt: r.healthy ? nowIso : before.lastOkAt,
  };
  // Controle fait : l'erreur de controle en cours, s'il y en avait une, est terminee.
  if (before.errorOpenSince) next.errorOpenSince = null;
  let notification: Notification | null = null;
  if (alerting && !before.alertOpenSince) {
    next.alertOpenSince = nowIso;
    notification = { key: flow.id, kind: 'alerte', text: composeAlert(flow, r.detail) };
  } else if (r.healthy && before.alertOpenSince) {
    next.alertOpenSince = null;
    const text = composeRecovery(flow, before.alertOpenSince, r.detail);
    notification = { key: flow.id, kind: 'retour', text };
  }
  let status = 'OK';
  if (alerting) status = alertWord(flow);
  else if (!r.healthy) status = `DOUTE ${failures}/${threshold}`;
  return { next, notification, status };
};

/** Coeur du watchdog : transitions d'etat + messages CANDIDATS (la politique d'alerte trie). */
export const decide = (
  decl: Declaration,
  prev: WatchdogState,
  outcomes: Record<string, CheckOutcome>,
  now: Date
): Decision => {
  const nowIso = now.toISOString();
  const state: WatchdogState = { lastDailySummaryDate: prev.lastDailySummaryDate, flows: {} };
  const notifications: Notification[] = [];
  const verdicts: Verdict[] = [];

  for (const flow of decl.flows) {
    const before = prev.flows[flow.id] ?? emptyFlowState();
    if (flow.pending) {
      // Jamais controle ni alerte ; un etat anterieur eventuel est garde tel quel.
      if (prev.flows[flow.id]) state.flows[flow.id] = { ...before };
      verdicts.push({ id: flow.id, status: PENDING_STATUS, line: pendingLine(flow) });
      continue;
    }
    const outcome = outcomes[flow.id];
    if (!outcome || outcome.kind === 'error') {
      // Anti-doublon des erreurs de controle : seule l'entree dans l'erreur donne un candidat.
      state.flows[flow.id] = { ...before, errorOpenSince: before.errorOpenSince ?? nowIso };
      const err = outcome ? outcome.error : 'non contrôlé';
      const line = `contrôle impossible : ${err}`;
      verdicts.push({ id: flow.id, status: 'ERREUR', line });
      if (!before.errorOpenSince) {
        notifications.push({ key: flow.id, kind: 'erreur', text: composeControlError(flow, line) });
      }
      continue;
    }
    const r = outcome.result;
    const step = stepFlow(flow, before, r, nowIso);
    if (step.notification) notifications.push(step.notification);
    state.flows[flow.id] = step.next;
    verdicts.push({ id: flow.id, status: step.status, line: r.detail });
  }

  // Pas de recapitulatif quotidien (decision Anthony 08/10 : un « tout va bien »
  // chaque jour est du bruit). Le temoin de vie du watchdog est le cliquet
  // externe (HEALTHCHECK_PING_URL) pingue en fin de run, cf. pingHealthcheck.
  return { state, notifications, verdicts };
};

/** Annule les transitions dont le message n'a pas pu partir (rejoue au run suivant). */
export const rollbackFailed = (
  next: WatchdogState,
  prev: WatchdogState,
  failedKeys: string[]
): WatchdogState => {
  const out: WatchdogState = { ...next, flows: { ...next.flows } };
  for (const key of failedKeys) {
    if (key === 'summary') {
      out.lastDailySummaryDate = prev.lastDailySummaryDate;
      continue;
    }
    const flow = out.flows[key];
    if (!flow) continue;
    // Marqueurs d'anti-doublon remis a leur valeur d'avant le passage : le message sera rejoue.
    const before = prev.flows[key];
    out.flows[key] = {
      ...flow,
      alertOpenSince: before?.alertOpenSince ?? null,
      errorOpenSince: before?.errorOpenSince ?? null,
    };
  }
  return out;
};

// ---------------------------------------------------------------- effects

export interface Deps {
  fetch: typeof fetch;
  readFile: (path: string) => string | null;
  writeFile: (path: string, content: string) => void;
  /** Ecriture atomique (dossier cree, temporaire puis rename) ; absente (tests) : writeFile. */
  writeFileAtomic?: (path: string, content: string) => void;
  env: Record<string, string | undefined>;
  now: () => Date;
  log: (msg: string) => void;
  logError: (msg: string) => void;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const githubGet = async (path: string, deps: Deps, accept = 'application/vnd.github+json') => {
  const headers: Record<string, string> = {
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'devops-factory-silence-watchdog',
  };
  if (deps.env.GH_TOKEN) headers.Authorization = `Bearer ${deps.env.GH_TOKEN}`;
  let res: Response;
  try {
    res = await deps.fetch(`${GITHUB_API}${path}`, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new Error(`GitHub injoignable (${path}) : ${errMsg(e)}`);
  }
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status} sur ${path}`);
  return res;
};

const checkCommits = async (flow: CommitsFlow, deps: Deps): Promise<CheckResult> => {
  let found: string | null = null;
  for (let page = 1; page <= COMMIT_PAGES && !found; page++) {
    const res = await githubGet(
      `/repos/${flow.repo}/commits?sha=${encodeURIComponent(flow.branch)}&per_page=100&page=${page}`,
      deps
    );
    const commits = (await res.json()) as Parameters<typeof findLastMatchingCommit>[0];
    found = findLastMatchingCommit(commits, flow.messagePattern);
    if (commits.length < 100) break;
  }
  const missing = `aucun commit « ${flow.messagePattern} » dans les ${COMMIT_PAGES * 100} derniers de ${flow.branch}`;
  return freshnessResult(found, flow.thresholdHours, deps.now(), missing);
};

const checkFileDate = async (flow: FileDateFlow, deps: Deps): Promise<CheckResult> => {
  const res = await githubGet(
    `/repos/${flow.repo}/contents/${flow.path}?ref=${encodeURIComponent(flow.branch)}`,
    deps,
    'application/vnd.github.raw+json'
  );
  const date = extractFileDate(await res.text(), flow.dateRegex);
  return freshnessResult(
    date,
    flow.thresholdHours,
    deps.now(),
    `aucune date trouvée dans ${flow.path}`
  );
};

const checkWorkflowRuns = async (flow: WorkflowRunsFlow, deps: Deps): Promise<CheckResult> => {
  const runsByWorkflow: Record<string, WorkflowRun[]> = {};
  const branch = flow.branch ? `&branch=${encodeURIComponent(flow.branch)}` : '';
  for (const wf of flow.workflows) {
    const res = await githubGet(
      `/repos/${flow.repo}/actions/workflows/${wf}/runs?status=completed&per_page=${RUNS_PER_WORKFLOW}${branch}`,
      deps
    );
    runsByWorkflow[wf] = ((await res.json()) as { workflow_runs: WorkflowRun[] }).workflow_runs;
  }
  return evaluateWorkflowRuns(runsByWorkflow, flow.consecutiveRunFailures, deps.now());
};

const checkHttps = async (flow: HttpsFlow, deps: Deps): Promise<CheckResult> => {
  // Hors du try : un secret absent est une erreur du watchdog, pas une panne du flux.
  const headers = httpsHeaders(flow, deps.env);
  try {
    const res = await deps.fetch(flow.url, {
      headers,
      // Avec un secret, ne jamais suivre de redirection : il partirait vers l'hote cible.
      redirect: flow.auth ? 'manual' : 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    return evaluateHttps(flow, res.status, await res.text(), deps.now());
  } catch (e) {
    // Une panne du flux surveille n'est PAS une erreur du watchdog (invariant 3).
    return { healthy: false, detail: `injoignable : ${errMsg(e)}`, lastProofAt: null };
  }
};

export const checkFlow = async (flow: Flow, deps: Deps): Promise<CheckOutcome> => {
  try {
    if (flow.type === 'github-commits')
      return { kind: 'checked', result: await checkCommits(flow, deps) };
    if (flow.type === 'github-file-date')
      return { kind: 'checked', result: await checkFileDate(flow, deps) };
    if (flow.type === 'github-workflow-runs') {
      return { kind: 'checked', result: await checkWorkflowRuns(flow, deps) };
    }
    return { kind: 'checked', result: await checkHttps(flow, deps) };
  } catch (e) {
    return { kind: 'error', error: errMsg(e) };
  }
};

export const sendTelegram = async (text: string, deps: Deps): Promise<void> => {
  const token = deps.env.TELEGRAM_BOT_TOKEN;
  const chatId = deps.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID absent');
  let res: Response;
  try {
    res = await deps.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Pas de parse_mode : texte brut, ne peut pas echouer sur un caractere.
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new Error(`Telegram injoignable : ${errMsg(e)}`);
  }
  if (res.status !== 200) throw new Error(`Telegram a répondu HTTP ${res.status}`);
};

/**
 * Cliquet externe (healthchecks.io ou equivalent) : GET sur l'URL apres un run
 * qui a pu controler et notifier, GET sur `<url>/fail` sinon. Si aucun ping
 * n'arrive dans le delai configure cote service, c'est LUI qui alerte : le
 * watchdog n'a donc pas besoin d'un message « tout va bien » pour prouver
 * qu'il vit. Un echec du ping ne change pas le code de sortie : l'absence de
 * ping est precisement ce que le cliquet detecte.
 */
export const pingHealthcheck = async (
  ok: boolean,
  deps: Deps,
  log: (m: string) => void
): Promise<void> => {
  const base = deps.env.HEALTHCHECK_PING_URL;
  if (!base) {
    log('cliquet : HEALTHCHECK_PING_URL absent, pas de ping');
    return;
  }
  const url = ok ? base : `${base.replace(/\/$/, '')}/fail`;
  try {
    const res = await deps.fetch(url, { method: 'GET', signal: AbortSignal.timeout(10_000) });
    log(`cliquet : ping ${ok ? 'ok' : 'fail'} → HTTP ${res.status}`);
  } catch (e) {
    log(`cliquet : ping impossible (${errMsg(e)})`);
  }
};

/** Envoie chaque notification ; retourne les cles dont l'envoi a echoue. */
const sendNotifications = async (
  notifications: Notification[],
  deps: Deps,
  log: (m: string) => void,
  errors: string[]
): Promise<string[]> => {
  const failed: string[] = [];
  for (const n of notifications) {
    try {
      await sendTelegram(n.text, deps);
      log(`envoyé : ${n.text}`);
    } catch (e) {
      failed.push(n.key);
      errors.push(`notification ${n.key} : ${errMsg(e)}`);
    }
  }
  return failed;
};

/** Dry-run : ce que la politique d'alerte enverrait. */
const logUnsent = (notifications: Notification[], log: (m: string) => void): void => {
  for (const n of notifications) log(`[dry-run] non envoyé : ${n.text}`);
  if (notifications.length === 0) log('[dry-run] aucun message à envoyer');
};

/** Point d'entree testable. Retourne le code de sortie. */
export const run = async (argv: string[], deps: Deps): Promise<number> => {
  const secrets = [deps.env.TELEGRAM_BOT_TOKEN, deps.env.GH_TOKEN, deps.env.HEALTHCHECK_PING_URL];
  const log = (m: string): void => deps.log(redact(m, secrets));
  const logError = (m: string): void => deps.logError(redact(m, secrets));
  const dryRun = argv.includes('--dry-run');

  const rawDecl = deps.readFile(DECL_PATH);
  if (!rawDecl) {
    logError(`ERREUR : déclaration introuvable (${DECL_PATH})`);
    return 1;
  }
  const decl = JSON.parse(rawDecl) as Declaration;
  // Secrets des flux authentifies : masques dans tout ce qui est journalise ensuite.
  secrets.push(...authSecrets(decl, deps.env));
  const prev = parseState(deps.readFile(STATE_PATH));

  // Second cron du creneau (silence-watchdog.yml) : ni controle, ni ecriture (donc aucun
  // commit), ni ping ; le passage complet de moins d'1 h a deja pingue le cliquet.
  const recent = argv.includes(SKIP_IF_RECENT) ? recentRunAge(prev, deps.now()) : null;
  if (recent !== null) {
    log(`silence-watchdog — passage complet il y a ${formatAge(recent)} : rien à refaire`);
    return 0;
  }

  log(`silence-watchdog${dryRun ? ' (dry-run)' : ''} — ${decl.flows.length} flux`);
  log(`token: ${deps.env.TELEGRAM_BOT_TOKEN ? '****' : '(absent)'}`);

  const outcomes: Record<string, CheckOutcome> = {};
  for (const flow of decl.flows) {
    if (!flow.pending) outcomes[flow.id] = await checkFlow(flow, deps);
  }

  const now = deps.now();
  const decision = decide(decl, prev, outcomes, now);
  const errors: string[] = [];
  for (const v of decision.verdicts) {
    log(`[${v.status}] ${v.id} — ${v.line}`);
    if (v.status === 'ERREUR') errors.push(`${v.id} : ${v.line}`);
  }

  // Plan de controle d'incidents (CHG-012) : AVANT les alertes, dont il nourrit la politique.
  // Ne leve jamais : en panne, c'est une ERREUR du passage et l'anti-doublon du watchdog
  // decide seul (une ouverture d'alerte part). Rien n'est declenche ; rien d'ecrit en dry-run.
  const plan = runIncidentPlane({
    input: { decl, outcomes, verdicts: decision.verdicts, state: decision.state, now },
    io: deps,
    dryRun,
    redact: (t) => redact(t, secrets),
    log,
    errors,
  });
  const alerts = applyAlertPolicy({ decl, prev, decision, events: plan?.evenements ?? null, now });
  for (const d of alerts.decisions) log(describeAlertDecision(d));
  errors.push(...alerts.errors);

  if (dryRun) {
    logUnsent(alerts.notifications, log);
  } else {
    // Le detail d'une alerte cite parfois une erreur reseau : masquee aussi avant envoi.
    const outgoing = alerts.notifications.map((n) => ({ ...n, text: redact(n.text, secrets) }));
    const failed = await sendNotifications(outgoing, deps, log, errors);
    const delivered = alerts.notifications.filter((n) => !failed.includes(n.key));
    const nowIso = now.toISOString();
    const state = markDelivered(rollbackFailed(decision.state, prev, failed), delivered, nowIso);
    deps.writeFile(STATE_PATH, `${JSON.stringify({ ...state, lastRunAt: nowIso }, null, 2)}\n`);
  }

  for (const e of errors) logError(`ERREUR watchdog : ${e}`);
  if (!dryRun) await pingHealthcheck(errors.length === 0, deps, log);
  return errors.length > 0 ? 1 : 0;
};

const realDeps = (): Deps => ({
  fetch: globalThis.fetch,
  readFile: (p) => {
    const full = join(process.cwd(), p);
    return existsSync(full) ? readFileSync(full, 'utf-8') : null;
  },
  writeFile: (p, c) => writeFileSync(join(process.cwd(), p), c),
  writeFileAtomic: (p, c) => atomicWrite(join(process.cwd(), p), c),
  env: process.env,
  now: () => new Date(),
  log: (m) => console.log(m),
  logError: (m) => console.error(m),
});

const isMain = (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('scripts/silence-watchdog.ts');
if (isMain) {
  run(process.argv.slice(2), realDeps())
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e: unknown) => {
      console.error(`ERREUR fatale : ${errMsg(e)}`);
      process.exitCode = 1;
    });
}
