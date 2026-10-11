/**
 * store.ts — persistance du plan d'incidents, data/incidents/.
 *
 *  - incidents.json : tableau d'IncidentEnvelope, relu et VALIDE a chaque passage.
 *    Un fichier illisible arrete le plan en ERREUR et n'est jamais ecrase (pas de
 *    remise a zero silencieuse qui recreerait des incidents en double).
 *  - memoire.json : memoire des incidents resolus, `{ "version": 1, "incidents": [] }`,
 *    creee si absente ; remplie a l'etape 2 (schema de ses entrees defini alors).
 *
 * Ecriture atomique (fichier temporaire du meme dossier, puis rename). L'appelant
 * n'ecrit jamais en --dry-run ; la garde anti-secret est dans integration.ts.
 */

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';

import { parseEnvelope, type IncidentEnvelope } from './envelope.js';
import { exactKeys, isRecord, parseWith, SchemaError, type ParseResult } from './schema.js';

export const INCIDENTS_DIR = 'data/incidents';
export const INCIDENTS_PATH = `${INCIDENTS_DIR}/incidents.json`;
export const MEMORY_PATH = `${INCIDENTS_DIR}/memoire.json`;
export const MEMORY_VERSION = 1;

export interface IncidentMemory {
  version: typeof MEMORY_VERSION;
  incidents: unknown[];
}

/** Lecture (null : fichier absent) et ecriture, relatives a la racine du depot. */
export interface StoreIo {
  readFile: (path: string) => string | null;
  write: (path: string, content: string) => void;
}

const parseJson = (raw: string, path: string): ParseResult<unknown> => {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: `${path} : JSON illisible` };
  }
};

/** Absent : aucun incident. Present : chaque enveloppe valide, une seule par empreinte et par id. */
export const parseIncidents = (raw: string | null): ParseResult<IncidentEnvelope[]> => {
  if (raw === null) return { ok: true, value: [] };
  const json = parseJson(raw, INCIDENTS_PATH);
  if (!json.ok) return json;
  if (!Array.isArray(json.value))
    return { ok: false, error: `${INCIDENTS_PATH} : tableau attendu` };
  const items: unknown[] = json.value;
  const out: IncidentEnvelope[] = [];
  const fingerprints = new Set<string>();
  const ids = new Set<string>();
  for (const [i, item] of items.entries()) {
    const r = parseEnvelope(item);
    if (!r.ok) return { ok: false, error: `${INCIDENTS_PATH}[${i}] : ${r.error}` };
    if (fingerprints.has(r.value.empreinte) || ids.has(r.value.id)) {
      return { ok: false, error: `${INCIDENTS_PATH}[${i}] : doublon ${r.value.empreinte}` };
    }
    fingerprints.add(r.value.empreinte);
    ids.add(r.value.id);
    out.push(r.value);
  }
  return { ok: true, value: out };
};

const byBirth = (a: IncidentEnvelope, b: IncidentEnvelope): number =>
  Date.parse(a.premiereOccurrence) - Date.parse(b.premiereOccurrence) ||
  (a.id < b.id ? -1 : Number(a.id > b.id));

/** Serialisation stable (tri par naissance puis id). Refuse ce qu'elle ne saurait relire. */
export const serializeIncidents = (incidents: readonly IncidentEnvelope[]): string => {
  const content = `${JSON.stringify([...incidents].sort(byBirth), null, 2)}\n`;
  const back = parseIncidents(content);
  if (!back.ok) throw new Error(`écriture refusée, incidents non conformes : ${back.error}`);
  return content;
};

export const emptyMemory = (): IncidentMemory => ({ version: MEMORY_VERSION, incidents: [] });

export const parseMemory = (raw: string): ParseResult<IncidentMemory> => {
  const json = parseJson(raw, MEMORY_PATH);
  if (!json.ok) return json;
  return parseWith((): IncidentMemory => {
    const m = json.value;
    if (!isRecord(m)) throw new SchemaError('objet attendu');
    exactKeys(m, ['version', 'incidents'], 'memoire');
    if (m.version !== MEMORY_VERSION) throw new SchemaError(`version ${MEMORY_VERSION} attendue`);
    const incidents: unknown = m.incidents;
    if (!Array.isArray(incidents)) throw new SchemaError('incidents : tableau attendu');
    return { version: MEMORY_VERSION, incidents: [...incidents] };
  }, MEMORY_PATH);
};

export const loadIncidents = (io: StoreIo): ParseResult<IncidentEnvelope[]> =>
  parseIncidents(io.readFile(INCIDENTS_PATH));

/** Cree memoire.json s'il manque ; un fichier present doit etre lisible. */
export const ensureMemory = (io: StoreIo): 'cree' | 'present' => {
  const raw = io.readFile(MEMORY_PATH);
  if (raw === null) {
    io.write(MEMORY_PATH, `${JSON.stringify(emptyMemory(), null, 2)}\n`);
    return 'cree';
  }
  const memory = parseMemory(raw);
  if (!memory.ok) throw new Error(memory.error);
  return 'present';
};

/**
 * Ecrit `content` dans `fullPath` de facon atomique : le dossier est cree, le
 * contenu part dans un temporaire du meme dossier puis remplace la cible par
 * rename. En cas d'echec, le temporaire est supprime et la cible reste intacte.
 */
export const writeFileAtomic = (fullPath: string, content: string): void => {
  mkdirSync(dirname(fullPath), { recursive: true });
  const tmp = `${fullPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, content, 'utf-8');
    renameSync(tmp, fullPath);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
};
