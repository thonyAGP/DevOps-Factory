# CHG-012: Plan de contrôle d'incidents — étage déterministe, analyste en shadow mode

**Status**: `IMPLEMENTING` (étape 1 livrée le 11/10, étape 2 à lancer)
**Date**: 2026-10-11
**Origine**: Analyse `DevOps/Platform/ANALYSE-GESTION-IA-2026-10-11.md` (§4 plan de contrôle, §5 ordre, §6 décisions), contre-revue ChatGPT `Platform/.consult/2026-10-11-analyste-incidents/synthese.md` (« d'accord avec réserves »). Décision d'Anthony du 11/10 12:1x : « Oui, principe + shadow mode d'abord ». Doctrine `rules/assistance-proactive.md` règles 1 (diagnostiquer avant de notifier), 2 (préparer avant de demander), 5 (événement plutôt que temps), 7 (jamais d'échec silencieux).
**Chantier**: watchdog `silence-watchdog.yml` et ses scripts ; contrat `docs/contrats/incident-envelope.md` ; routine « analyste d'incidents » (`docs/routines/analyste.md`, source versionnée comme `reparateur.md`) ; Rappels (contrat dossier d'action v1, `Boxmail/rappels/CONTRAT-DOSSIER-ACTION.md`).

## Contexte

