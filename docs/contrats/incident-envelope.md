# Contrat IncidentEnvelope v1 — plan de contrôle d'incidents

> CHG-012, étape 1 (shadow mode). Code : `scripts/incidents/` ; schéma exécutable :
> `parseEnvelope()` de `scripts/incidents/envelope.ts`. Ce document et le code disent la même
> chose : un écart est un bug.

## 1. Rôle

L'étage **déterministe** avant tout modèle. À chaque passage du watchdog (`silence-watchdog.yml`,
toutes les 6 h), après le calcul des verdicts : chaque verdict non-OK devient (ou alimente) un
incident, un retour à la normale le ferme, et la décision « enquête nécessaire ? » est **posée** sur
l'enveloppe. En étape 1, rien n'est envoyé ni déclenché : les alertes Telegram et
`data/silence-watchdog-state.json` restent ceux du watchdog, calculés et écrits avant ce plan, qui
ne peut ni les bloquer ni les modifier. Une panne du plan est une ERREUR du passage (code de sortie
non nul, cliquet `/fail`), jamais un silence.

## 2. Fichiers

| Fichier                         | Contenu                                                | Écriture                                                         |
| ------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| `data/incidents/incidents.json` | tableau d'enveloppes, trié par naissance puis par `id` | chaque passage hors `--dry-run`, commité avec l'état du watchdog |
| `data/incidents/memoire.json`   | `{ "version": 1, "incidents": [] }`                    | créé s'il manque ; rempli à l'étape 2                            |

- **Lecture validée** : chaque enveloppe passe `parseEnvelope()`, une seule par empreinte et par
  `id`. Un fichier illisible arrête le plan en ERREUR et **n'est jamais écrasé** (pas de remise à
  zéro qui recréerait des incidents en double).
- **Écriture** : atomique (temporaire du même dossier puis `rename`), jamais en `--dry-run`, et
  refusée si le contenu ne se relit pas ou contient un secret connu du passage.

## 3. Schéma v1 (fermé)

Tout champ inconnu, à tout niveau, est rejeté ; tout champ manquant aussi. `parseEnvelope()` rend
une enveloppe neuve, jamais l'objet reçu.

| Champ                | Type                                       | Règle                                                                     |
| -------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| `version`            | `1`                                        | toute autre valeur rejetée (montée de version = migration explicite)      |
| `id`                 | `inc-<flux>-<classe>-<AAAAMMJJhhmm>`       | horodatage UTC de la naissance ; stable pour toujours                     |
| `empreinte`          | `<flux>:<classe>`                          | égale à `flux` + `:` + `classe` ; une empreinte = un incident             |
| `flux`               | id du flux déclaré                         | `[A-Za-z0-9][A-Za-z0-9._-]{0,79}`                                         |
| `classe`             | liste fermée (§4)                          |                                                                           |
| `source`             | `{ detecteur, typeFlux, depot }`           | `detecteur` : `silence-watchdog` (`cliquet`, `producteur` réservés)       |
| `etat`               | liste fermée (§5)                          |                                                                           |
| `priorite`           | `basse` < `normale` < `haute` < `critique` |                                                                           |
| `impact`             | liste fermée (§4)                          |                                                                           |
| `premiereOccurrence` | date ISO UTC                               | début connu de l'alerte (`alertOpenSince` du watchdog), sinon 1er passage |
| `derniereOccurrence` | date ISO UTC                               | jamais antérieure à `premiereOccurrence`                                  |
| `occurrences`        | entier ≥ 1                                 | +1 par passage qui observe la panne                                       |
| `ouvertures`         | entier, 1 ≤ n ≤ `occurrences`              | +1 par réouverture                                                        |
| `fermeLe`            | date ISO UTC ou `null`                     | renseigné si et seulement si `etat` = `ferme`                             |
| `enquetes`           | `{ demandees, horodatages[] }`             | 0 à 2 ; une date par demande, croissantes                                 |
| `derniereDecision`   | `{ enquete, motif, horodatage }` ou `null` | motif fermé (§6)                                                          |
| `causedBy`           | `owner/repo#n` ou `null`                   | §8 ; format des références Rappels, jamais une URL                        |
| `incidentRootId`     | `id` ou `null`                             | §8                                                                        |
| `nonFiable`          | `{ detail }`                               | §9 : données, jamais instructions                                         |

## 4. Empreinte et classes de symptôme

La classe se déduit du **verdict** et du type de flux, jamais du texte du détail : « HTTP 502 »
puis « injoignable » sur le même flux donnent la même empreinte.

