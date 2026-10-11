/**
 * watchdog-run.test.ts — scenarios du CHG-012 joues par run() du watchdog, de bout en bout.
 * fetch et le disque sont simules (injection de dependances) : aucun reseau, aucun fichier reel.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  DECL_PATH,
  STATE_PATH,
  run,
  type Declaration,
  type Deps,
  type HttpsFlow,
} from '../silence-watchdog.js';
import type { IncidentEnvelope } from './envelope.js';
import { at, DB_FLUX, DB_REPO, HOUR_MS } from './fixtures.js';
import { INCIDENTS_PATH, MEMORY_PATH, parseIncidents } from './store.js';

const ENV = {
  TELEGRAM_BOT_TOKEN: '123:telegram-test-token',
  TELEGRAM_CHAT_ID: '42',
  GH_TOKEN: 'ghs_fake',
};
const DB_DECL: Declaration = {
  flows: [
    {
      id: DB_FLUX,
      label: 'db-backups, copie distante',
      type: 'github-commits',
      repo: DB_REPO,
      branch: 'main',
      messagePattern: '^chore\\(dumps\\): backup',
      thresholdHours: 26,
    },
  ],
};
const DB_FP = 'db-backups:silence';
const STALE = 27;
const FRESH = 2;

interface Harness {
  deps: Deps;
  files: Map<string, string>;
  telegram: string[];
  logs: string[];
  /** Un passage a `hours` de T0, dernier commit vieux de `ageHours`. */
  passAt: (hours: number, ageHours: number, argv?: string[]) => Promise<number>;
}

interface HarnessOptions {
  preset?: Array<[string, string]>;
  env?: Record<string, string | undefined>;
  /** Reponse des URL autres que Telegram ; defaut : commits GitHub de l'age courant. */
  route?: (url: string) => Response;
}

const makeHarness = (decl: Declaration, opts: HarnessOptions = {}): Harness => {
  const files = new Map<string, string>([
    [DECL_PATH, JSON.stringify(decl)],
    ...(opts.preset ?? []),
  ]);
  const telegram: string[] = [];
  const logs: string[] = [];
  let now = at(0);
  let age = STALE;
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://api.telegram.org/')) {
      telegram.push(String((JSON.parse(String(init?.body)) as { text: unknown }).text));
      return new Response('{}', { status: 200 });
    }
    if (opts.route) return opts.route(url);
    const date = new Date(now.getTime() - age * HOUR_MS).toISOString();
    return Response.json([{ commit: { message: 'chore(dumps): backup', committer: { date } } }]);
  });
  const deps: Deps = {
    fetch: fetchMock as unknown as typeof fetch,
    readFile: (p) => files.get(p) ?? null,
    writeFile: (p, c) => {
      files.set(p, c);
    },
    env: opts.env ?? ENV,
    now: () => now,
    log: (m) => logs.push(m),
    logError: (m) => logs.push(m),
  };
  const passAt = (hours: number, ageHours: number, argv: string[] = []) => {
    now = at(hours);
    age = ageHours;
    return run(argv, deps);
  };
  return { deps, files, telegram, logs, passAt };
};

const incidentsOf = (h: Harness): IncidentEnvelope[] => {
  const r = parseIncidents(h.files.get(INCIDENTS_PATH) ?? null);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('scénario CHG-012 — db-backups rouge', () => {
  it('should create one envelope and request one investigation, then add an occurrence on the second red pass', async () => {
    // Arrange
    const h = makeHarness(DB_DECL);

    // Act
    expect(await h.passAt(0, STALE)).toBe(0);
    const first = incidentsOf(h);
    expect(await h.passAt(6, STALE + 6)).toBe(0);
    const second = incidentsOf(h);

    // Assert
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      empreinte: DB_FP,
      etat: 'enquete_demandee',
      enquetes: { demandees: 1 },
    });
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({
      id: first[0]?.id,
      occurrences: 2,
      enquetes: { demandees: 1 },
    });
    expect(second[0]?.derniereDecision?.motif).toBe('enquete_en_cours');
    expect(h.telegram).toHaveLength(1);
    expect(JSON.parse(h.files.get(MEMORY_PATH) ?? 'null')).toEqual({ version: 1, incidents: [] });
  });
});

