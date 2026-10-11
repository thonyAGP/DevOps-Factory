/**
 * store.test.ts — data/incidents/ : fichier relu et valide, ecriture atomique (vrai disque, dossier temporaire).
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { iso, makeEnvelope } from './fixtures.js';
import {
  INCIDENTS_PATH,
  MEMORY_PATH,
  ensureMemory,
  parseIncidents,
  parseMemory,
  serializeIncidents,
  writeFileAtomic,
  type StoreIo,
} from './store.js';

const older = makeEnvelope({
  id: 'inc-boxmail-server-http_ko-202610100400',
  empreinte: 'boxmail-server:http_ko',
  flux: 'boxmail-server',
  classe: 'http_ko',
  impact: 'service_indisponible',
  premiereOccurrence: iso(-24),
});
const newer = makeEnvelope();

const memoryIo = (files: Map<string, string>): StoreIo => ({
  readFile: (p) => files.get(p) ?? null,
  write: (p, c) => {
    files.set(p, c);
  },
});

describe('incidents.json — lecture validée', () => {
  it('should read an absent file as no incident', () => {
    expect(parseIncidents(null)).toEqual({ ok: true, value: [] });
  });

  it.each([
    ['unreadable JSON', '[{', 'JSON illisible'],
    ['an object instead of an array', '{}', 'tableau attendu'],
    [
      'an invalid envelope',
      JSON.stringify([{ ...newer, etat: 'resolu' }]),
      '[0] : enveloppe invalide',
    ],
    [
      'two incidents for one fingerprint',
      JSON.stringify([newer, { ...newer, id: 'inc-x' }]),
      'doublon',
    ],
  ])('should refuse %s and say why', (_label, raw, reason) => {
    const r = parseIncidents(raw);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error).toContain(reason);
  });

  it('should serialize sorted by birth, newline-terminated, and read back identical', () => {
    const content = serializeIncidents([newer, older]);

    expect(content.endsWith(']\n')).toBe(true);
    expect(parseIncidents(content)).toEqual({ ok: true, value: [older, newer] });
  });

  it('should refuse to serialize what it could not read back', () => {
    expect(() => serializeIncidents([{ ...newer, etat: 'ferme' }])).toThrow(/écriture refusée/);
  });
});

describe('memoire.json — créée si absente', () => {
  it('should create the empty memory once, then leave it alone', () => {
    // Arrange
    const files = new Map<string, string>();
    const io = memoryIo(files);

    // Act
    const first = ensureMemory(io);
    const second = ensureMemory(io);

    // Assert
    expect(first).toBe('cree');
    expect(second).toBe('present');
    expect(JSON.parse(files.get(MEMORY_PATH) ?? 'null')).toEqual({ version: 1, incidents: [] });
    expect(files.has(INCIDENTS_PATH)).toBe(false);
  });

  it('should refuse a memory file outside its closed schema', () => {
    expect(parseMemory('{"version":2,"incidents":[]}').ok).toBe(false);
    expect(parseMemory('{"version":1,"incidents":[],"note":"x"}').ok).toBe(false);
    expect(() => ensureMemory(memoryIo(new Map([[MEMORY_PATH, '[']])))).toThrow(/illisible/);
  });
});

describe('écriture atomique — vrai disque', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'incidents-store-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should create the folder, write the content and leave no temporary file', () => {
    const target = join(dir, 'data', 'incidents', 'incidents.json');

    writeFileAtomic(target, '[]\n');
    writeFileAtomic(target, serializeIncidents([newer]));

    expect(parseIncidents(readFileSync(target, 'utf-8'))).toEqual({ ok: true, value: [newer] });
    expect(readdirSync(join(dir, 'data', 'incidents'))).toEqual(['incidents.json']);
  });

  it('should keep the previous target and remove the temporary file when the rename fails', () => {
    // Arrange : la cible est un dossier, le rename ne peut pas la remplacer
    const target = join(dir, 'incidents.json');
    mkdirSync(target);

    // Act + Assert
    expect(() => writeFileAtomic(target, '[]\n')).toThrow();
    expect(existsSync(target)).toBe(true);
    expect(readdirSync(dir)).toEqual(['incidents.json']);
  });
});
