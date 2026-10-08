/**
 * silence-watchdog.test.ts
 *
 * Un cas par invariant de .chantier/2026-10-08-watchdog-silence/change.md.
 * fetch et le fs sont mockes via l'injection de dependances : aucun reseau.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  DECL_PATH,
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
  route: (url: string) => Response | Promise<Response>;
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
    return opts.route(url);
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
  it('should send one recovery message when the stream is fresh again, then stay silent', () => {
    const decl: Declaration = { flows: [DB_FLOW] };
    const open = decide(decl, emptyState(), { 'db-backups': checked(false) }, NIGHT);
    expect(open.notifications).toHaveLength(1);

    const back = decide(decl, open.state, { 'db-backups': checked(true, 'frais') }, NIGHT);
    expect(back.notifications).toHaveLength(1);
    expect(back.notifications[0]?.text).toContain('retour à la normale');
    expect(back.state.flows['db-backups']?.alertOpenSince).toBeNull();

    const after = decide(decl, back.state, { 'db-backups': checked(true) }, NIGHT);
    expect(after.notifications).toHaveLength(0);
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

  it('should exit non-zero when GitHub is unreachable or refuses access', async () => {
    const down = makeHarness({
      decl: { flows: [DB_FLOW] },
      route: () => {
        throw new Error('getaddrinfo ENOTFOUND api.github.com');
      },
    });
    expect(await run([], down.deps)).toBe(1);
    expect(down.telegramTexts).toHaveLength(0);

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
