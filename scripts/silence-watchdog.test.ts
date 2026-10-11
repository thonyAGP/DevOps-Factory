/**
 * silence-watchdog.test.ts
 *
 * Un cas par invariant de .chantier/2026-10-08-watchdog-silence/change.md.
 * fetch et le fs sont mockes via l'injection de dependances : aucun reseau.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  DECL_PATH,
  PENDING_STATUS,
  PREFIX,
  STATE_PATH,
  ageHours,
  decide,
  evaluateHttps,
  evaluateWorkflowRuns,
  extractFileDate,
  freshnessResult,
  parseState,
  redact,
  run,
  type CheckOutcome,
  type Declaration,
  type Deps,
  type HttpsFlow,
  type WatchdogState,
  type WorkflowRun,
} from './silence-watchdog.js';

const TOKEN = '123456:SECRET-telegram-token';
const H = 3_600_000;
// 04:00 a Madrid (avant 07:00) : pas de recapitulatif parasite.
const NIGHT = new Date('2026-10-08T02:00:00Z');

const DB_FLOW = {
  id: 'db-backups',
  label: 'db-backups, copie distante',
  type: 'github-commits' as const,
  repo: 'thonyAGP/db-backups',
  branch: 'main',
  messagePattern: '^chore\\(dumps\\): backup',
  thresholdHours: 26,
};
const HTTPS_FLOW: HttpsFlow = {
  id: 'boxmail-server',
  label: 'Boxmail, serveur',
  type: 'https',
  url: 'https://boxmail.lb2i.com/health',
  expectStatus: 200,
  expectJson: { status: 'ok' },
  consecutiveFailures: 2,
};
const WF_FLOW = {
  id: 'devops-factory-workflows',
  label: 'DevOps-Factory, workflows chroniques',
  type: 'github-workflow-runs' as const,
  repo: 'thonyAGP/DevOps-Factory',
  workflows: ['renovate.yml'],
  consecutiveRunFailures: 3,
};

const emptyState = (): WatchdogState => ({ lastDailySummaryDate: null, flows: {} });
const checked = (healthy: boolean, detail = 'détail'): CheckOutcome => ({
  kind: 'checked',
  result: { healthy, detail, lastProofAt: null },
});
const runsOf = (...conclusions: string[]): WorkflowRun[] =>
  conclusions.map((c, i) => ({
    conclusion: c,
    created_at: new Date(NIGHT.getTime() - i * 24 * H).toISOString(),
  }));

// ---------------------------------------------------------------- harness

interface Harness {
  deps: Deps;
  files: Map<string, string>;
  telegramTexts: string[];
  telegramBodies: Array<Record<string, unknown>>;
  logs: string[];
  setNow: (d: Date) => void;
}

const makeHarness = (opts: {
  decl: Declaration;
  route: (url: string, init?: RequestInit) => Response | Promise<Response>;
  telegramStatus?: number;
  env?: Record<string, string | undefined>;
  now?: Date;
}): Harness => {
  const files = new Map<string, string>([[DECL_PATH, JSON.stringify(opts.decl)]]);
  const telegramTexts: string[] = [];
  const telegramBodies: Array<Record<string, unknown>> = [];
  const logs: string[] = [];
  let now = opts.now ?? NIGHT;
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://api.telegram.org/')) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      telegramBodies.push(body);
      telegramTexts.push(String(body.text));
      return new Response('{}', { status: opts.telegramStatus ?? 200 });
    }
    return opts.route(url, init);
  });
  const deps: Deps = {
    fetch: fetchMock as unknown as typeof fetch,
    readFile: (p) => files.get(p) ?? null,
    writeFile: (p, c) => {
      files.set(p, c);
    },
    env: opts.env ?? { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '42', GH_TOKEN: 'ghs_fake' },
    now: () => now,
    log: (m) => logs.push(m),
    logError: (m) => logs.push(m),
  };
  return { deps, files, telegramTexts, telegramBodies, logs, setNow: (d) => (now = d) };
};

const commitsResponse = (hoursAgo: number, at: Date = NIGHT): Response =>
  Response.json([
    { commit: { message: 'docs: unrelated', committer: { date: at.toISOString() } } },
    {
      commit: {
        message: 'chore(dumps): backup 2026-10-07',
        committer: { date: new Date(at.getTime() - hoursAgo * H).toISOString() },
      },
    },
  ]);

// ---------------------------------------------------------------- pure

describe('fraîcheur', () => {
  it('should compute age in hours from an ISO date', () => {
    expect(ageHours('2026-10-07T00:00:00Z', NIGHT)).toBe(26);
  });

  it('should flag a stream silent for 27 h against a 26 h threshold', () => {
    const r = freshnessResult(new Date(NIGHT.getTime() - 27 * H).toISOString(), 26, NIGHT, 'x');
    expect(r.healthy).toBe(false);
    expect(r.detail).toContain('27 h');
  });

  it('should accept a stream seen 25 h ago and flag a missing proof', () => {
    expect(
      freshnessResult(new Date(NIGHT.getTime() - 25 * H).toISOString(), 26, NIGHT, 'x').healthy
    ).toBe(true);
    expect(freshnessResult(null, 26, NIGHT, 'aucun commit')).toEqual({
      healthy: false,
      detail: 'aucun commit',
      lastProofAt: null,
    });
  });

  it('should extract the first journal date', () => {
    const md = '# Journal\n\n## 2026-10-08 (routine cloud)\n...\n## 2026-10-05 (matin)\n';
    expect(extractFileDate(md, '## (\\d{4}-\\d{2}-\\d{2})')).toBe('2026-10-08T00:00:00Z');
    expect(extractFileDate('rien', '## (\\d{4}-\\d{2}-\\d{2})')).toBeNull();
  });
});

describe('invariant 1 — une seule alerte à l’ouverture', () => {
  it('should send exactly one alert when a stream is silent for 27 h, and no duplicate on the next run', async () => {
    const h = makeHarness({ decl: { flows: [DB_FLOW] }, route: () => commitsResponse(27) });

    expect(await run([], h.deps)).toBe(0);
    expect(h.telegramTexts).toHaveLength(1);
    expect(h.telegramTexts[0]).toMatch(/^🕯 Silence — db-backups, copie distante : SILENCE\./);
    expect(parseState(h.files.get(STATE_PATH) ?? null).flows['db-backups']?.alertOpenSince).toBe(
      NIGHT.toISOString()
    );

    h.setNow(new Date(NIGHT.getTime() + 1 * H));
    expect(await run([], h.deps)).toBe(0);
    expect(h.telegramTexts).toHaveLength(1);
  });
});

describe('invariant 2 — retour à la normale', () => {
  // Politique d'alerte du 12/10 : le retour ferme l'alerte en silence, sauf notifyRecovery: true.
  it('should close the alert silently on recovery, and send one recovery message only with notifyRecovery', async () => {
    for (const notifyRecovery of [undefined, true]) {
      let age = 27;
      const h = makeHarness({
        decl: { flows: [{ ...DB_FLOW, notifyRecovery }] },
        route: () => commitsResponse(age),
      });

      expect(await run([], h.deps)).toBe(0); // alerte
      age = 2;
      expect(await run([], h.deps)).toBe(0); // retour à la normale
      expect(await run([], h.deps)).toBe(0); // rien

      const state = parseState(h.files.get(STATE_PATH) ?? null);
      expect(state.flows['db-backups']?.alertOpenSince).toBeNull();
      expect(h.telegramTexts).toHaveLength(notifyRecovery ? 2 : 1);
      expect(h.telegramTexts.filter((t) => t.includes('retour à la normale'))).toHaveLength(
        notifyRecovery ? 1 : 0
      );
    }
  });

  it('should never send a recovery message when no alert was open', () => {
    const r = decide({ flows: [DB_FLOW] }, emptyState(), { 'db-backups': checked(true) }, NIGHT);
    expect(r.notifications).toHaveLength(0);
  });
});

describe('workflows chroniques — 3 échecs consécutifs', () => {
  it('should be red after 3 consecutive failures', () => {
    const r = evaluateWorkflowRuns(
      { 'renovate.yml': runsOf('failure', 'failure', 'failure', 'success') },
      3,
      NIGHT
    );
    expect(r.healthy).toBe(false);
    expect(r.detail).toContain('renovate.yml : 3 échecs consécutifs');
    const d = decide(
      { flows: [WF_FLOW] },
      emptyState(),
      { [WF_FLOW.id]: { kind: 'checked', result: r } },
      NIGHT
    );
    expect(d.notifications).toHaveLength(1);
    expect(d.notifications[0]?.text).toContain(': ROUGE.');
  });

  it('should not alert after only 2 consecutive failures', () => {
    const r = evaluateWorkflowRuns(
      { 'renovate.yml': runsOf('failure', 'failure', 'success') },
      3,
      NIGHT
    );
    expect(r.healthy).toBe(true);
  });

  it('should ignore cancelled runs between failures', () => {
    const r = evaluateWorkflowRuns(
      { 'renovate.yml': runsOf('failure', 'cancelled', 'failure', 'failure') },
      3,
      NIGHT
    );
    expect(r.healthy).toBe(false);
  });
});

describe('HTTPS — 2 échecs consécutifs', () => {
  it('should validate status and JSON body', () => {
    expect(evaluateHttps(HTTPS_FLOW, 200, '{"status":"ok"}', NIGHT).healthy).toBe(true);
    expect(evaluateHttps(HTTPS_FLOW, 200, '{"status":"degraded"}', NIGHT).healthy).toBe(false);
    expect(evaluateHttps(HTTPS_FLOW, 502, 'Bad gateway', NIGHT).healthy).toBe(false);
  });

  it('should not alert after 1 failure and alert after 2', async () => {
    const h = makeHarness({
      decl: { flows: [HTTPS_FLOW] },
      route: () => new Response('down', { status: 503 }),
    });

    expect(await run([], h.deps)).toBe(0);
    expect(h.telegramTexts).toHaveLength(0);
    expect(h.logs.some((l) => l.startsWith('[DOUTE 1/2] boxmail-server'))).toBe(true);

    expect(await run([], h.deps)).toBe(0);
    expect(h.telegramTexts).toHaveLength(1);
    expect(h.telegramTexts[0]).toContain('Boxmail, serveur : PANNE.');
  });

  it('should treat a network error on the watched server as a stream failure, not a watchdog failure', async () => {
    const h = makeHarness({
      decl: { flows: [HTTPS_FLOW] },
      route: () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect(await run([], h.deps)).toBe(0);
  });
});

describe('invariant 3 — code de sortie', () => {
  it('should exit 0 when a watched stream is down', async () => {
    const h = makeHarness({ decl: { flows: [DB_FLOW] }, route: () => commitsResponse(24 * 44) });
    expect(await run([], h.deps)).toBe(0);
    expect(h.telegramTexts).toHaveLength(1);
  });

  it('should exit non-zero when Telegram answers 401, and keep the alert to retry', async () => {
    const h = makeHarness({
      decl: { flows: [DB_FLOW] },
      route: () => commitsResponse(27),
      telegramStatus: 401,
    });
    expect(await run([], h.deps)).toBe(1);
    expect(h.logs.some((l) => l.includes('Telegram a répondu HTTP 401'))).toBe(true);
    const state = parseState(h.files.get(STATE_PATH) ?? null);
    expect(state.flows['db-backups']?.alertOpenSince).toBeNull();
  });

  it('should exit non-zero when GitHub is unreachable or refuses access, with a control error message, never a stream alert', async () => {
    const down = makeHarness({
      decl: { flows: [DB_FLOW] },
      route: () => {
        throw new Error('getaddrinfo ENOTFOUND api.github.com');
      },
    });
    expect(await run([], down.deps)).toBe(1);
    // Politique d'alerte du 12/10 : une erreur de contrôle NOUVELLE donne un message ERREUR.
    expect(down.telegramTexts).toHaveLength(1);
    expect(down.telegramTexts[0]).toMatch(
      /^🕯 Silence — db-backups, copie distante : ERREUR\. contrôle impossible : GitHub injoignable/
    );

    const notInstalled = makeHarness({
      decl: { flows: [DB_FLOW] },
      route: () => new Response('Not Found', { status: 404 }),
    });
    expect(await run([], notInstalled.deps)).toBe(1);
    expect(notInstalled.logs.some((l) => l.includes('GitHub HTTP 404'))).toBe(true);
  });

  it('should send plain text (no parse_mode) prefixed with the silence marker', async () => {
    const h = makeHarness({ decl: { flows: [DB_FLOW] }, route: () => commitsResponse(27) });
    await run([], h.deps);
    expect(h.telegramBodies[0]).not.toHaveProperty('parse_mode');
    expect(h.telegramBodies[0]?.chat_id).toBe('42');
    expect(String(h.telegramBodies[0]?.text).startsWith(PREFIX)).toBe(true);
  });
});

describe('invariant 4 — pas de « tout va bien » quotidien, cliquet externe à la place', () => {
  const PING = 'https://hc-ping.com/0000-ratchet';
  const withPing = {
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_CHAT_ID: '42',
    GH_TOKEN: 'ghs_fake',
    HEALTHCHECK_PING_URL: PING,
  };

  it('should never send a daily summary, even over 4 healthy runs of the same day', async () => {
    const pings: string[] = [];
    const h = makeHarness({
      decl: { flows: [DB_FLOW] },
      env: withPing,
      route: (url) => {
        if (url.startsWith(PING)) {
          pings.push(url);
          return new Response('OK', { status: 200 });
        }
        return commitsResponse(2, new Date('2026-10-07T22:00:00Z'));
      },
    });
    for (const hour of ['00', '06', '12', '18']) {
      h.setNow(new Date(`2026-10-08T${hour}:00:00Z`));
      expect(await run([], h.deps)).toBe(0);
    }
    expect(h.telegramTexts).toHaveLength(0);
    expect(pings).toEqual([PING, PING, PING, PING]);
  });

  it('should ping /fail when the watchdog itself could not notify (Telegram 401)', async () => {
    const pings: string[] = [];
    const h = makeHarness({
      decl: { flows: [DB_FLOW] },
      env: withPing,
      telegramStatus: 401,
      route: (url) => {
        if (url.startsWith(PING)) {
          pings.push(url);
          return new Response('OK', { status: 200 });
        }
        return commitsResponse(27);
      },
    });
    expect(await run([], h.deps)).toBe(1);
    expect(pings).toEqual([`${PING}/fail`]);
  });

  it('should ping ok when a stream is down but the watchdog did its job', async () => {
    const pings: string[] = [];
    const h = makeHarness({
      decl: { flows: [DB_FLOW] },
      env: withPing,
      route: (url) => {
        if (url.startsWith(PING)) {
          pings.push(url);
          return new Response('OK', { status: 200 });
        }
        return commitsResponse(27);
      },
    });
    expect(await run([], h.deps)).toBe(0);
    expect(h.telegramTexts).toHaveLength(1);
    expect(pings).toEqual([PING]);
  });

  it('should not ping in dry-run, and never print the ping URL', async () => {
    const pings: string[] = [];
    const h = makeHarness({
      decl: { flows: [DB_FLOW] },
      env: withPing,
      route: (url) => {
        if (url.startsWith(PING)) pings.push(url);
        return commitsResponse(2);
      },
    });
    expect(await run(['--dry-run'], h.deps)).toBe(0);
    expect(pings).toHaveLength(0);
    expect(h.logs.join('\n')).not.toContain('0000-ratchet');
  });

  it('should keep exit code 0 when the ping endpoint is unreachable', async () => {
    const h = makeHarness({
      decl: { flows: [DB_FLOW] },
      env: withPing,
      route: (url) => {
        if (url.startsWith(PING)) throw new Error('ECONNRESET');
        return commitsResponse(2);
      },
    });
    expect(await run([], h.deps)).toBe(0);
    expect(h.logs.some((l) => l.includes('ping impossible'))).toBe(true);
  });
});

describe('invariant 5 — jeton masqué', () => {
  it('should print token: **** in dry-run, send nothing and write no state', async () => {
    const h = makeHarness({ decl: { flows: [DB_FLOW] }, route: () => commitsResponse(27) });
    expect(await run(['--dry-run'], h.deps)).toBe(0);
    expect(h.logs).toContain('token: ****');
    expect(h.telegramTexts).toHaveLength(0);
    expect(h.files.has(STATE_PATH)).toBe(false);
    expect(h.logs.some((l) => l.startsWith('[SILENCE] db-backups'))).toBe(true);
  });

  it('should never print the token, even inside an error message', async () => {
    const h = makeHarness({
      decl: { flows: [DB_FLOW] },
      route: () => {
        throw new Error(`boom ${TOKEN} ghs_fake`);
      },
    });
    await run([], h.deps);
    const all = h.logs.join('\n');
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain('ghs_fake');
    expect(all).toContain('****');
  });

  it('should redact every occurrence of each secret', () => {
    expect(redact('a SECRET b SECRET', ['SECRET', undefined])).toBe('a **** b ****');
  });
});

// ---------------------------------------------------------------- v1b (11/10)

const CASA_SECRET = 'casa-cron-secret-0123456789';
const LB2I_SECRET = 'lb2i-cron-secret-9876543210';
const BASE_ENV = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '42', GH_TOKEN: 'ghs_fake' };
const CASA_FLOW: HttpsFlow = {
  id: 'casasync-pulse',
  label: 'CasaSync, crons',
  type: 'https',
  url: 'https://app-casasync.vercel.app/api/health/pulse',
  expectStatus: 200,
  expectJson: { status: 'ok' },
  consecutiveFailures: 2,
  auth: { header: 'x-cron-secret', env: 'CASASYNC_CRON_SECRET' },
};
const LB2I_FLOW: HttpsFlow = {
  ...CASA_FLOW,
  id: 'lb2i-pulse',
  label: 'LB2I, application',
  url: 'https://app.lb2i.com/api/health/pulse',
  auth: { header: 'Authorization', env: 'LB2I_CRON_SECRET', prefix: 'Bearer ' },
};
const RAPPELS_FLOW: HttpsFlow = {
  id: 'rappels-api',
  label: 'Rappels, API publique',
  type: 'https',
  url: 'https://rappels.lb2i.com/v1/reminders',
  expectStatus: 401,
  consecutiveFailures: 2,
};

interface Call {
  url: string;
  headers: Headers;
  redirect: RequestRedirect | undefined;
}
const recorder = (respond: () => Response) => {
  const calls: Call[] = [];
  const route = (url: string, init?: RequestInit): Response => {
    calls.push({ url, headers: new Headers(init?.headers), redirect: init?.redirect });
    return respond();
  };
  return { calls, route };
};
const casaStateOf = (h: Harness) => parseState(h.files.get(STATE_PATH) ?? null).flows[CASA_FLOW.id];

describe('flux authentifié — secret lu dans l’environnement', () => {
  it('should send each secret in its declared header, trimmed, without following redirects', async () => {
    const rec = recorder(() => Response.json({ status: 'ok' }));
    const h = makeHarness({
      decl: { flows: [CASA_FLOW, LB2I_FLOW] },
      env: { ...BASE_ENV, CASASYNC_CRON_SECRET: CASA_SECRET, LB2I_CRON_SECRET: `${LB2I_SECRET}\n` },
      route: rec.route,
    });

    expect(await run([], h.deps)).toBe(0);
    expect(rec.calls.map((c) => c.url)).toEqual([CASA_FLOW.url, LB2I_FLOW.url]);
    expect(rec.calls[0]?.headers.get('x-cron-secret')).toBe(CASA_SECRET);
    expect(rec.calls[1]?.headers.get('authorization')).toBe(`Bearer ${LB2I_SECRET}`);
    expect(rec.calls.every((c) => c.redirect === 'manual')).toBe(true);
    expect(h.logs.some((l) => l.startsWith('[OK] casasync-pulse'))).toBe(true);
  });

  it('should report ERREUR and exit non-zero when the secret is absent, without calling the stream nor raising a stream alert', async () => {
    // undefined : variable absente ; '' : secret GitHub non posé (Actions injecte une chaîne vide).
    for (const secret of [undefined, '', '   ']) {
      const rec = recorder(() => Response.json({ status: 'ok' }));
      const h = makeHarness({
        decl: { flows: [CASA_FLOW] },
        env: { ...BASE_ENV, CASASYNC_CRON_SECRET: secret },
        route: rec.route,
      });

      expect(await run([], h.deps)).toBe(1);
      expect(rec.calls).toHaveLength(0);
      // Politique d'alerte du 12/10 : un message d'erreur de contrôle, jamais une alerte PANNE.
      expect(h.telegramTexts).toEqual([
        `${PREFIX} CasaSync, crons : ERREUR. contrôle impossible : secret CASASYNC_CRON_SECRET absent`,
      ]);
      expect(h.logs).toContain(
        '[ERREUR] casasync-pulse — contrôle impossible : secret CASASYNC_CRON_SECRET absent'
      );
      expect(casaStateOf(h)).toMatchObject({ consecutiveFailures: 0, alertOpenSince: null });
    }
  });

  it('should mask a stream secret in logs and in the Telegram alert, even inside an error message', async () => {
    const h = makeHarness({
      decl: { flows: [CASA_FLOW] },
      env: { ...BASE_ENV, CASASYNC_CRON_SECRET: CASA_SECRET },
      route: () => {
        throw new Error(`invalid header value "${CASA_SECRET}"`);
      },
    });

    expect(await run([], h.deps)).toBe(0); // DOUTE 1/2
    expect(await run([], h.deps)).toBe(0); // PANNE : une alerte part
    expect(h.telegramTexts).toHaveLength(1);
    const all = [...h.logs, ...h.telegramTexts].join('\n');
    expect(all).not.toContain(CASA_SECRET);
    expect(h.telegramTexts[0]).toContain('invalid header value "****"');
  });
});

describe('flux en attente (pending)', () => {
  it('should show a pending stream as EN ATTENTE and never check nor alert it, even without its secret', async () => {
    const rec = recorder(() => new Response('down', { status: 503 }));
    const pendingCasa: HttpsFlow = { ...CASA_FLOW, pending: true, pendingReason: 'route à créer' };
    // Sans secret : un contrôle exécuté par erreur atteindrait le réseau.
    const pendingRappels: HttpsFlow = { ...RAPPELS_FLOW, pending: true };
    const h = makeHarness({
      decl: { flows: [pendingCasa, pendingRappels] },
      env: BASE_ENV,
      route: rec.route,
    });

    expect(await run([], h.deps)).toBe(0);
    expect(await run([], h.deps)).toBe(0);
    expect(rec.calls).toHaveLength(0);
    expect(h.telegramTexts).toHaveLength(0);
    expect(h.logs).toContain(
      `[${PENDING_STATUS}] casasync-pulse — déclaré, jamais contrôlé ni alerté (route à créer)`
    );
    expect(h.logs).toContain(
      `[${PENDING_STATUS}] rappels-api — déclaré, jamais contrôlé ni alerté`
    );
    expect(casaStateOf(h)).toBeUndefined();
  });

  it('should ignore an outcome given for a pending stream', () => {
    const d = decide(
      { flows: [{ ...DB_FLOW, pending: true }] },
      emptyState(),
      { [DB_FLOW.id]: checked(false) },
      NIGHT
    );
    expect(d.notifications).toHaveLength(0);
    expect(d.verdicts).toEqual([
      { id: DB_FLOW.id, status: PENDING_STATUS, line: 'déclaré, jamais contrôlé ni alerté' },
    ]);
  });
});

describe('statut attendu ≠ 200, sans JSON attendu', () => {
  it('should accept the expected 401 whatever the body, and flag any other status', () => {
    expect(evaluateHttps(RAPPELS_FLOW, 401, '{"erreur":"NON_AUTHENTIFIE"}', NIGHT)).toEqual({
      healthy: true,
      detail: 'HTTP 401, statut attendu',
      lastProofAt: NIGHT.toISOString(),
    });
    expect(evaluateHttps(RAPPELS_FLOW, 401, 'pas du JSON', NIGHT).healthy).toBe(true);
    expect(evaluateHttps(RAPPELS_FLOW, 200, '[]', NIGHT).detail).toBe('HTTP 200 (attendu 401)');
    expect(evaluateHttps(RAPPELS_FLOW, 502, 'Bad gateway', NIGHT).healthy).toBe(false);
  });

  it('should report OK when the unauthenticated probe gets its 401, sending no header', async () => {
    const rec = recorder(() => new Response('', { status: 401 }));
    const h = makeHarness({ decl: { flows: [RAPPELS_FLOW] }, route: rec.route });

    expect(await run([], h.deps)).toBe(0);
    expect(h.logs).toContain('[OK] rappels-api — HTTP 401, statut attendu');
    expect([...(rec.calls[0]?.headers.keys() ?? [])]).toEqual([]);
    expect(rec.calls[0]?.redirect).toBe('follow');
  });
});
