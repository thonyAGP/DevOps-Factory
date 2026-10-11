/**
 * silence-watchdog-harness.ts — banc de test des passages du watchdog, pour les tests.
 *
 * fetch, disque et horloge simules : aucun reseau, aucun fichier reel. Un flux GitHub
 * (db-backups) est vu rouge (dernier commit vieux de 27 h), vert (2 h) ou aveugle
 * (GitHub injoignable : erreur de controle). Seuls les messages Telegram REMIS (HTTP 200)
 * sont enregistres ; le statut de Telegram se change en cours de test.
 */

import type { IncidentEnvelope } from './incidents/envelope.js';
import { INCIDENTS_PATH, parseIncidents } from './incidents/store.js';
import {
  DECL_PATH,
  STATE_PATH,
  parseState,
  run,
  type Deps,
  type Flow,
  type FlowState,
} from './silence-watchdog.js';

export const HOUR_MS = 3_600_000;
/** 06:00 a Madrid. */
export const T0 = new Date('2026-10-12T04:00:00.000Z');
export const PING_URL = 'https://hc-ping.com/bench-ratchet';

const ENV = {
  TELEGRAM_BOT_TOKEN: '123:bench-telegram-token',
  TELEGRAM_CHAT_ID: '42',
  GH_TOKEN: 'ghs_bench',
  HEALTHCHECK_PING_URL: PING_URL,
};

export const DB: Flow = {
  id: 'db-backups',
  label: 'db-backups, copie distante',
  type: 'github-commits',
  repo: 'thonyAGP/db-backups',
  branch: 'main',
  messagePattern: '^chore\\(dumps\\): backup',
  thresholdHours: 26,
};

export type Health = 'rouge' | 'vert' | 'aveugle';

export interface Bench {
  files: Map<string, string>;
  /** Messages Telegram remis (HTTP 200), dans l'ordre. */
  telegram: string[];
  logs: string[];
  /** Appels hors Telegram : API GitHub et cliquet. */
  calls: string[];
  /** Un passage a `hours` heures de T0, le flux vu dans l'etat `health`. */
  pass: (hours: number, health: Health, argv?: string[]) => Promise<number>;
  setTelegramStatus: (status: number) => void;
  flowState: (id: string) => FlowState | undefined;
  incidents: () => IncidentEnvelope[];
}

export const at = (hours: number): Date => new Date(T0.getTime() + hours * HOUR_MS);

export const makeBench = (flows: Flow[], preset: Array<[string, string]> = []): Bench => {
  const files = new Map<string, string>([[DECL_PATH, JSON.stringify({ flows })], ...preset]);
  const telegram: string[] = [];
  const logs: string[] = [];
  const calls: string[] = [];
  let now = T0;
  let health: Health = 'vert';
  let telegramStatus = 200;
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://api.telegram.org/')) {
      const body = JSON.parse(String(init?.body)) as { text: unknown };
      if (telegramStatus === 200) telegram.push(String(body.text));
      return new Response('{}', { status: telegramStatus });
    }
    calls.push(url);
    if (url.startsWith(PING_URL)) return new Response('OK', { status: 200 });
    if (health === 'aveugle') throw new Error('getaddrinfo ENOTFOUND api.github.com');
    const date = new Date(now.getTime() - (health === 'rouge' ? 27 : 2) * HOUR_MS).toISOString();
    return Response.json([{ commit: { message: 'chore(dumps): backup', committer: { date } } }]);
  };
  const deps: Deps = {
    fetch: fakeFetch as typeof fetch,
    readFile: (p) => files.get(p) ?? null,
    writeFile: (p, c) => {
      files.set(p, c);
    },
    env: ENV,
    now: () => now,
    log: (m) => logs.push(m),
    logError: (m) => logs.push(m),
  };
  const incidents = (): IncidentEnvelope[] => {
    const r = parseIncidents(files.get(INCIDENTS_PATH) ?? null);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
  return {
    files,
    telegram,
    logs,
    calls,
    pass: (hours, seen, argv = []) => {
      now = at(hours);
      health = seen;
      return run(argv, deps);
    },
    setTelegramStatus: (status) => {
      telegramStatus = status;
    },
    flowState: (id) => parseState(files.get(STATE_PATH) ?? null).flows[id],
    incidents,
  };
};
