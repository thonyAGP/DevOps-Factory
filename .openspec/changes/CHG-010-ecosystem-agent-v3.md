# CHG-010: Ecosystem Agent V3 - Intelligence & Portabilite

**Status**: `ARCHIVED`
**Date**: 2026-04-17
**Origine**: V2 livree (CHG-009 ARCHIVED). Toutes les bases d'automatisme sont en place. V3 vise a rendre l'agent plus intelligent, plus visible et plus portable.

## Contexte

V2 a rendu l'agent autonome (service Windows, tray, FTS5, auto-fix low-risk). V3 etend les capacites dans 3 axes :

1. **Intelligence** : plus de fixes auto, tendances, CI gate
2. **Visibilite** : dashboard temps reel, notifications multi-canal
3. **Portabilite** : multi-machine, cross-platform

## Objectif

Transformer l'Ecosystem Agent d'un **agent autonome local** en un **agent intelligent distribue** qui :

- Corrige davantage de dette technique automatiquement
- Bloque les PRs qui degradent la sante
- Affiche des tendances et historiques
- Notifie sur Slack/Discord/email en plus du tray
- Fonctionne sur plusieurs machines et sur Linux/WSL
- S'integre nativement dans le workflow Claude via MCP

## Phases (ordonnees par priorite)

| Phase     | Contenu                 | Justification priorite                                              | Effort | Status                       |
| --------- | ----------------------- | ------------------------------------------------------------------- | ------ | ---------------------------- |
| **V3-P1** | Historique & trends     | Exploite les donnees existantes, zero dep externe, valeur immediate | S      | LIVRE 2026-04-17 (`d644243`) |
| **V3-P2** | Auto-fix debt etendu    | Infra deja en place (V2-P4), etend le scope                         | S      | LIVRE 2026-04-17 (`d644243`) |
| **V3-P3** | CI gate GitHub Action   | Utilise le health score existant, impact immediat sur qualite       | M      | LIVRE 2026-04-17 (`52aea2e`) |
| **V3-P4** | MCP tools V2            | Workflow IA natif, leverage ecosysteme MCP existant                 | M      | LIVRE 2026-04-17 (`64f55ba`) |
| **V3-P5** | Notifications enrichies | Multi-canal (Slack/Discord/email), remote alerts                    | M      | LIVRE 2026-04-17 (`a920d30`) |
| **V3-P6** | Dashboard temps reel    | WebSocket, UX fluide, remplace polling SWR                          | L      | LIVRE 2026-04-17 (`ad986eb`) |
| **V3-P7** | Multi-machine sync      | Cloud sync DB, portabilite cross-PC                                 | L      | LIVRE 2026-04-17 (`ad986eb`) |
| **V3-P8** | Linux/WSL support       | Systemd service, cross-platform                                     | L      | LIVRE 2026-04-17 (`70b49a6`) |

Effort : S = small (1-2h), M = medium (2-4h), L = large (4-8h)

---

## V3-P1 : Historique & Trends

**Priorite** : 1/8 — Les donnees sont deja collectees, il suffit de les stocker dans le temps et de les visualiser.

### Requirements

- Le systeme SHALL stocker un snapshot du score sante par projet a chaque scan debt (table `health_snapshots`)
- Le systeme SHALL exposer `GET /api/trends?project=&days=30` avec les scores historiques
- Le systeme SHALL afficher un graphique d'evolution du score dans le dashboard (page `/trends`)
- Le systeme SHOULD afficher un sparkline sur la page `/projects` pour chaque projet
- Le systeme SHOULD detecter les degradations rapides (score baisse > 10 pts en 24h) et emettre une alerte

### Implementation

1. Nouvelle table `health_snapshots (project_id, score, debts_total, divergences, snapshot_at)`
2. Scheduler : apres chaque debt scan, inserer un snapshot par projet
3. Endpoint REST `GET /api/trends`
4. Page `/trends` avec graphique (chart.js ou recharts)
5. Alerte degradation dans le health polling

---

## V3-P2 : Auto-fix Debt Etendu

