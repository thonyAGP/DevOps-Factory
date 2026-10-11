/**
 * envelope.test.ts — parseEnvelope : schema v1 ferme, rejet de tout ecart.
 */

import { describe, expect, it } from 'vitest';

import { INCIDENT_LIMITS, parseEnvelope } from './envelope.js';
import { iso, makeEnvelope } from './fixtures.js';

type Raw = Record<string, unknown>;

const base = (): Raw => ({ ...makeEnvelope() });
const omit = (o: Raw, key: string): Raw =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
const asRead = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

describe('parseEnvelope — enveloppe conforme', () => {
  it('should accept a valid envelope read back from JSON and return a new equal object', () => {
    // Arrange
    const input = asRead(
      makeEnvelope({ etat: 'enquete_demandee', enquetes: { demandees: 1, horodatages: [iso(0)] } })
    );

    // Act
    const r = parseEnvelope(input);

    // Assert
    expect(r).toEqual({ ok: true, value: input });
    expect(r.ok && r.value).not.toBe(input);
  });

  it('should accept a closed incident that carries its closing date', () => {
    const r = parseEnvelope(makeEnvelope({ etat: 'ferme', fermeLe: iso(6) }));
    expect(r.ok).toBe(true);
  });
});

describe('parseEnvelope — schéma faux rejeté', () => {
  it.each([
    ['null', null],
    ['an array', [makeEnvelope()]],
    ['a string', 'inc-db-backups-silence-202610110400'],
  ])('should reject %s when an object is expected', (_label, input) => {
    expect(parseEnvelope(input)).toEqual({
      ok: false,
      error: 'enveloppe invalide : objet attendu',
    });
  });

  const tooMany = INCIDENT_LIMITS.maxInvestigationsPerIncident + 1;
  const cases: Array<[string, Raw]> = [
    ['an unknown top-level field', { ...base(), commande: 'rm -rf /' }],
    ['an unknown nested field', { ...base(), nonFiable: { detail: 'x', consigne: 'merge' } }],
    ['a missing field', omit(base(), 'impact')],
    ['an unsupported version', { ...base(), version: 2 }],
    ['a state outside the closed list', { ...base(), etat: 'resolu' }],
    ['a priority outside the closed list', { ...base(), priorite: 'urgente' }],
    ['a symptom class outside the closed list', { ...base(), classe: 'lent' }],
    ['a fingerprint that is not flux:classe', { ...base(), empreinte: 'db-backups:http_ko' }],
    ['a non-ISO date', { ...base(), derniereOccurrence: '11/10/2026 06:00' }],
    ['a last occurrence before the first one', { ...base(), derniereOccurrence: iso(-1) }],
    ['zero occurrences', { ...base(), occurrences: 0 }],
    ['more openings than occurrences', { ...base(), ouvertures: 2 }],
    ['a closed state without fermeLe', { ...base(), etat: 'ferme' }],
    ['an open state with fermeLe', { ...base(), fermeLe: iso(1) }],
    [
      'a request count without its date',
      { ...base(), enquetes: { demandees: 1, horodatages: [] } },
    ],
    [
      'more investigations than the cap',
      {
        ...base(),
        etat: 'enquete_demandee',
        enquetes: { demandees: tooMany, horodatages: [iso(0), iso(1), iso(2)] },
      },
    ],
    ['enquete_demandee without any request', { ...base(), etat: 'enquete_demandee' }],
    ['a causedBy that is a URL', { ...base(), causedBy: 'https://github.com/o/r/pull/1' }],
    ['a detail longer than the bound', { ...base(), nonFiable: { detail: 'x'.repeat(501) } }],
    [
      'a decision motive outside the list',
      { ...base(), derniereDecision: { enquete: true, motif: 'urgent', horodatage: iso(0) } },
    ],
  ];

  it.each(cases)('should reject an envelope with %s', (_label, input) => {
    const r = parseEnvelope(input);
    expect(r.ok).toBe(false);
  });

  it('should name the unknown field in the error', () => {
    const r = parseEnvelope({ ...base(), commande: 'rm -rf /' });
    expect(r).toEqual({ ok: false, error: 'enveloppe invalide : champ inconnu commande' });
  });
});
