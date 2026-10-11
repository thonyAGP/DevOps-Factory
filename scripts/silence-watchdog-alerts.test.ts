/**
 * silence-watchdog-alerts.test.ts — politique d'alerte Telegram sobre (12/10), jouee par run().
 *
 * Un message seulement pour un incident (panne ou erreur de controle) nouveau, ou rouvert
 * apres le cooldown du flux (compte depuis sa fermeture) ; occurrence, erreur qui dure et
 * reouverture dans le cooldown : silence, jamais de rappel ; retour a la normale silencieux
 * sauf `notifyRecovery: true`.
 */

import { describe, expect, it } from 'vitest';

import { INCIDENTS_PATH } from './incidents/store.js';
import { DB, T0, at, makeBench } from './silence-watchdog-harness.js';

const SILENCE_ALERT = /^🕯 Silence — db-backups, copie distante : SILENCE\. /;

describe('politique d’alerte — pannes', () => {
  it('should send one message when the incident is new', async () => {
    const b = makeBench([DB]);

    expect(await b.pass(0, 'rouge')).toBe(0);

    expect(b.telegram).toHaveLength(1);
    expect(b.telegram[0]).toMatch(SILENCE_ALERT);
    expect(b.logs).toContain('[alerte] db-backups : message (nouvel_incident)');
    expect(b.flowState(DB.id)?.lastAlertAt).toBe(T0.toISOString());
  });

  it('should stay silent on an occurrence of an incident already open', async () => {
    const b = makeBench([DB]);
    await b.pass(0, 'rouge');

    expect(await b.pass(6, 'rouge')).toBe(0);

    expect(b.telegram).toHaveLength(1);
    expect(b.logs).toContain('[alerte] db-backups : silence (alerte_deja_ouverte)');
    expect(b.incidents()).toHaveLength(1);
    expect(b.incidents()[0]?.occurrences).toBe(2);
  });

  it('should stay silent when the incident reopens within the cooldown after its closure', async () => {
    const b = makeBench([DB]);
    await b.pass(0, 'rouge');
    await b.pass(6, 'vert'); // fermé à T0 + 6 h

    expect(await b.pass(10, 'rouge')).toBe(0); // rouvert 4 h après : cooldown de 6 h

    expect(b.telegram).toHaveLength(1);
    expect(b.logs).toContain('[alerte] db-backups : silence (rouvert_dans_cooldown)');
    // Même incident rouvert ; le cooldown d'ENQUÊTE (depuis la demande de T0) est, lui, écoulé.
    expect(b.incidents()).toHaveLength(1);
    expect(b.incidents()[0]).toMatchObject({ ouvertures: 2, etat: 'enquete_demandee' });
    expect(b.flowState(DB.id)?.alertOpenSince).toBe(at(10).toISOString()); // alerte ouverte, tue
  });

  it('should send one message when the incident reopens after the cooldown', async () => {
    const b = makeBench([DB]);
    await b.pass(0, 'rouge');
    await b.pass(6, 'vert');

    expect(await b.pass(13, 'rouge')).toBe(0); // rouvert 7 h après sa fermeture

    expect(b.telegram).toHaveLength(2);
    expect(b.telegram[1]).toMatch(SILENCE_ALERT);
    expect(b.logs).toContain('[alerte] db-backups : message (rouvert_hors_cooldown)');
    expect(b.incidents()).toHaveLength(1);
  });

  it('should apply the per-flow cooldown override (incident.cooldownHeures)', async () => {
    const b = makeBench([{ ...DB, incident: { cooldownHeures: 12 } }]);
    await b.pass(0, 'rouge');
    await b.pass(6, 'vert');
    await b.pass(13, 'rouge'); // 7 h après la fermeture : dans les 12 h

    expect(b.telegram).toHaveLength(1);

    await b.pass(18, 'vert');
    await b.pass(31, 'rouge'); // 13 h après la fermeture
    expect(b.telegram).toHaveLength(2);
  });
});

describe('politique d’alerte — retour à la normale', () => {
  it('should close the alert and the incident silently by default', async () => {
    const b = makeBench([DB]);
    await b.pass(0, 'rouge');

    expect(await b.pass(6, 'vert')).toBe(0);

    expect(b.telegram).toHaveLength(1);
    expect(b.logs).toContain('[alerte] db-backups : silence (retour_silencieux)');
    expect(b.flowState(DB.id)?.alertOpenSince).toBeNull();
    expect(b.incidents()[0]?.etat).toBe('ferme');
  });

  it('should send one recovery message when the flow declares notifyRecovery: true', async () => {
    const b = makeBench([{ ...DB, notifyRecovery: true }]);
    await b.pass(0, 'rouge');

    await b.pass(6, 'vert');
    await b.pass(12, 'vert');

    expect(b.telegram).toHaveLength(2);
    expect(b.telegram[1]).toContain('retour à la normale');
    expect(b.logs).toContain('[alerte] db-backups : message (retour_notifie)');
  });

  it('should not announce the recovery of an alert whose opening was silenced', async () => {
    const b = makeBench([{ ...DB, notifyRecovery: true }]);
    await b.pass(0, 'rouge');
    await b.pass(6, 'vert'); // retour annoncé
    await b.pass(8, 'rouge'); // rouvert dans le cooldown : ouverture tue

    await b.pass(10, 'vert');

    expect(b.telegram).toHaveLength(2);
    expect(b.logs).toContain('[alerte] db-backups : silence (retour_sans_alerte_envoyee)');
  });

  it('should report an ERREUR, never ignore it, when notifyRecovery is not a boolean', async () => {
    const b = makeBench([{ ...DB, notifyRecovery: 'oui' }]);

    expect(await b.pass(0, 'vert')).toBe(1);

    expect(b.logs).toContain(
      'ERREUR watchdog : flux db-backups : notifyRecovery doit valoir true ou false'
    );
  });
});