**Priorite** : 2/8 — L'infra auto-push existe (V2-P4), il suffit d'etendre le scope des fixes auto-approuves.

### Requirements

- Le systeme SHALL auto-approuver et pusher les fixes `any`→`unknown` (risque faible, transformation mecanique)
- Le systeme SHALL auto-approuver et pusher les fixes `console.log` suppression (hors fichiers seed/test)
- Le systeme MUST NOT auto-approuver `test.skip`→`test` (risque moyen, peut casser CI)
- Le systeme MUST NOT auto-approuver `test.only`→`test` (risque moyen, meme raison)
- Le systeme SHALL verifier que le typecheck passe avant de pusher un fix debt (`tsc --noEmit`)
- Le systeme SHALL envoyer une notification pour chaque PR debt auto-creee

### Implementation

1. Ajouter `isLowRiskDebt(fix)` dans le scheduler (filtre par type + exclusions)
2. Appeler `autoApproveAndPush('debt', isLowRiskDebt)` apres le debt-fixer scan
3. Ajouter une safety gate `typecheck` dans le push-worker pour les fixes debt
4. Exclure les fichiers seed/test/spec du auto-fix console.log

---

## V3-P3 : CI Gate (GitHub Action)

**Priorite** : 3/8 — Impose la qualite automatiquement. Utilise le health score existant.

### Requirements

- Le systeme SHALL fournir une GitHub Action reusable `ecosystem-agent/health-gate`
- L'action SHALL bloquer la PR si le score sante du projet < seuil configurable (default: 50)
- L'action SHALL afficher le score + les alertes dans un commentaire PR
- L'action SHOULD comparer le score avant/apres les changements de la PR
- L'action MUST NOT bloquer si l'API agent est inaccessible (fail-open)

### Implementation

1. Creer `.github/actions/health-gate/action.yml` dans Ecosystem-Agent
2. L'action appelle `GET /api/health?project=` sur l'agent local ou un tunnel
3. Compare score vs seuil, poste commentaire via `gh pr comment`
4. Workflow reusable pour les repos de l'ecosysteme
5. Mode tunnel : optionnel via Cloudflare Tunnel ou ngrok pour CI cloud

---

## V3-P4 : MCP Tools V2

**Priorite** : 4/8 — Permet a Claude d'interagir directement avec le systeme de fixes.

### Requirements

- Le systeme SHALL ajouter l'outil MCP `ecosystem_fix` pour approuver/rejeter/pusher des fixes depuis Claude
- Le systeme SHALL ajouter l'outil MCP `ecosystem_trends` pour consulter l'historique de sante
- Le systeme SHOULD ajouter l'outil MCP `ecosystem_auto_fix_status` pour voir l'etat des auto-pushes
- Le systeme SHALL documenter les nouveaux outils dans la description MCP

### Implementation

1. `apps/mcp/src/tools/fix.ts` : approve/reject/push via DB
2. `apps/mcp/src/tools/trends.ts` : query health_snapshots
3. Mise a jour du `register-mcp.ps1` si necessaire

---

## V3-P5 : Notifications Enrichies

**Priorite** : 5/8 — Alertes a distance quand on n'est pas devant le PC.

### Requirements

- Le systeme SHALL supporter les notifications Slack (webhook URL)
- Le systeme SHALL supporter les notifications Discord (webhook URL)
- Le systeme SHOULD supporter les notifications email (SMTP)
- Le systeme SHALL permettre de configurer les canaux dans un fichier `config/notifications.json`
- Le systeme SHALL filtrer par severite (critical only, high+, all)
- Le systeme MUST NOT envoyer plus d'une notification par heure pour le meme type d'alerte (anti-spam)

### Implementation

1. Creer `apps/daemon/src/notifier.ts` avec interface pluggable
2. Adaptateurs : Slack webhook, Discord webhook, SMTP (nodemailer)
3. Config `config/notifications.json` avec canaux + filtres
4. Appeler notifier depuis scheduler (apres alertes critiques + auto-pushes)
5. Anti-spam : cooldown par type d'alerte (Map<string, timestamp>)

---

