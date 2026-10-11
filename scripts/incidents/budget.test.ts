/**
 * budget.test.ts — 7 dossiers qui sonnent par jour civil Europe/Madrid, le critique passe outre.
 */

import { describe, expect, it } from 'vitest';

import { allocateRing, madridDay, type RingBudget, type RingOutcome } from './budget.js';
import type { Priority } from './envelope.js';

const NOON = new Date('2026-10-11T10:00:00Z');

/** Alloue une suite de priorites le meme jour ; rend les sorties et le budget final. */
const allocateAll = (priorities: Priority[], now = NOON) => {
  let budget: RingBudget | null = null;
  const sorties: RingOutcome[] = [];
  for (const p of priorities) {
    const r = allocateRing(budget, p, now);
    sorties.push(r.sortie);
    budget = r.budget;
  }
  return { sorties, budget };
};

describe('budget d’attention', () => {
  it('should ring at most 7 of 8 low-priority dossiers and group the eighth', () => {
    // Arrange
    const eight: Priority[] = Array.from({ length: 8 }, () => 'basse');

    // Act
    const { sorties, budget } = allocateAll(eight);

    // Assert
    expect(sorties.filter((s) => s === 'sonne')).toHaveLength(7);
    expect(sorties[7]).toBe('regroupe');
    expect(budget).toEqual({ jour: '2026-10-11', sonnes: 7, critiques: 0, regroupes: 1 });
  });

  it('should ring a ninth critical dossier despite the exhausted quota', () => {
    const nine: Priority[] = [...Array.from({ length: 8 }, (): Priority => 'basse'), 'critique'];
    const { sorties, budget } = allocateAll(nine);

    expect(sorties[8]).toBe('sonne');
    expect(budget?.critiques).toBe(1);
  });

  it('should not let critical dossiers consume the ordinary quota', () => {
    const highs = Array.from({ length: 7 }, (): Priority => 'haute');
    const mixed: Priority[] = ['critique', 'critique', 'critique', ...highs];
    const { sorties } = allocateAll(mixed);

    expect(sorties.every((s) => s === 'sonne')).toBe(true);
  });

  it('should reset at midnight Europe/Madrid, not at midnight UTC', () => {
    // 21:59:59Z = 23:59:59 a Madrid (heure d'ete), 22:00:00Z = 00:00 le lendemain
    const lastSecond = new Date('2026-10-11T21:59:59Z');
    const nextDay = new Date('2026-10-11T22:00:00Z');
    const full: RingBudget = { jour: madridDay(lastSecond), sonnes: 7, critiques: 0, regroupes: 0 };

    expect(allocateRing(full, 'basse', lastSecond).sortie).toBe('regroupe');
    expect(allocateRing(full, 'basse', nextDay)).toEqual({
      sortie: 'sonne',
      budget: { jour: '2026-10-12', sonnes: 1, critiques: 0, regroupes: 0 },
    });
  });
});
