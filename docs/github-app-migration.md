# Migration : GitHub App au lieu du PAT

Objectif : remplacer le `FACTORY_PAT` (token personnel longue-durée) par une
**GitHub App** à tokens d'installation courts (1 h). C'est le prérequis d'une
usine autonome sûre :

- **Fin du secret longue-durée** — plus de PAT qui expire ou se retrouve en
  lecture seule par accident (l'incident du 06/07).
- **Permissions fixées une fois** au niveau de l'App, pas re-cochées par run.
- **Token frais à chaque exécution**, régénéré depuis la clé privée de l'App.
- **Débloque `claude-code-action`** : `/install-github-app` installe l'App ET
  le moteur d'exécution de la remédiation autonome (voir `docs/remediation.md`).

## Le motif (état final)

Chaque job génère un token d'installation frais en tête, puis l'utilise partout :

```yaml
- name: Generate GitHub App token
  id: app-token
  uses: actions/create-github-app-token@v1
  with:
    app-id: ${{ vars.FACTORY_APP_ID }}
    private-key: ${{ secrets.FACTORY_APP_PRIVATE_KEY }}
    owner: ${{ github.repository_owner }}

- uses: actions/checkout@v4
  with:
    token: ${{ steps.app-token.outputs.token }}
# ... et partout ailleurs :
#   GH_TOKEN: ${{ steps.app-token.outputs.token }}
```

> **Historique** : la migration s'est faite en zéro-downtime via un garde
> `if: ${{ vars.FACTORY_APP_ID != '' }}` sur le step et un fallback
> `|| secrets.FACTORY_PAT` sur chaque token — tant que l'App n'existait pas,
> l'usine retombait sur le PAT. Une fois l'App validée en production, le garde
> et le fallback ont été retirés (étape 6), rendant l'App obligatoire.

## Étapes (côté GitHub, ~10 min)

### 1. Créer la GitHub App

Settings → Developer settings → **GitHub Apps** → New GitHub App.

- **Nom** : `devops-factory-bot` (par ex.)
- **Homepage URL** : l'URL du repo (peu importe)
- **Webhook** : décocher _Active_ (pas besoin)
- **Repository permissions** — le strict nécessaire de l'usine :
  - Contents : **Read and write** (cloner, pousser, commiter)
  - Pull requests : **Read and write** (ouvrir les PRs)
  - Issues : **Read and write** (issues central-scan, gitleaksignore)
  - Workflows : **Read and write** (dispatch, mise à jour des workflows)
  - Administration : **Read** (audit de branch protection ; Write si vous voulez
    que l'usine _configure_ la protection)
  - Metadata : **Read** (obligatoire, coché d'office)
- **Where can this app be installed?** : _Only on this account_
- Créer.

### 2. Générer la clé privée

Sur la page de l'App → **Private keys** → _Generate a private key_. Un fichier
`.pem` se télécharge. Notez aussi l'**App ID** (en haut de la page).

### 3. Installer l'App sur les repos

Page de l'App → **Install App** → votre compte → _All repositories_ (ou
sélectionner les 25). C'est ce qui donne l'accès cross-repo à l'usine.

### 4. Déclarer l'App à la Factory

Dans le repo **DevOps-Factory** → Settings :

- **Secrets and variables → Actions → Variables** → New variable :
  - `FACTORY_APP_ID` = l'App ID (un nombre)
- **Secrets** → New secret :
  - `FACTORY_APP_PRIVATE_KEY` = **tout le contenu** du fichier `.pem`
    (lignes `-----BEGIN...` à `-----END...` incluses)

Dès cet instant, `central-scan.yml` (et tout workflow migré) utilise l'App.

### 5. Vérifier

Actions → **Central Security Scan** → Run workflow. Dans les logs, l'étape
_Generate GitHub App token_ doit s'exécuter (plus être skippée). Une fois le
run vert, l'App fonctionne.

### 6. Retirer le PAT — ✅ fait

Le code est nettoyé : `pat-health-check.yml` supprimé, garde
`if: FACTORY_APP_ID != ''` retiré du step App (l'App est désormais l'auth
obligatoire), et le fallback `|| secrets.FACTORY_PAT` retiré de tous les
workflows — chaque point d'auth est passé à `steps.app-token.outputs.token`
seul. **Action GitHub restante** : supprimer le secret `FACTORY_PAT` du dépôt
et révoquer le token côté GitHub (Settings → Developer settings → PAT).

## Conversion des workflows — terminée

**Tous** les workflows Factory s'authentifient via la GitHub App. Le step
`Generate GitHub App token` génère un token d'installation frais (1 h) en tête
de chaque job, et chaque point d'auth (checkout `token:`, `GH_TOKEN:`,
`GITHUB_TOKEN:`, `RENOVATE_TOKEN:`) utilise `steps.app-token.outputs.token`.

25 workflows, dont `dashboard-build.yml` qui a **deux** jobs (`build` +
`deploy-pages`) — chaque job a son propre step App, car
`steps.app-token.outputs.token` n'est résolu que dans le job qui génère le
token :

`ai-branding-guard`, `ai-test-writer`, `auto-fix-prettier`,
`branch-protection-audit`, `central-coverage`, `central-scan`,
`ci-health-check`, `claude-review`, `coverage-audit`, `daily-report`,
`dashboard-build` (×2 jobs), `dependency-intelligence`, `factory-watchdog`,
`feedback-collector`, `migration-checklist`, `migration-tracker`,
`pr-description`, `quality-score`, `redeploy-templates`, `remediation-dispatch`,
`renovate`, `scan-repos`, `self-heal`, `test-scaffold`, `weekly-veille`.

`pat-health-check.yml` (qui surveillait la validité du PAT) a été **supprimé**
en même temps que le retrait du PAT.

## Prérequis : bypass de la branche protégée

Les workflows committent l'état durable (scan, dashboard, coverage, activity
log) **directement sur `master`**, qui est protégé (status check `check`).
L'App n'étant pas admin, elle ne bypasse pas la protection par défaut : il faut
une **ruleset** (Settings → Rules → Rulesets) ciblant `master` avec
`devops-factory-bot` **et** `Repository admin` dans la _bypass list_, en
remplacement de la protection de branche classique (qui ne sait pas bypasser
une App). Sans ça, chaque push d'un workflow échoue avec
`GH006 / protected branch hook declined`.

## Note sur `claude-code-action` et la remédiation

`/install-github-app` (depuis Claude Code CLI) crée une App Claude dédiée qui
sert le même but côté exécution : la remédiation autonome. Vous pouvez soit
réutiliser une App unique, soit avoir deux Apps (une pour l'usine, une pour
Claude). `claude-code-action` accepte, en alternative à `ANTHROPIC_API_KEY`, un
token OAuth issu d'un abonnement Claude — le chemin « sans clé API ».