## V3-P6 : Dashboard Temps Reel

**Priorite** : 6/8 — Amelioration UX, remplace le polling SWR 30s.

### Requirements

- Le systeme SHALL utiliser WebSocket (ou SSE) pour pousser les mises a jour en temps reel
- Le systeme SHALL notifier le dashboard a chaque fin de scan
- Le systeme SHOULD afficher un indicateur "scan en cours" en direct
- Le systeme SHOULD conserver le fallback polling pour les clients deconnectes

### Implementation

1. Ajouter `@fastify/websocket` au serveur
2. Route `/ws` avec broadcast des evenements scan
3. Hook dans le scheduler : emettre un evenement apres chaque scan
4. Cote client : `useWebSocket` hook + fallback SWR
5. Indicateur visuel "scanning..." pendant les scans actifs

---

## V3-P7 : Multi-Machine Sync

**Priorite** : 7/8 — Complexe, necessaire seulement si multi-PC.

### Requirements

- Le systeme SHALL synchroniser la base SQLite entre machines via stockage cloud (OneDrive/S3)
- Le systeme SHALL gerer les conflits de merge SQLite (last-write-wins ou CRDT simplifie)
- Le systeme SHOULD supporter un mode read-only sur les machines secondaires
- Le systeme MUST NOT perdre de donnees lors de la synchronisation

### Implementation

1. Export/import periodique du DB vers un dump JSON compresse
2. Stockage sur OneDrive (dossier sync existant `~/OneDrive/claude-config/`)
3. Au boot : comparer timestamps, merger si necessaire
4. Alternative : SQLite WAL + rsync, ou Litestream replication vers S3

---

## V3-P8 : Linux/WSL Support

**Priorite** : 8/8 — Portabilite future, pas urgent tant que Windows est la plateforme principale.

### Requirements

- Le systeme SHALL fournir un service systemd equivalent au service Windows
- Le systeme SHALL detecter la plateforme et utiliser le bon service manager
- Le systeme SHOULD supporter WSL2 (acceder aux projets Windows depuis WSL)
- Le systeme SHOULD adapter le tray (libnotify/notify-send au lieu de NotifyIcon)

### Implementation

1. `scripts/install-service-linux.sh` avec fichier `.service` systemd
2. Detection plateforme dans `install.ps1` → routage vers le bon installateur
3. WSL : monter `/mnt/d/Projects` comme root
4. Notifications : `notify-send` ou `dbus` pour Linux desktop

---

## Decisions

| #   | Question                | Decision                                                                  | Justification                                                  |
| --- | ----------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | Ordre des phases        | Par valeur/effort : trends → debt → CI → MCP → notifs → WS → sync → linux | Maximiser le ROI, les premieres phases exploitent l'existant   |
| 2   | Auto-fix debt scope     | `any`→`unknown` + `console.log` (hors seed/test) uniquement               | Transformations mecaniques sans risque de casse                |
| 3   | CI gate fail mode       | Fail-open si agent inaccessible                                           | Ne pas bloquer le dev si l'agent est down                      |
| 4   | Notifications anti-spam | 1 notification/heure/type max                                             | Eviter les floods en boucle                                    |
| 5   | Multi-machine strategy  | JSON export/import via OneDrive                                           | Plus simple que Litestream, fonctionne deja pour claude-config |

---

## Dependencies entre phases

```
V3-P1 (Trends) ──────────┐
                          ├──→ V3-P4 (MCP V2) : ecosystem_trends utilise P1
V3-P2 (Auto-fix debt) ───┘

V3-P1 (Trends) ──────────→ V3-P3 (CI Gate) : score historique pour delta

V3-P5 (Notifications) ───→ V3-P2 (Auto-fix) : notifie les auto-pushes debt

V3-P6 (Dashboard WS) : independant
V3-P7 (Multi-machine) : independant
V3-P8 (Linux) : independant
```

P1 et P2 sont independants et peuvent etre faits en parallele.
P3 et P4 beneficient de P1 (trends data).
P5 beneficie de P2 (plus de notifications a envoyer).
P6, P7, P8 sont independants du reste.
