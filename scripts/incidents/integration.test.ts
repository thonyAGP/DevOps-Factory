/**
 * integration.test.ts — planIncidents (coeur pur) branche sur decide() du watchdog.
 */

import { describe, expect, it } from 'vitest';

import {
  PENDING_STATUS,
  alertWord,
  decide,
  type CheckOutcome,
  type Declaration,
  type Flow,
  type WatchdogState,
} from '../silence-watchdog.js';
import type { RepairPr } from './correlation.js';
import type { IncidentEnvelope } from './envelope.js';
import { at, DB_FLUX, DB_REPO, iso } from './fixtures.js';
import {
  ALERT_STATUSES,
  VERDICT_STATUS,
  observationOf,
  planIncidents,
  runIncidentPlane,
} from './integration.js';

const FACTORY = 'thonyAGP/DevOps-Factory';
const DB_FLOW: Flow = {
  id: DB_FLUX,
  label: 'db-backups, copie distante',
  type: 'github-commits',
  repo: DB_REPO,
  branch: 'main',
  messagePattern: '^chore\\(dumps\\): backup',
  thresholdHours: 26,
};
const CI_FLOW: Flow = {
  id: 'devops-factory-workflows',
  label: 'DevOps-Factory, workflows chroniques',
  type: 'github-workflow-runs',
  repo: FACTORY,
  workflows: ['renovate.yml'],
  consecutiveRunFailures: 3,
};
const HTTPS_FLOW: Flow = {
  id: 'boxmail-server',
  label: 'Boxmail, serveur',
  type: 'https',
  url: 'https://boxmail.lb2i.com/health',
  expectStatus: 200,
  consecutiveFailures: 2,
};

const EMPTY: WatchdogState = { lastDailySummaryDate: null, flows: {} };
const checked = (healthy: boolean, detail = 'détail'): CheckOutcome => ({
  kind: 'checked',
  result: { healthy, detail, lastProofAt: null },
});

interface Pass {
  state: WatchdogState;
  incidents: IncidentEnvelope[];
  journal: string[];
}

/** Un passage comme run() : decide() du watchdog, puis planIncidents sur ses verdicts. */
const pass = (
  decl: Declaration,
  before: { state: WatchdogState; incidents: IncidentEnvelope[] },
  outcomes: Record<string, CheckOutcome>,
  hours: number,
  recentPrs: RepairPr[] = []
): Pass => {
  const now = at(hours);
  const d = decide(decl, before.state, outcomes, now);
  const input = { decl, outcomes, verdicts: d.verdicts, state: d.state, now, recentPrs };
  const plan = planIncidents(before.incidents, input);
  return { state: d.state, incidents: plan.incidents, journal: plan.journal };
};

const byFp = (p: Pass, empreinte: string) => p.incidents.find((e) => e.empreinte === empreinte);
const START = { state: EMPTY, incidents: [] };

describe('statuts du watchdog', () => {
  it('should match the statuses actually produced by silence-watchdog.ts', () => {
    const d = decide(
      { flows: [DB_FLOW, CI_FLOW, HTTPS_FLOW] },
      EMPTY,
      {
        [DB_FLUX]: checked(true),
        [CI_FLOW.id]: { kind: 'error', error: 'GitHub HTTP 404' },
        [HTTPS_FLOW.id]: checked(false),
      },
      at(0)
    );

    expect(VERDICT_STATUS.enAttente).toBe(PENDING_STATUS);
    expect(d.verdicts.map((v) => v.status)).toEqual(['OK', 'ERREUR', 'DOUTE 1/2']);
    expect(
      [DB_FLOW, CI_FLOW, HTTPS_FLOW].map(alertWord).every((w) => ALERT_STATUSES.includes(w))
    ).toBe(true);
  });

  it('should refuse to guess on an unknown verdict status', () => {
    expect(() =>
      observationOf(DB_FLOW, { id: DB_FLUX, status: 'BIZARRE', line: '' }, undefined)
    ).toThrow(/statut de verdict inconnu/);
  });
});

