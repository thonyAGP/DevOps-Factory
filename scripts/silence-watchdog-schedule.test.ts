/**
 * silence-watchdog-schedule.test.ts — deux crons par créneau de 6 h (12/10).
 *
 * Deux passages rapprochés ne donnent ni double alerte (anti-doublon), ni double incident
 * (empreinte), ni écriture inutile : le passage planifié qui suit de moins d'1 h un passage
 * complet n'écrit rien, donc l'étape « Commit state » (commit seulement s'il y a un diff)
 * ne committe rien. L'état reste lisible à l'ancienne (migration additive).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { describe, expect, it } from 'vitest';

import { STATE_PATH } from './silence-watchdog.js';
import { SKIP_IF_RECENT } from './silence-watchdog-alerts.js';
import { DB, PING_URL, T0, at, makeBench } from './silence-watchdog-harness.js';

describe('deux passages à 30 min d’intervalle', () => {
  it('should give one message and one incident, the scheduled second pass checking and writing nothing', async () => {
    const b = makeBench([DB]);
    expect(await b.pass(0, 'rouge', [SKIP_IF_RECENT])).toBe(0);
    const filesAfterFirst = new Map(b.files);
    const callsAfterFirst = [...b.calls];

    expect(await b.pass(0.5, 'rouge', [SKIP_IF_RECENT])).toBe(0);

    expect(b.telegram).toHaveLength(1);
    expect(b.incidents()).toHaveLength(1);
    expect(b.incidents()[0]?.occurrences).toBe(1);
    expect(b.files).toEqual(filesAfterFirst); // aucun diff : aucun commit d'état
    expect(b.calls).toEqual(callsAfterFirst); // ni contrôle, ni ping
    expect(b.logs.at(-1)).toBe('silence-watchdog — passage complet il y a 30 min : rien à refaire');
  });

  it('should give one message and one incident when two full passes run 30 min apart', async () => {
    // Passages manuels (sans --skip-if-recent) : l'anti-doublon et l'empreinte suffisent.
    const b = makeBench([DB]);

    await b.pass(0, 'rouge');
    await b.pass(0.5, 'rouge');

    expect(b.telegram).toHaveLength(1);
    expect(b.incidents()).toHaveLength(1);
    expect(b.incidents()[0]?.occurrences).toBe(2);
  });

  it('should run a full pass once the last full pass is 1 h old', async () => {
    const b = makeBench([DB]);
    await b.pass(0, 'vert', [SKIP_IF_RECENT]);

    expect(await b.pass(1, 'rouge', [SKIP_IF_RECENT])).toBe(0);

    expect(b.telegram).toHaveLength(1);
    expect(JSON.parse(b.files.get(STATE_PATH) ?? '{}')).toMatchObject({
      lastRunAt: at(1).toISOString(),
    });
    expect(b.calls.filter((u) => u === PING_URL)).toHaveLength(2);
  });

  it('should never count a dry-run as a full pass', async () => {
    const b = makeBench([DB]);

    await b.pass(0, 'rouge', ['--dry-run']);
    await b.pass(0.5, 'rouge', [SKIP_IF_RECENT]);

    expect(b.logs).toContain('[alerte] db-backups : message (nouvel_incident)');
    expect(b.logs).toContain(
      '[dry-run] non envoyé : 🕯 Silence — db-backups, copie distante : SILENCE. dernière preuve le 11/10 03:00, il y a 27 h (seuil 26 h)'
    );
    expect(b.telegram).toHaveLength(1);
  });
});

describe('état anti-doublon — migration additive', () => {
  it('should read a state written before 12/10, keep every field and add the new ones', async () => {
    const legacy = {
      lastDailySummaryDate: '2026-10-08',
      flows: {
        [DB.id]: {
          alertOpenSince: '2026-10-11T18:07:46.411Z',
          consecutiveFailures: 2,
          lastCheckedAt: '2026-10-11T21:28:31.122Z',
          lastOkAt: '2026-10-11T12:06:24.419Z',
        },
      },
    };
    const b = makeBench([DB], [[STATE_PATH, JSON.stringify(legacy)]]);

    expect(await b.pass(0, 'rouge', [SKIP_IF_RECENT])).toBe(0);

    // Alerte ouverte avant la politique : aucun doublon, l'incident est créé en silence.
    expect(b.telegram).toHaveLength(0);
    expect(b.logs).toContain('[alerte] db-backups : silence (alerte_deja_ouverte)');
    const state = JSON.parse(b.files.get(STATE_PATH) ?? '{}') as typeof legacy & {
      lastRunAt: string;
    };
    expect(state).toMatchObject({
      lastDailySummaryDate: '2026-10-08',
      lastRunAt: T0.toISOString(),
    });
    expect(state.flows[DB.id]).toMatchObject({
      alertOpenSince: '2026-10-11T18:07:46.411Z',
      consecutiveFailures: 3,
      lastCheckedAt: T0.toISOString(),
      lastOkAt: '2026-10-11T12:06:24.419Z',
    });
  });
});

describe('silence-watchdog.yml — cron doublé', () => {
  const yml = readFileSync(join(process.cwd(), '.github/workflows/silence-watchdog.yml'), 'utf-8');

  it('should schedule two crons per 6 h slot and skip only scheduled passes', () => {
    expect(yml).toContain("- cron: '0 */6 * * *'");
    expect(yml).toContain("- cron: '30 */6 * * *'");
    expect(yml).toMatch(
      /elif \[ "\$GITHUB_EVENT_NAME" = "schedule" \]; then\s+pnpm silence-watchdog -- --skip-if-recent/
    );
  });

  it('should keep committing the state only when there is a diff', () => {
    expect(yml).toContain('git diff --cached --quiet && exit 0');
  });
});