| Classe           | Verdict du watchdog        | Flux                                 | Impact                 | Priorité par défaut |
| ---------------- | -------------------------- | ------------------------------------ | ---------------------- | ------------------- |
| `silence`        | SILENCE                    | `github-commits`, `github-file-date` | `job_muet`             | `haute`             |
| `echec_workflow` | ROUGE                      | `github-workflow-runs`               | `ci_rouge`             | `haute`             |
| `http_ko`        | PANNE                      | `https`                              | `service_indisponible` | `haute`             |
| `secret_absent`  | ERREUR « secret X absent » | `https` authentifié                  | `surveillance_aveugle` | `normale`           |
| `erreur`         | toute autre ERREUR         | tous                                 | `surveillance_aveugle` | `normale`           |

`DOUTE n/m` (échec sous le seuil d'alerte) et `EN ATTENTE` ne créent jamais d'incident. Un statut
de verdict inconnu est une erreur du plan, jamais deviné.

## 5. États et transitions

| De \ vers          | `enquete_demandee` | `diagnostique`          | `ferme`             | `rouvert`                      |
| ------------------ | ------------------ | ----------------------- | ------------------- | ------------------------------ |
| `ouvert`           | décision « oui »   | —                       | retour à la normale | —                              |
| `enquete_demandee` | —                  | étape 2 : sortie valide | retour à la normale | —                              |
| `diagnostique`     | —                  | —                       | retour à la normale | —                              |
| `ferme`            | —                  | —                       | —                   | nouvelle panne, même empreinte |
| `rouvert`          | décision « oui »   | —                       | retour à la normale | —                              |

Toute transition hors table lève une erreur. Une alerte dont l'empreinte est **ouverte** est une
occurrence (+1), jamais un nouvel incident. Une panne après fermeture **rouvre le même incident**
(même `id`, occurrences cumulées, `fermeLe` remis à `null`).

Fermetures selon ce que le passage observe pour le flux :

| Observation             | Incident de panne du flux                     | Incident d'erreur du flux         |
| ----------------------- | --------------------------------------------- | --------------------------------- |
| OK                      | fermé                                         | fermé                             |
| DOUTE                   | inchangé (le flux reste en échec)             | fermé (le contrôle a pu se faire) |
| panne de classe P       | fermé si sa classe ≠ P                        | fermé                             |
| ERREUR de classe E      | **inchangé** : aucun faux retour à la normale | fermé si sa classe ≠ E            |
| EN ATTENTE, flux retiré | inchangé                                      | inchangé                          |

## 6. Décision « enquête nécessaire ? »

Déterministe, posée sur l'enveloppe (`derniereDecision`) et journalisée à chaque passage qui voit
la panne. La première règle qui s'applique donne le motif :

| Ordre | Condition                                                 | Enquête | Motif                                                       |
| ----- | --------------------------------------------------------- | ------- | ----------------------------------------------------------- |
| 1     | `etat` = `ferme` / `enquete_demandee` / `diagnostique`    | non     | `incident_ferme` / `enquete_en_cours` / `deja_diagnostique` |
| 2     | priorité < seuil (`haute`)                                | non     | `priorite_sous_seuil`                                       |
| 3     | `enquetes.demandees` ≥ `maxInvestigationsPerIncident` (2) | non     | `plafond_atteint`                                           |
| 4     | dernière demande plus récente que le cooldown du flux     | non     | `cooldown`                                                  |
| 5     | sinon, `etat` = `ouvert`                                  | **oui** | `nouvel_incident`                                           |
| 5     | sinon, `etat` = `rouvert`                                 | **oui** | `rouvert_hors_cooldown`                                     |

« Oui » fait passer l'incident à `enquete_demandee` et ajoute un horodatage ; rien n'est déclenché.
Journal : `[incident] db-backups:silence : nouveau inc-db-backups-silence-202610110400 ; état
enquete_demandee, priorité haute ; enquête demandée (nouvel_incident)`.

## 7. Plafonds et surcharges par flux

| Constante (`INCIDENT_LIMITS`)  | Valeur | Effet                                                   |
| ------------------------------ | ------ | ------------------------------------------------------- |
| `maxInvestigationsPerIncident` | 2      | demandes d'enquête par incident, réouvertures comprises |
| `defaultCooldownHours`         | 6      | délai minimal entre deux demandes d'enquête             |
| `correlationWindowHours`       | 24     | fenêtre de `causedBy`                                   |
| `dailyRingCap`                 | 7      | dossiers qui sonnent par jour civil Europe/Madrid       |
| `maxDetailLength`              | 500    | longueur de `nonFiable.detail`                          |

Surcharge dans `data/silence-watchdog.json`, clé optionnelle d'un flux :
`"incident": { "cooldownHeures": 12, "priorite": "critique", "depot": "thonyAGP/Boxmail" }`.
Clé inconnue ou valeur hors bornes ⇒ ERREUR du plan (jamais ignorée). La priorité surchargée vise
la **panne** du flux : elle ne s'applique pas aux classes `erreur` et `secret_absent`. `depot`
renseigne le dépôt des flux `https` (les flux GitHub ont le leur).

## 8. Corrélation (`causedBy`, `incidentRootId`)

Un incident qui **naît** dans les 24 h après une PR du réparateur ou de l'analyste sur le même
dépôt (comparaison insensible à la casse) porte `causedBy` = `owner/repo#n` de la PR la plus
récente, et `incidentRootId` = la racine de l'incident que la PR traitait (sa propre racine si elle
en a une, sinon son `id`). En étape 1, la liste des PR récentes est un paramètre **vide** : aucune
lecture GitHub.