Le watchdog (toutes les 6 h) sonne des alertes nues (« db-backups rouge depuis … ») ; le réparateur ne couvre que DevOps-Factory, le lundi. Anthony découvre encore les pannes lui-même (WhatsApp CasaSync non parti, 11/10 ; couple-quest en échec chaque nuit depuis le 28/09 sans alerte, découvert le 11/10). ORCA-Bench (2026) : 10 % de causes trouvées sur les incidents difficiles ⇒ un diagnostic de modèle est une hypothèse, jamais une vérité. Contre-revue : sans étage déterministe avant le modèle, un dossier par alerte/réouverture donne sept dossiers sophistiqués mais inutiles par jour (mode d'échec Ecosystem-Agent transposé aux incidents).

## Objectif

Chaque incident confirmé arrive à Anthony déjà analysé (hypothèse, confiance, preuves) dans un dossier d'action Rappels, un seul geste. En shadow mode : aucune PR, aucune action ; la mesure sur plusieurs dizaines d'incidents décide de l'étape 3 (PR préparées).

## Périmètre

Étapes 1 (plan de contrôle) et 2 (shadow mode) du §5 de l'analyse. Étapes 3 à 7 (PR, diagnostics Vercel, producteurs CasaSync/Boxmail, autonomie déterministe, backlog) : hors périmètre, CHG ultérieurs après la mesure.

## Requirements — étape 1 : plan de contrôle (déterministe, dans le watchdog)

- Le watchdog SHALL normaliser chaque alerte (silence d'un flux, sonde, cliquet healthchecks, échec signalé par un producteur) en une `IncidentEnvelope` typée, schéma JSON fermé et versionné : source, flux, empreinte, première et dernière occurrence, nombre d'occurrences, impact, priorité, état, `causedBy` / `incidentRootId`, et des champs **non fiables** (extraits de journaux) séparés et marqués comme données.
- Le watchdog SHALL calculer une **empreinte logique de panne** (flux + classe de symptôme) qui survit aux réouvertures ; une alerte dont l'empreinte est déjà ouverte SHALL devenir une occurrence de l'incident existant, et MUST NOT créer un nouvel incident.
- Le cycle de vie SHALL être fermé : `ouvert → enquete_demandee → diagnostique → ferme`, avec `rouvert` et un cooldown configurable par flux ; le watchdog MUST NOT demander plus de 2 enquêtes par incident (plafond `maxInvestigationsPerIncident`) ni redemander pendant le cooldown.
- Un incident survenu dans les 24 h après une PR du réparateur ou de l'analyste sur le même dépôt SHALL être rattaché à son incident racine (`causedBy`, `incidentRootId`).
- La décision « enquête nécessaire ? » SHALL être déterministe et journalisée : incident nouveau ou rouvert après cooldown, priorité au-dessus du seuil, aucune enquête en cours.
- Un **moteur de politiques** SHALL exister comme module déterministe avec `AUTO_ALLOWED = []` ; toute action recommandée par l'analyste SHALL passer par lui ; en shadow mode il SHALL toujours répondre `abstention`.
- L'état SHALL vivre dans `data/incidents/` (JSON versionnés par le watchdog, comme l'état actuel) et MUST NOT contenir de secret.
- Un `OPERATIONS.md` SHALL exister à la racine de DevOps-Factory, Boxmail et LB2I-Fiscal Manager : comment tester, reproduire, où sont les journaux, commandes sûres, commandes interdites.
- Le budget d'attention SHALL plafonner à 7 par jour les dossiers qui **sonnent** ; une sévérité critique passe outre ; les autres sont regroupés ou consultables, jamais perdus.

## Requirements — étape 2 : analyste en shadow mode

- Le watchdog SHALL déclencher la routine « analyste » par événement (déclencheur API des routines : `POST https://api.anthropic.com/v1/claude_code/routines/{id}/fire`, en-tête beta `experimental-cc-routine-2026-04-01`) quand « enquête nécessaire » ; repli : planification aux heures du watchdog, sortie immédiate s'il n'y a aucun incident `enquete_demandee`. **À vérifier avant l'étape 2** : la nature du jeton Bearer attendu par ce déclencheur ; si c'est une clé API Anthropic côté serveur (contraire à la doctrine), le repli planifié s'applique.
- La routine SHALL tourner en **contexte neuf par incident**, dépôt concerné attaché, outils bornés (lecture, `gh` REST en lecture), sans secret de production ; elle MUST NOT ouvrir de PR ni écrire sur GitHub en shadow mode.
- La routine SHALL produire une sortie validée contre un schéma fermé : hypothèse, confiance (`faible` / `moyenne` / `forte`), preuves (références), mécanisme supposé, condition de vérification, action recommandée (classe), réversibilité. Une sortie invalide SHALL être rejetée et journalisée.
- La routine SHALL recevoir les 2 ou 3 incidents résolus comparables (même empreinte ou même flux) depuis la mémoire structurée `data/incidents/memoire.json` ; aucun texte de journal MUST NOT lui parvenir comme instruction (champs typés marqués non fiables).
- Le dossier Rappels SHALL être écrit en `bloque`, `blockReason` d'un code existant du contrat v1 (sinon v1.1 : `ENQUETE_SANS_ACTION`, `SORTIE_INVALIDE`), avec diagnostic borné et `evidenceRefs`, via un jeton Rappels `devops-factory` (create/read/cancel) créé par `admin.js` sur la VM.
- Chaque enquête SHALL être mesurée dans `data/incidents/mesure.md` : diagnostic confirmé / abstention / faux diagnostic (saisi à la clôture), durée, nombre d'appels d'outils ; après 3 échecs consécutifs d'enquête sur un incident, le dossier SHALL porter `ECHEC_EXECUTION` et plus aucune enquête n'est demandée.

### Scénarios

- GIVEN le flux `db-backups` rouge, WHEN le watchdog passe, THEN une `IncidentEnvelope` est créée (empreinte `db-backups:silence`), une enquête est demandée une fois, et un second passage rouge ajoute une occurrence sans nouvelle enquête.
- GIVEN une panne qui oscille (rouge, vert, rouge en 24 h), WHEN le watchdog passe trois fois, THEN un seul incident existe, à l'état `rouvert`, avec 2 occurrences et au plus 2 enquêtes.
- GIVEN un incident enquêté en shadow mode, WHEN la routine termine, THEN un rappel Rappels `bloque` existe avec diagnostic, confiance et preuves, et aucune PR n'a été ouverte.
- GIVEN une sortie de routine hors schéma, WHEN le watchdog l'ingère, THEN elle est rejetée, journalisée, et le dossier reste `bloque` avec la raison `SORTIE_INVALIDE`.
- GIVEN huit incidents de priorité basse le même jour, WHEN les dossiers sont créés, THEN au plus sept sonnent et le huitième est regroupé ; GIVEN un neuvième de sévérité critique, THEN il sonne malgré le quota.

## Impact

- DevOps-Factory : nouveau module d'incidents (empreinte, cycle de vie, corrélation, budget) et moteur de politiques dans les scripts du watchdog (+ tests Vitest), `.github/workflows/silence-watchdog.yml`, `data/incidents/`, `docs/contrats/incident-envelope.md`, `docs/routines/analyste.md`, `OPERATIONS.md`. Secrets : jeton Rappels `devops-factory` ; jeton du déclencheur de routine (à qualifier).
- Boxmail, LB2I-Fiscal Manager : `OPERATIONS.md` seulement.
- Rappels : jeton `devops-factory` ; contrat v1.1 si les deux codes manquent.
- Routines claude.ai : « DevOps-Factory - analyste d'incidents », créée désactivée, connecteurs retirés (`clear_mcp_connections`), outils bornés (`disallowed_tools`).

## Acceptance

- [x] Étape 1 (11/10, agent puis pilote) : `pnpm typecheck` 0, `pnpm lint` 0 erreur (105 avertissements préexistants inchangés, fichiers touchés à 0/0), `pnpm test` 47 fichiers / 1063 tests (+10 fichiers, +109 tests : empreinte, occurrences, réouverture, cooldown, `causedBy`, budget, politique = abstention, store atomique, bout en bout), mutation 17/17 tuées, prettier OK ; dry-run réel : 2 incidents calculés (`devops-factory-workflows:echec_workflow` enquête demandée, `lb2i-pulse:secret_absent` sous le seuil), rien écrit, rien déclenché. RESTE : premier run réel après merge (ligne `[incidents] data/incidents/incidents.json écrit` + commit de `data/incidents/`).
- [x] `OPERATIONS.md` présents dans les trois dépôts (Boxmail c0ca611, LB2I-Fiscal Manager a42a061, DevOps-Factory : cette PR), ≤ 120 lignes, aucun secret, prettier OK.
- [ ] Étape 2 : routine créée désactivée, premier incident réel enquêté à la main, dossier `bloque` visible dans Rappels (lister_rappels), ligne 1 de `mesure.md`.
- [ ] Après au moins 20 incidents enquêtés : tableau de mesure présenté à Anthony → décision étape 3.

## Choix du pilote à appliquer à l'étape 2 (questions ouvertes du contrat, §12)

- Fenêtre de réouverture : une empreinte fermée depuis plus de 7 jours repart avec un compteur d'enquêtes à zéro (le plafond de 2 vaut par épisode, pas pour la vie de l'empreinte).
- Une enquête échouée compte dans le plafond (évite les boucles) ; après 3 échecs consécutifs : `ECHEC_EXECUTION`.
- Un incident dont le flux a disparu de la déclaration est fermé au chargement avec le motif `flux_retire`.

## Décisions pour Anthony (restantes, §6 de l'analyse)

- (3) Politique d'abstention/promotion : quelles preuves font passer une hypothèse en PR, quelles remédiations pré-écrites entrent dans `AUTO_ALLOWED` — à écrire ensemble à la fin de l'étape 1, puis figée.
- (4) Vercel Agent comme spécialiste de LB2I et CasaSync (enquêtes incluses, actions sur approbation).
- (5) Budget : 7 interruptions par jour (appliqué par défaut en attendant).