describe('politique d’alerte — erreurs de contrôle', () => {
  it('should send one message for a new control error incident, then never remind, even after 24 h', async () => {
    const b = makeBench([DB]);

    expect(await b.pass(0, 'aveugle')).toBe(1);
    await b.pass(6, 'aveugle');
    await b.pass(30, 'aveugle'); // l'erreur dure plus de 24 h : aucun rappel

    expect(b.telegram).toHaveLength(1);
    expect(b.telegram[0]).toMatch(
      /^🕯 Silence — db-backups, copie distante : ERREUR\. contrôle impossible : GitHub injoignable/
    );
    expect(b.logs).toContain('[alerte] db-backups : message (nouvel_incident)');
    expect(b.logs).toContain('[alerte] db-backups : silence (erreur_deja_ouverte)');
    expect(b.flowState(DB.id)?.errorOpenSince).toBe(T0.toISOString());
    expect(b.incidents()[0]).toMatchObject({ empreinte: 'db-backups:erreur', occurrences: 3 });
  });

  it('should stay silent when the control error comes back within the cooldown, and speak after it', async () => {
    const b = makeBench([DB]);
    await b.pass(0, 'aveugle');
    await b.pass(6, 'vert'); // contrôle refait : incident d'erreur fermé, marqueur levé

    await b.pass(10, 'aveugle'); // rouvert 4 h après sa fermeture
    expect(b.telegram).toHaveLength(1);
    expect(b.logs).toContain('[alerte] db-backups : silence (rouvert_dans_cooldown)');

    await b.pass(12, 'vert');
    await b.pass(19, 'aveugle'); // rouvert 7 h après sa fermeture
    expect(b.telegram).toHaveLength(2);
    expect(b.logs).toContain('[alerte] db-backups : message (rouvert_hors_cooldown)');
  });

  it('should replay a control error message whose sending failed', async () => {
    const b = makeBench([DB]);
    b.setTelegramStatus(401);
    expect(await b.pass(0, 'aveugle')).toBe(1);
    expect(b.flowState(DB.id)?.errorOpenSince).toBeNull(); // entrée annulée : à rejouer

    b.setTelegramStatus(200);
    await b.pass(6, 'aveugle');

    expect(b.telegram).toHaveLength(1);
    expect(b.logs).toContain('[alerte] db-backups : message (rejeu)');
  });
});

describe('politique d’alerte — jamais de silence par défaut', () => {
  it('should replay an alert whose sending failed, although its incident is already open', async () => {
    const b = makeBench([DB]);
    b.setTelegramStatus(401);
    expect(await b.pass(0, 'rouge')).toBe(1);
    expect(b.flowState(DB.id)?.lastAlertAt).toBeUndefined();

    b.setTelegramStatus(200);
    expect(await b.pass(6, 'rouge')).toBe(0);

    expect(b.telegram).toHaveLength(1);
    expect(b.logs).toContain('[alerte] db-backups : message (rejeu)');
    expect(b.incidents()[0]?.occurrences).toBe(2);
  });

  it('should fall back to the watchdog anti-duplicate when the incident plan is down', async () => {
    const b = makeBench([DB], [[INCIDENTS_PATH, '[{"version":1']]);

    expect(await b.pass(0, 'rouge')).toBe(1);
    expect(await b.pass(6, 'rouge')).toBe(1);
    await b.pass(12, 'aveugle'); // entrée dans l'erreur : annoncée une fois
    await b.pass(18, 'aveugle');

    expect(b.telegram).toHaveLength(2);
    expect(b.telegram[0]).toMatch(SILENCE_ALERT);
    expect(b.telegram[1]).toContain(': ERREUR. contrôle impossible');
    expect(b.logs).toContain('[alerte] db-backups : message (plan_indisponible)');
    expect(b.logs).toContain('[alerte] db-backups : silence (alerte_deja_ouverte)');
    expect(b.logs).toContain('[alerte] db-backups : silence (erreur_deja_ouverte)');
  });
});
