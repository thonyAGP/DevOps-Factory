/**
 * schema.ts — lecteurs de schema JSON ferme, sans dependance.
 *
 * Chaque lecteur part de `unknown`, rend une valeur typee ou leve SchemaError ;
 * `exactKeys` refuse tout champ inconnu ou manquant. Sert a parseEnvelope() et
 * servira a valider la sortie de l'analyste (etape 2 du CHG-012).
 */

export class SchemaError extends Error {}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type Json = Record<string, unknown>;

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export const isRecord = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  list.some((item) => item === v);

export const isIsoDate = (v: unknown): v is string =>
  typeof v === 'string' && ISO_DATE_RE.test(v) && !Number.isNaN(Date.parse(v));

/** Apercu borne d'une valeur rejetee, pour le message d'erreur. */
const show = (v: unknown): string => (JSON.stringify(v) ?? String(v)).slice(0, 40);

export const exactKeys = (o: Json, keys: readonly string[], where: string): void => {
  const unknownKeys = Object.keys(o).filter((k) => !keys.includes(k));
  if (unknownKeys.length > 0) {
    throw new SchemaError(`${where} : champ inconnu ${unknownKeys.join(', ')}`);
  }
  const missing = keys.filter((k) => !Object.hasOwn(o, k));
  if (missing.length > 0) throw new SchemaError(`${where} : champ manquant ${missing.join(', ')}`);
};

export const text = (o: Json, k: string, re: RegExp): string => {
  const v = o[k];
  if (typeof v !== 'string' || !re.test(v)) throw new SchemaError(`${k} invalide : ${show(v)}`);
  return v;
};

export const textOrNull = (o: Json, k: string, re: RegExp): string | null =>
  o[k] === null ? null : text(o, k, re);

export const pick = <T extends string>(o: Json, k: string, list: readonly T[]): T => {
  const v = o[k];
  if (!isOneOf(list, v)) throw new SchemaError(`${k} hors liste fermée : ${show(v)}`);
  return v;
};

export const date = (o: Json, k: string): string => {
  const v = o[k];
  if (!isIsoDate(v)) throw new SchemaError(`${k} : date ISO UTC attendue, reçu ${show(v)}`);
  return v;
};

export const dateOrNull = (o: Json, k: string): string | null =>
  o[k] === null ? null : date(o, k);

export const count = (o: Json, k: string, min: number, max: number): number => {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new SchemaError(`${k} : entier entre ${min} et ${max} attendu, reçu ${show(v)}`);
  }
  return v;
};

export const bool = (o: Json, k: string): boolean => {
  const v = o[k];
  if (typeof v !== 'boolean') throw new SchemaError(`${k} : booléen attendu`);
  return v;
};

/** Sous-objet ferme : objet, exactement les cles attendues. */
export const sub = (o: Json, k: string, keys: readonly string[]): Json => {
  const v = o[k];
  if (!isRecord(v)) throw new SchemaError(`${k} : objet attendu`);
  exactKeys(v, keys, k);
  return v;
};

/** Execute un constructeur de valeur ; une SchemaError devient un ParseResult en echec. */
export const parseWith = <T>(build: () => T, label: string): ParseResult<T> => {
  try {
    return { ok: true, value: build() };
  } catch (e) {
    if (e instanceof SchemaError) return { ok: false, error: `${label} invalide : ${e.message}` };
    throw e;
  }
};
