# Changement — watchdog des pannes silencieuses (chantier 1 de l'inventaire du 08/10)

- **Date** : 2026-10-08 · **Niveau de risque** : élevé
- **Critères déclenchés** :
  - (c) Secrets : un jeton de bot Telegram (et, en option, deux secrets de cron Vercel) entrent dans les secrets GitHub de DevOps-Factory.
  - (f) Blast radius : le canal d'alerte devient le point unique où Anthony apprend qu'une sauvegarde, une routine ou une app est muette ; s'il ment, tout le parc ment.
  - (g) Observabilité : c'est précisément la zone aveugle (63 jours sans sauvegarde en été ; 44 jours sans push depuis le 26/08 ; routine FincaScout en échec 4 matins).
- **Domaines sensibles** : securite (secrets), observation
- **Contre-revue** : faite en protocole aveugle le 08/10 (`claude-dev-config/.consult/2026-10-08-inventaire-manuel/`, section E.1 de `reply2.md`) : watchdog indépendant de la chaîne surveillée, fichier déclaratif, seuil, état persistant anti-boucle, alerte sur absence de succès ET sur push distant manquant.

## 1. Intention

- **Besoin** : être prévenu quand un flux critique N'A PAS produit son résultat attendu, pas seulement quand il échoue bruyamment. Aujourd'hui chaque flux ne sait alerter que s'il tourne ; un flux qui ne tourne pas est muet.
- **Succès observable** (dans 3 mois) : aucune panne de plus de 26 h sur un flux déclaré n'est découverte par hasard ; chaque panne a laissé un message Telegram daté ; les retours à la normale aussi.
- **Non-objectifs** : pas de plateforme d'observabilité, pas de réparation automatique (chantier suivant), pas de transformation des 200 issues GitHub en alertes, pas de modification des flux surveillés (on les observe de l'extérieur), pas de dashboard.

## 2. Carte d'impact et invariants

**Direct** (DevOps-Factory) :

- `scripts/silence-watchdog.ts` (nouveau, sans dépendance réseau autre que `fetch`), `scripts/silence-watchdog.test.ts`
- `data/silence-watchdog.json` (déclaration des flux), `data/silence-watchdog-state.json` (état persistant, commité par le workflow)
- `.github/workflows/silence-watchdog.yml` (toutes les 6 h + dispatch)
- `package.json` (script `silence-watchdog`)
- Secrets GitHub : `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (+ option `CASASYNC_CRON_SECRET`, `LB2I_CRON_SECRET`)

**Indirect** : le bot Telegram db-backups reçoit une seconde source de messages (préfixe distinct `🕯 Silence`). Aucun flux surveillé n'est modifié.

**Ce que le changement fait REMONTER** : dès le premier run, 2 à 3 alertes réelles (push db-backups cassé depuis le 26/08, Renovate et Branding Guard rouges). C'est voulu ; ce ne sont pas des régressions.

**Flux déclarés en v1** (observables sans secret applicatif) :

| Flux                                 | Preuve de vie                                                                               | Source              | Seuil                |
| ------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------- | -------------------- |
| db-backups, copie distante           | dernier commit `chore(dumps): backup` sur `main`                                            | GitHub API commits  | 26 h                 |
| FincaScout, routine quotidienne      | date en tête de `docs/JOURNAL.md` sur `main`                                                | GitHub API contents | 30 h                 |
| DevOps-Factory, workflows chroniques | conclusion des 3 derniers runs de `renovate.yml`, `ai-branding-guard.yml`, `factory-ci.yml` | GitHub API runs     | 3 échecs consécutifs |
| Boxmail, serveur                     | `GET https://boxmail.lb2i.com/health` = 200 `status:ok`                                     | HTTPS               | 2 échecs consécutifs |
| Ecosystem-Agent, file de correctifs  | _v2_ : nécessite un endpoint distant, hors v1                                               | —                   | —                    |

**Flux en v1b** (un secret de cron chacun, à fournir par Anthony) :

