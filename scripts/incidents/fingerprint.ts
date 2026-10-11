/**
 * fingerprint.ts — empreinte logique d'une panne : `<flux>:<classe>`.
 *
 * La classe de symptome se derive du verdict du watchdog et de son CheckOutcome
 * (type de flux en alerte, nature de l'erreur de controle), jamais du texte libre
 * du detail : l'empreinte reste donc stable d'une occurrence a l'autre et entre
 * reouvertures. Un detail qui change ne cree jamais un nouvel incident.
 */

import type { FlowType, SymptomClass } from './envelope.js';

/** Classes ou le watchdog n'a PAS pu observer le flux : ce n'est pas une panne du flux. */
export const ERROR_CLASSES: readonly SymptomClass[] = ['erreur', 'secret_absent'];

/** Message leve par httpsHeaders() (silence-watchdog.ts) quand le secret d'un flux manque. */
export const SECRET_ABSENT_RE = /^secret [A-Za-z0-9_]+ absent$/;

export const isErrorClass = (classe: SymptomClass): boolean => ERROR_CLASSES.includes(classe);

export const fingerprintOf = (flux: string, classe: SymptomClass): string => `${flux}:${classe}`;

/**
 * Classe d'un flux EN ALERTE (verdict SILENCE, ROUGE ou PANNE) : une seule par
 * type de flux, donc stable quel que soit le detail (HTTP 502, injoignable...).
 */
export const failureClassOf = (type: FlowType): SymptomClass => {
  switch (type) {
    case 'github-commits':
    case 'github-file-date':
      return 'silence';
    case 'github-workflow-runs':
      return 'echec_workflow';
    case 'https':
      return 'http_ko';
  }
};

/** Classe d'un controle impossible (verdict ERREUR) : secret absent, ou toute autre erreur. */
export const errorClassOf = (error: string): SymptomClass =>
  SECRET_ABSENT_RE.test(error) ? 'secret_absent' : 'erreur';