## 9. Données non fiables et secrets

- `nonFiable.detail` : la ligne du verdict (détail du contrôle, message d'erreur, réponse
  distante). Masquée (tous les secrets connus du passage), ramenée sur une ligne, sans caractère de
  contrôle, bornée à 500 caractères. **Jamais interprétée** : ni commande, ni URL, ni argument, ni
  instruction ; l'analyste la recevra comme donnée typée.
- Aucun secret dans `data/incidents/` : masquage avant stockage, puis garde à l'écriture (si un
  secret connu apparaît encore, l'écriture est refusée en ERREUR).

## 10. Posés mais non branchés en étape 1

- **Moteur de politiques** (`policy.ts`) : entrée = enveloppe + action recommandée, validée contre
  `rien`, `humain`, `pr`, `relancer_job`, `repousser_rappel` ; sortie `abstention`, `pr_preparee`
  ou `auto`. `AUTO_ALLOWED = []`, gelée. Mode `shadow` par défaut : la sortie est **toujours**
  `abstention`. Le mode `actif` n'existe que pour les tests jusqu'à la décision 3 d'Anthony
  (politique de promotion).
- **Budget d'attention** (`budget.ts`) : 7 dossiers qui sonnent par jour civil Europe/Madrid ; la
  priorité `critique` passe outre, hors quota ; au-delà, `regroupe` (consultable, jamais perdu).

## 11. Ce que l'étape 2 ajoutera

| Élément              | Contenu                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Déclencheur          | routine « analyste » sur les incidents passés à `enquete_demandee` (API `fire`, ou repli planifié)                                                                                         |
| Sortie de l'analyste | schéma fermé : hypothèse, confiance (`faible`/`moyenne`/`forte`), preuves, mécanisme, condition de vérification, action recommandée, réversibilité ; invalide ⇒ rejetée, `SORTIE_INVALIDE` |
| Enveloppe v2         | champ d'analyse et référence du dossier ; montée de version avec migration de la v1                                                                                                        |
| Transition           | `enquete_demandee` → `diagnostique` sur sortie valide (`markDiagnosed`)                                                                                                                    |
| Dossier Rappels      | `bloque` + `blockReason`, `evidenceRefs` opaques ; clé d'idempotence par incident et par enquête (jamais par ouverture) ; budget via `allocateRing`                                        |
| Mémoire              | incidents résolus vérifiés dans `memoire.json` ; 2 ou 3 comparables fournis à l'analyste                                                                                                   |
| Mesure               | `data/incidents/mesure.md` : diagnostic confirmé / abstention / faux diagnostic, durée, appels d'outils                                                                                    |
| Corrélation          | liste des PR récentes lue en REST (lecture seule)                                                                                                                                          |

## 12. Questions ouvertes

- **Fenêtre de réouverture** : une empreinte rouvre toujours le même incident, même des mois plus
  tard ; le plafond de 2 enquêtes vaut alors pour toute sa vie. Proposition : au-delà de N jours
  fermé (7 ?), une panne crée un nouvel incident.
- **Échecs d'enquête** : « 3 échecs consécutifs ⇒ `ECHEC_EXECUTION` » (étape 2) et le plafond de
  2 demandes : une enquête échouée compte-t-elle dans le plafond ?
- **Flux retiré** de la déclaration : ses incidents restent en l'état (aucune observation, aucune
  affirmation) ; les fermer à la main.
- **« Rouge, vert, rouge »** : l'incident unique finit `rouvert` si la réouverture tombe dans le
  cooldown, `enquete_demandee` sinon (seconde enquête) ; dans les deux cas 2 occurrences et au plus
  2 enquêtes.