| Flux                | Preuve de vie                                                                          | Source                  |
| ------------------- | -------------------------------------------------------------------------------------- | ----------------------- |
| CasaSync, crons     | `GET /api/cron/deadman` avec `x-cron-secret` : fraîcheur du heartbeat `scenarios-tick` | app-casasync.vercel.app |
| LB2I, secrétaire IA | `GET /api/cron/inbox-health-check` avec `Bearer CRON_SECRET`                           | app.lb2i.com            |

Constaté le 08/10 : `app.lb2i.com/api/health` redirige vers la connexion et `app-casasync.vercel.app/api/health/integrations` répond `unauthenticated` ; il n'existe donc aucune preuve de vie publique pour ces deux apps.

**Invariants** (en condition, avec cas positif au plan de preuve) :

1. Une alerte « silence » part seulement après que le seuil est dépassé ET qu'aucune alerte n'est déjà ouverte pour ce flux (état persistant). Cas positif : un flux muet 27 h déclenche exactement une alerte.
2. Un message « retour à la normale » part seulement si une alerte était ouverte. Cas positif : flux redevenu frais → un message, puis silence.
3. Le watchdog rend un code de sortie non nul seulement si lui-même n'a pas pu contrôler (API GitHub injoignable, Telegram refusé) ; un flux en panne ne fait pas échouer le workflow. Cas positif : Telegram 401 → run rouge visible dans Actions.
4. ~~Récapitulatif quotidien~~ **Révisé le 08/10 soir (Anthony : « un message tous les jours pour dire que ça marche, c'est du spam »)** : aucun message n'est envoyé quand tout va bien. Le témoin de vie du watchdog est un cliquet externe : après chaque run, GET sur `HEALTHCHECK_PING_URL` (healthchecks.io), `/fail` si le run n'a pas pu contrôler ou notifier ; le service alerte sur Telegram seulement si aucun ping n'arrive dans la période (6 h + grâce). Cas positif : 4 runs sains d'affilée → 4 pings, 0 message Telegram. Un ping impossible ne change pas le code de sortie (l'absence de ping est exactement ce que le cliquet détecte).
5. Le jeton Telegram n'apparaît jamais dans les logs ni dans un fichier commité. Cas positif : un dry-run affiche `token: ****`.

## 3. Inconnues et hypothèses

- Le bot Telegram de db-backups (chat `1863955375`, jeton chiffré DPAPI dans `DB-Backups/config/notifications.json`) peut-il être réutilisé ? Décision d'Anthony : réutiliser (je déchiffre localement et pose le secret GitHub) ou créer un bot dédié.
- Les commits du workflow (état persistant) dans DevOps-Factory : le dépôt reçoit déjà des commits de bots ; même mécanique que `factory-watchdog.yml` (rebase, puis reset sur origin en dernier recours). Hypothèse : pas de conflit sur un fichier que seul ce workflow écrit.
- La routine FincaScout écrit bien la date en tête de `JOURNAL.md` à chaque passage (prompt étape 8) : à confirmer par le run du 09/10 06:40.
- Quota API GitHub : ~10 appels par run, 4 runs/jour, négligeable.

## 4. Décision

Options réelles pour l'hébergement :

- (A) **GitHub Actions dans DevOps-Factory** — indépendant du PC et de la VM, gratuit, déjà outillé (App token, `factory-watchdog.yml` comme modèle), projet maître « CI / maintenance multi-repos » selon la cartographie. Faiblesse : DevOps-Factory est lui-même bruyant ; parade = script autonome sans dépendance au reste du dépôt, et invariant 4.
- (B) Routine Cowork toutes les 6 h — indépendante aussi, mais consomme le forfait pour un contrôle mécanique, et ne peut pas committer un état sans dépôt attaché.
- (C) Cron sur la VM Oracle — surveille Boxmail depuis Boxmail (dépendance circulaire), accès ssh requis.
- (D) healthchecks.io — excellent dead-man, mais exige de modifier chaque flux pour qu'il « pinge », ce que le non-objectif exclut.

