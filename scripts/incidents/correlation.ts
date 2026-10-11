/**
 * correlation.ts — rattachement d'un incident a la PR qui l'a probablement cause.
 *
 * Un incident qui NAIT dans les 24 h apres une PR du reparateur ou de l'analyste
 * sur le MEME depot porte `causedBy` (reference `owner/repo#n`, le format des
 * references Rappels) et `incidentRootId` : l'incident que la PR traitait, propage
 * jusqu'a sa racine (boucle d'incident : la PR de reparation casse la CI).
 *
 * Etape 1 : la liste des PR recentes est un PARAMETRE ; rien n'est lu sur GitHub.
 */

import { ID_RE, INCIDENT_LIMITS, PR_REF_RE, type IncidentEnvelope } from './envelope.js';

export const REPAIR_AUTHORS = ['reparateur', 'analyste'] as const;
export type RepairAuthor = (typeof REPAIR_AUTHORS)[number];

export interface RepairPr {
  /** `owner/repo`. */
  depot: string;
  numero: number;
  auteur: RepairAuthor;
  /** Ouverture ou merge de la PR (le plus recent des deux), ISO UTC. */
  horodatage: string;
  /** Incident que la PR traitait, s'il est connu. */
  incidentId: string | null;
}

export interface Correlation {
  causedBy: string | null;
  incidentRootId: string | null;
}

export const NO_CORRELATION: Correlation = { causedBy: null, incidentRootId: null };

export const prRef = (pr: Pick<RepairPr, 'depot' | 'numero'>): string => `${pr.depot}#${pr.numero}`;

const HOUR_MS = 3_600_000;

const isUsable = (pr: RepairPr): boolean =>
  PR_REF_RE.test(prRef(pr)) && !Number.isNaN(Date.parse(pr.horodatage));

const rootOf = (pr: RepairPr, known: readonly IncidentEnvelope[]): string | null => {
  if (pr.incidentId === null || !ID_RE.test(pr.incidentId)) return null;
  const parent = known.find((i) => i.id === pr.incidentId);
  return parent ? (parent.incidentRootId ?? parent.id) : pr.incidentId;
};

/**
 * Correlation d'un incident a sa naissance. Plusieurs PR candidates : la plus
 * recente l'emporte (a egalite, le plus grand numero). Depot inconnu : aucune.
 */
export const correlate = (
  birth: { depot: string | null; at: string },
  prs: readonly RepairPr[],
  known: readonly IncidentEnvelope[]
): Correlation => {
  if (birth.depot === null) return NO_CORRELATION;
  const depot = birth.depot.toLowerCase();
  const bornAt = Date.parse(birth.at);
  const windowMs = INCIDENT_LIMITS.correlationWindowHours * HOUR_MS;
  const [pr] = prs
    .filter((p) => {
      const delta = bornAt - Date.parse(p.horodatage);
      return isUsable(p) && p.depot.toLowerCase() === depot && delta >= 0 && delta <= windowMs;
    })
    .sort((a, b) => Date.parse(b.horodatage) - Date.parse(a.horodatage) || b.numero - a.numero);
  return pr ? { causedBy: prRef(pr), incidentRootId: rootOf(pr, known) } : NO_CORRELATION;
};