describe('plan d’incidents sur les verdicts', () => {
  it('should never close a failure on a control error, and close both when the stream is healthy', () => {
    // Arrange : silence a T0, puis GitHub refuse (ERREUR), puis flux frais
    const decl = { flows: [DB_FLOW] };
    const red = pass(decl, START, { [DB_FLUX]: checked(false) }, 0);
    const blind = pass(decl, red, { [DB_FLUX]: { kind: 'error', error: 'GitHub HTTP 404' } }, 6);

    // Act
    const back = pass(decl, blind, { [DB_FLUX]: checked(true) }, 12);

    // Assert
    expect(byFp(blind, 'db-backups:silence')).toMatchObject({
      etat: 'enquete_demandee',
      occurrences: 1,
    });
    expect(byFp(blind, 'db-backups:erreur')).toMatchObject({ etat: 'ouvert', priorite: 'normale' });
    expect(back.incidents.map((e) => e.etat)).toEqual(['ferme', 'ferme']);
    expect(back.journal.filter((l) => l.includes(': fermé '))).toHaveLength(2);
  });

  it('should ignore a pending stream and a DOUTE below the alert threshold', () => {
    const decl = { flows: [{ ...DB_FLOW, pending: true }, HTTPS_FLOW] };
    const p = pass(decl, START, { [DB_FLUX]: checked(false), [HTTPS_FLOW.id]: checked(false) }, 0);
    expect(p.incidents).toEqual([]);
  });

  it('should date a new incident from the alert the watchdog already had open', () => {
    // L'alerte ROUGE est ouverte depuis 2 jours (etat persistant d'avant le plan d'incidents)
    const since = iso(-48);
    const state: WatchdogState = {
      lastDailySummaryDate: null,
      flows: {
        [CI_FLOW.id]: {
          alertOpenSince: since,
          consecutiveFailures: 8,
          lastCheckedAt: iso(-6),
          lastOkAt: null,
        },
      },
    };
    const p = pass(
      { flows: [CI_FLOW] },
      { state, incidents: [] },
      { [CI_FLOW.id]: checked(false) },
      0
    );

    expect(p.incidents[0]).toMatchObject({ premiereOccurrence: since, derniereOccurrence: iso(0) });
  });

  it('should set causedBy when the incident is born within 24 h after a repair PR on its repo', () => {
    const repair: RepairPr = {
      depot: FACTORY,
      numero: 3324,
      auteur: 'reparateur',
      horodatage: iso(-3),
      incidentId: null,
    };
    const p = pass({ flows: [CI_FLOW] }, START, { [CI_FLOW.id]: checked(false) }, 0, [repair]);

    expect(p.incidents[0]?.causedBy).toBe('thonyAGP/DevOps-Factory#3324');
    expect(p.journal[0]).toContain('causé par thonyAGP/DevOps-Factory#3324');
  });

  it('should apply a per-flow override, and fail loudly on an invalid one', () => {
    const quiet = {
      flows: [{ ...DB_FLOW, incident: { priorite: 'basse', depot: 'thonyAGP/Boxmail' } }],
    };
    const p = pass(quiet, START, { [DB_FLUX]: checked(false) }, 0);
    expect(p.incidents[0]).toMatchObject({
      priorite: 'basse',
      etat: 'ouvert',
      source: { depot: 'thonyAGP/Boxmail' },
    });
    expect(p.journal[0]).toContain("pas d'enquête (priorite_sous_seuil)");

    const typo = { flows: [{ ...DB_FLOW, incident: { cooldown: 12 } }] };
    expect(() => pass(typo, START, { [DB_FLUX]: checked(false) }, 0)).toThrow(
      /champ inconnu cooldown/
    );
  });
});

describe('runIncidentPlane — garde anti-secret', () => {
  it('should refuse to write and report an error when a known secret would reach data/incidents/', () => {
    // Arrange : un « secret » qui figurerait tel quel dans le fichier (ici, l'id du flux)
    const files = new Map<string, string>();
    const errors: string[] = [];
    const decl = { flows: [DB_FLOW] };
    const outcomes = { [DB_FLUX]: checked(false) };
    const d = decide(decl, EMPTY, outcomes, at(0));

    // Act
    const plan = runIncidentPlane({
      input: { decl, outcomes, verdicts: d.verdicts, state: d.state, now: at(0) },
      io: { readFile: (p) => files.get(p) ?? null, writeFile: (p, c) => void files.set(p, c) },
      dryRun: false,
      redact: (t) => t.split(DB_FLUX).join('****'),
      log: () => undefined,
      errors,
    });

    // Assert
    expect(plan).toBeNull();
    expect(errors).toEqual(['incidents : secret détecté, écriture refusée']);
    expect(files.size).toBe(0);
  });
});