**Décision : (A)**, avec (D) en candidat v2 pour le dead-man du watchdog lui-même si l'invariant 4 s'avère insuffisant.

## 5. Plan de preuve

- Unitaire (`vitest`) : fraîcheur calculée depuis une date ISO ; transitions d'état (ouverte → fermée, pas de doublon, retour à la normale) ; « 3 échecs consécutifs » ; masquage du jeton. Un cas par invariant, dont le cas positif.
- Intégration (`--dry-run` en local, sans Telegram) : le script lit GitHub réellement et imprime le verdict des 4 flux v1 ; attendu au 08/10 : db-backups SILENCE (44 j), FincaScout SILENCE ou OK selon le run du jour, workflows ROUGE ×2, Boxmail OK.
- Bout en bout : `workflow_dispatch` → message Telegram reçu (capture ou texte collé) → second dispatch immédiat → aucun doublon (état commité) ; simulation d'un retour à la normale en forçant le seuil à 10 000 h → message « retour à la normale ».
- Non-régression DevOps-Factory : `pnpm typecheck`, `pnpm test`, `pnpm lint` inchangés en vert sur le périmètre touché.
- Secrets : `gh secret list` montre les noms ; aucun jeton dans `git diff` ni dans les logs du run.

## 6. Preuves exécutées (08/10/2026, 20:55 → 21:05 Madrid)

- **Unitaire** : `pnpm vitest run scripts/silence-watchdog.test.ts` → 23 passed (rejoué par le pilote après l'agent). Suite complète : 937 tests verts, 13 ignorés. `pnpm typecheck` exit 0 ; eslint 0 erreur sur les fichiers ajoutés.
- **Dry-run local** (`GH_TOKEN` utilisateur, jeton Telegram factice) : `[SILENCE] db-backups 44 j · [OK] fincascout-routine 19 h · [ROUGE] renovate.yml et ai-branding-guard.yml 3 échecs consécutifs · [OK] boxmail-server HTTP 200` ; `token: ****` ; aucun fichier d'état créé.
- **Dry-run GitHub Actions** (run 37828257333, success) : jeton de l'App généré pour `DevOps-Factory,db-backups,FincaScout` (donc l'App est installée sur les trois) ; même verdict qu'en local.
- **Run réel n°1** (run 37828335860, success) : 3 messages `envoyé` (SILENCE db-backups, ROUGE workflows, récap du 08/10) ; `data/silence-watchdog-state.json` commité et poussé (`af68d5ab2`).
- **Run réel n°2 immédiat** (run 37829057882, success) : mêmes verdicts, **zéro ligne `envoyé`** (invariant 1 : pas de doublon, état relu) ; état recommité (`290c4f6df`, horodatages).
- **Secrets** : `gh secret list` → `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` posés 18:49 UTC ; aucun jeton dans le diff ni dans les logs des runs.
- **Diff ↔ carte** : conforme. 5 fichiers de la carte + ce change.md. Écart assumé : `scripts/silence-watchdog.ts` fait ~470 lignes (limite maison 250), non découpé pour rester dans la carte.
- **Non prouvé ce soir** : le message « retour à la normale » (invariant 2) et le cas « Telegram refuse » (invariant 3) ne sont couverts que par les tests unitaires, pas par un run réel. À observer au premier flux qui se rétablit (db-backups, chantier suivant).
- **Observation** : chaque run commite l'état (horodatage `lastCheckedAt`) → 4 commits/jour sur master. Acceptable ; si gênant, ne committer que sur changement de verdict.

## 7. Mise en service et observation

- Mise en service : merge sur `master`, premier run par dispatch, puis cadence 6 h. Rollback : désactiver le workflow (`gh workflow disable`), supprimer les secrets.
- Signaux à observer sur 2 semaines : nombre d'alertes/jour (cible < 1 hors panne réelle), faux positifs (flux frais signalé muet), absence du récapitulatif 07:00.
- Suite prévue (chantier 2 de l'ordre révisé) : agent qui diagnostique et propose une PR pour ce qui est rouge N jours de suite.
