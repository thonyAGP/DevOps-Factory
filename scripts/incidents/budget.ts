/**
 * budget.ts — budget d'attention d'Anthony (CHG-012).
 *
 * Au plus 7 dossiers « qui sonnent » par jour civil Europe/Madrid. La priorite
 * `critique` passe outre, hors quota (une rafale de dossiers faibles ne masque
 * jamais un critique) ; au-dela du plafond, les autres sont `regroupe` :
 * consultables, jamais perdus. Fonctions pures. Etape 1 : appelees par les tests
 * seulement ; l'etape 2 les branche sur la creation des dossiers Rappels.
 */

import { INCIDENT_LIMITS, type Priority } from './envelope.js';

export type RingOutcome = 'sonne' | 'regroupe';

export interface RingBudget {
  /** Jour civil Europe/Madrid, AAAA-MM-JJ. */
  jour: string;
  /** Dossiers ordinaires qui ont sonne (plafonnes). */
  sonnes: number;
  /** Dossiers critiques qui ont sonne (hors quota). */
  critiques: number;
  regroupes: number;
}

export const madridDay = (now: Date): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

/** Budget du jour civil de `now` : celui passe s'il est du meme jour, sinon un neuf. */
export const budgetOf = (budget: RingBudget | null, now: Date): RingBudget => {
  const jour = madridDay(now);
  return budget?.jour === jour ? budget : { jour, sonnes: 0, critiques: 0, regroupes: 0 };
};

export const allocateRing = (
  budget: RingBudget | null,
  priorite: Priority,
  now: Date,
  cap: number = INCIDENT_LIMITS.dailyRingCap
): { sortie: RingOutcome; budget: RingBudget } => {
  const day = budgetOf(budget, now);
  if (priorite === 'critique') {
    return { sortie: 'sonne', budget: { ...day, critiques: day.critiques + 1 } };
  }
  if (day.sonnes < cap) return { sortie: 'sonne', budget: { ...day, sonnes: day.sonnes + 1 } };
  return { sortie: 'regroupe', budget: { ...day, regroupes: day.regroupes + 1 } };
};