describe('scénario CHG-012 — panne qui oscille (rouge, vert, rouge en 24 h)', () => {
  it('should keep a single incident, reopened, with 2 occurrences and at most 2 investigations', async () => {
    // Arrange : trois passages a 2 h d'intervalle (reouverture dans le cooldown de 6 h)
    const h = makeHarness(DB_DECL);

    // Act
    await h.passAt(0, STALE);
    await h.passAt(2, FRESH);
    await h.passAt(4, STALE);

    // Assert
    const incidents = incidentsOf(h);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ etat: 'rouvert', occurrences: 2, ouvertures: 2 });
    expect(incidents[0]?.enquetes.demandees).toBeLessThanOrEqual(2);
    expect(incidents[0]?.derniereDecision?.motif).toBe('cooldown');
    // Politique d'alerte (12/10) : retour silencieux, réouverture 2 h après la fermeture
    // (cooldown 6 h) silencieuse aussi ; la panne ne donne qu'un message.
    expect(h.telegram.map((t) => t.split(' : ')[1]?.split('.')[0])).toEqual(['SILENCE']);
  });

  it('should ask a second investigation at the 6 h cadence, then stop at the cap', async () => {
    const h = makeHarness(DB_DECL);

    await h.passAt(0, STALE);
    await h.passAt(6, FRESH);
    await h.passAt(12, STALE);
    const afterSecond = incidentsOf(h)[0];
    await h.passAt(18, FRESH);
    await h.passAt(24, STALE);
    const afterThird = incidentsOf(h);

    expect(afterSecond).toMatchObject({
      etat: 'enquete_demandee',
      occurrences: 2,
      enquetes: { demandees: 2 },
    });
    expect(afterThird).toHaveLength(1);
    expect(afterThird[0]).toMatchObject({
      etat: 'rouvert',
      occurrences: 3,
      ouvertures: 3,
      enquetes: { demandees: 2 },
    });
    expect(afterThird[0]?.derniereDecision?.motif).toBe('plafond_atteint');
  });
});

describe('dry-run et indépendance des alertes', () => {
  it('should log the incidents and the decision in dry-run without writing data/incidents/', async () => {
    const h = makeHarness(DB_DECL);

    expect(await h.passAt(0, STALE, ['--dry-run'])).toBe(0);

    expect(
      h.logs.some((l) => l.startsWith(`[incident] ${DB_FP} : nouveau inc-db-backups-silence-`))
    ).toBe(true);
    expect(h.logs.some((l) => l.includes('enquête demandée (nouvel_incident)'))).toBe(true);
    expect(h.logs).toContain('[incidents] dry-run : data/incidents/ non écrit');
    expect(h.files.has(INCIDENTS_PATH)).toBe(false);
    expect(h.files.has(MEMORY_PATH)).toBe(false);
    expect(h.files.has(STATE_PATH)).toBe(false);
  });

  it('should send the same alert and write the same state when the incident file is corrupted, and exit non-zero', async () => {
    // Arrange
    const healthy = makeHarness(DB_DECL);
    const broken = makeHarness(DB_DECL, { preset: [[INCIDENTS_PATH, '[{"version":1']] });

    // Act
    const okCode = await healthy.passAt(0, STALE);
    const brokenCode = await broken.passAt(0, STALE);

    // Assert
    expect(okCode).toBe(0);
    expect(brokenCode).toBe(1);
    expect(broken.telegram).toEqual(healthy.telegram);
    expect(broken.files.get(STATE_PATH)).toBe(healthy.files.get(STATE_PATH));
    expect(broken.files.get(INCIDENTS_PATH)).toBe('[{"version":1');
    expect(
      broken.logs.some((l) =>
        l.startsWith('ERREUR watchdog : incidents : data/incidents/incidents.json : JSON illisible')
      )
    ).toBe(true);
  });

  it('should mask a stream secret quoted by an error before storing the incident', async () => {
    const secret = 'casa-cron-secret-0123456789';
    const casa: HttpsFlow = {
      id: 'casasync-pulse',
      label: 'CasaSync, crons',
      type: 'https',
      url: 'https://app-casasync.vercel.app/api/health/pulse',
      expectStatus: 200,
      consecutiveFailures: 1,
      auth: { header: 'x-cron-secret', env: 'CASASYNC_CRON_SECRET' },
    };
    const h = makeHarness(
      { flows: [casa] },
      {
        env: { ...ENV, CASASYNC_CRON_SECRET: secret },
        route: () => {
          throw new Error(`invalid header value "${secret}"`);
        },
      }
    );

    expect(await h.passAt(0, STALE)).toBe(0);

    const stored = h.files.get(INCIDENTS_PATH) ?? '';
    expect(stored).not.toContain(secret);
    expect(incidentsOf(h)[0]?.nonFiable.detail).toBe('injoignable : invalid header value "****"');
    expect(h.telegram).toHaveLength(1);
  });
});
