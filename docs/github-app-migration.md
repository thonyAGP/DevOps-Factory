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

## Ce qui est déjà prêt (zéro-downtime)

Les workflows migrés utilisent ce motif : un token d'App est généré **si** la
variable de dépôt `FACTORY_APP_ID` est définie, sinon on retombe sur le PAT.
Tant que vous n'avez pas créé l'App, **rien ne change** ; dès que la variable
et le secret existent, l'usine bascule automatiquement sur l'App.

```yaml
- name: Generate GitHub App token
  id: app-token
  if: ${{ vars.FACTORY_APP_ID != '' }}
  uses: actions/create-github-app-token@v1
  with:
    app-id: ${{ vars.FACTORY_APP_ID }}
    private-key: ${{ secrets.FACTORY_APP_PRIVATE_KEY }}
    owner: ${{ github.repository_owner }}

- uses: actions/checkout@v4
  with:
    token: ${{ steps.app-token.outputs.token || secrets.FACTORY_PAT }}
# ... et partout ailleurs :
#   GH_TOKEN: ${{ steps.app-token.outputs.token || secrets.FACTORY_PAT }}
```

`central-scan.yml` est déjà converti comme **référence**. Les autres workflows
Factory (`dashboard-build`, `ci-health-check`, `self-heal`, `central-coverage`,
`renovate`, `remediation-dispatch`, `pr-description`, `claude-review`,
`migration-checklist`, `ai-test-writer`, `auto-generate-tests`) se convertissent
en appliquant le même bloc — voir la checklist plus bas.

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

### 6. Retirer le PAT (quand tout est migré)

Une fois **tous** les workflows convertis et validés, supprimez le secret
`FACTORY_PAT` et révoquez le token côté GitHub. Le fallback `|| secrets.FACTORY_PAT`
devient inutile ; on pourra le retirer dans une passe de nettoyage.

## Conversion des workflows — terminée

**Tous** les workflows Factory qui s'authentifiaient au PAT sont convertis au
motif zéro-downtime. Recette appliquée à chaque job utilisant le PAT : un step
`Generate GitHub App token` en tête, puis `secrets.FACTORY_PAT` remplacé par
`steps.app-token.outputs.token || secrets.FACTORY_PAT` (checkout `token:` et
tous les `GH_TOKEN:` / `GITHUB_TOKEN:` / `RENOVATE_TOKEN:`).

25 workflows convertis, dont `dashboard-build.yml` qui a **deux** jobs
(`build` + `deploy-pages`) — chaque job a son propre step App, car
`steps.app-token.outputs.token` n'est résolu que dans le job qui génère le
token :

`ai-branding-guard`, `ai-test-writer`, `auto-fix-prettier`,
`branch-protection-audit`, `central-coverage`, `central-scan` (référence),
`ci-health-check`, `claude-review`, `coverage-audit`, `daily-report`,
`dashboard-build` (×2 jobs), `dependency-intelligence`, `factory-watchdog`,
`feedback-collector`, `migration-checklist`, `migration-tracker`,
`pr-description`, `quality-score`, `redeploy-templates`, `remediation-dispatch`,
`renovate`, `scan-repos`, `self-heal`, `test-scaffold`, `weekly-veille`.

### Seule exception : `pat-health-check.yml`

Ce workflow **reste volontairement sur le PAT** : son rôle est précisément de
tester la validité du PAT (fallback). Il devient obsolète le jour où le PAT est
retiré (étape 6) — on le supprimera dans la passe de nettoyage, en même temps
que le fallback `|| secrets.FACTORY_PAT`.

## Note sur `claude-code-action` et la remédiation

`/install-github-app` (depuis Claude Code CLI) crée une App Claude dédiée qui
sert le même but côté exécution : la remédiation autonome. Vous pouvez soit
réutiliser une App unique, soit avoir deux Apps (une pour l'usine, une pour
Claude). `claude-code-action` accepte, en alternative à `ANTHROPIC_API_KEY`, un
token OAuth issu d'un abonnement Claude — le chemin « sans clé API ».
