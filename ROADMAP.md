# DevOps-Factory - Roadmap 4 Semaines

> **Objectif** : Passer de 40/100 à 85+/100 de score santé moyen
> **Période** : 4 semaines (Mars 2026)
> **Impact** : 26 projets surveillés

---

## 📊 État Actuel vs Cible

| Métrique                 | Actuel | Semaine 1 | Semaine 2 | Semaine 3 | Semaine 4 |
| ------------------------ | ------ | --------- | --------- | --------- | --------- |
| **Score santé moyen**    | 40/100 | 60/100    | 70/100    | 80/100    | 85+/100   |
| **Requêtes GitHub/jour** | 417    | 125       | 100       | 80        | 60        |
| **Coverage tracking**    | 0/26   | 0/26      | 4/26      | 4/26      | 4/26      |
| **Secret scanning**      | 0/26   | 26/26     | 26/26     | 26/26     | 26/26     |
| **Branch protection**    | 0/26   | 0/26      | 26/26     | 26/26     | 26/26     |
| **Performance tracking** | 0/7    | 0/7       | 0/7       | 7/7       | 7/7       |
| **Type coverage**        | 0/26   | 0/26      | 0/26      | 20/26     | 20/26     |
| **Releases auto**        | 0/26   | 0/26      | 0/26      | 0/26      | 26/26     |

---

## 🗓️ Semaine 1 : Fondations (Optimisation + Sécurité)

**Dates** : Semaine du 10 mars 2026
**Effort total** : 3h
**Impact** : -70% consommation API, sécurité de base sur tous les projets

### Actions

#### 1.1 Optimisation Rate Limit (1h30)

**Fichiers à modifier** :

- `scripts/scan-and-configure.ts`
- `scripts/build-dashboard.ts`
- Nouveau : `scripts/cache-manager.ts`

**Changements** :

```typescript
// scripts/cache-manager.ts (NOUVEAU)
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const CACHE_DIR = 'data/cache';
const CACHE_TTL_MS = 3600000; // 1 heure

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export const getCached = <T>(key: string): T | null => {
  const path = join(CACHE_DIR, `${key}.json`);
  if (!existsSync(path)) return null;

  const entry: CacheEntry<T> = JSON.parse(readFileSync(path, 'utf-8'));
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) return null;

  return entry.data;
};

export const setCache = <T>(key: string, data: T): void => {
  const path = join(CACHE_DIR, `${key}.json`);
  const entry: CacheEntry<T> = { data, timestamp: Date.now() };
  writeFileSync(path, JSON.stringify(entry));
};
```

**Filtrage repos inactifs** :

```typescript
// scripts/scan-and-configure.ts
const INACTIVE_THRESHOLD_DAYS = 90;

const isRepoActive = (repo: Repo): boolean => {
  const lastPush = gh(`api repos/${repo.full_name} --jq .pushed_at`);
  const daysSinceLastPush = (Date.now() - new Date(lastPush).getTime()) / 86400000;
  return daysSinceLastPush < INACTIVE_THRESHOLD_DAYS;
};

const listRepos = (): Repo[] => {
  const cached = getCached<Repo[]>('repos-list');
  if (cached) return cached;

  const repos = ghJson<Repo[]>('...');
  const active = repos.filter((r) => !r.archived && !r.fork && isRepoActive(r));

  setCache('repos-list', active);
  return active;
};
```

**Réduire fréquence crons** :

```yaml
# .github/workflows/scan-repos.yml
on:
  schedule:
    - cron: '0 */12 * * *' # Était: */6 → Maintenant: */12
```

**KPIs attendus** :

- ✅ Cache hit rate >60%
- ✅ Requêtes/jour : 417 → 125 (-70%)
- ✅ Repos scannés : 26 → ~15 (actifs uniquement)

#### 1.2 Sécurité de Base (1h30)

**Commandes** :

```bash
cd DevOps-Factory

# 1. Gitleaks (secret scanning)
pnpm cross-update -- \
  --template templates/gitleaks.yml \
  --target .github/workflows/gitleaks.yml \
  --all-repos \
  --pr-title "chore: add secret scanning with Gitleaks" \
  --pr-body "Adds automatic secret detection on every push and PR."

# 2. Renovate (dependency updates)
pnpm cross-update -- \
  --template templates/renovate.json \
  --target renovate.json \
  --all-repos \
  --pr-title "chore: add automated dependency updates" \
  --pr-body "Configures Renovate for automatic, grouped dependency PRs."

# 3. Semgrep (SAST)
pnpm cross-update -- \
  --template templates/semgrep.yml \
  --target .github/workflows/semgrep.yml \
  --all-repos \
  --pr-title "chore: add SAST with Semgrep" \
  --pr-body "Adds static analysis for security, bugs, and anti-patterns."
```

**Validation** :

```bash
# Vérifier que toutes les PRs sont créées
gh pr list --repo thonyAGP/CasaSync --search "author:app/github-actions"
gh pr list --repo thonyAGP/au-marais --search "author:app/github-actions"
# ... pour chaque repo

# Merger toutes les PRs (après review)
pnpm cross-update -- --merge-all
```

**KPIs attendus** :

- ✅ 26 repos avec Gitleaks
- ✅ 26 repos avec Renovate
- ✅ 26 repos avec Semgrep
- ✅ Aucun secret détecté (ou issues créées si détectés)

### Livrables Semaine 1

- [ ] `scripts/cache-manager.ts` créé et testé
- [ ] Repos inactifs filtrés (liste dans `data/active-repos.json`)
- [ ] Crons modifiés (6h → 12h)
- [ ] 78 PRs créées (26 repos × 3 templates)
- [ ] 78 PRs reviewées et mergées
- [ ] Dashboard mis à jour avec nouveaux scores
- [ ] Score santé moyen : 40 → **60/100** ✅

---

## 🗓️ Semaine 2 : Qualité (Coverage + Protection)

**Dates** : Semaine du 17 mars 2026
**Effort total** : 2h
**Impact** : Coverage tracking actif, branches protégées

### Actions

#### 2.1 Coverage Tracking (1h)

**Projets prioritaires** (score actuel 55/100) :

1. CasaSync
2. Email_Assistant
3. au-marais
4. livret-au-marais

**Commandes** :

```bash
cd DevOps-Factory

# Déployer coverage-tracking.yml
pnpm cross-update -- \
  --template templates/coverage-tracking.yml \
  --target .github/workflows/coverage-tracking.yml \
  --repos "CasaSync,Email_Assistant,au-marais,livret-au-marais" \
  --pr-title "feat: add test coverage tracking" \
  --pr-body "Tracks test coverage over time and prevents regressions."

# Pour chaque projet, ajouter aussi vitest config si manquant
for repo in CasaSync Email_Assistant au-marais livret-au-marais; do
  gh repo clone "thonyAGP/$repo" "/tmp/$repo"
  cd "/tmp/$repo"

  if [ ! -f "vitest.config.ts" ]; then
    # Copier template vitest.config.ts
    cp ~/templates/vitest.config.ts .
    git add vitest.config.ts
    git commit -m "chore: add vitest config for coverage"
    git push origin HEAD -u
  fi

  cd -
done
```

**Configuration seuils** :

```typescript
// vitest.config.ts (template)
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      lines: 80, // Global
      functions: 80, // Services
      branches: 75,
      statements: 80,
      exclude: ['node_modules/', 'dist/', '**/*.test.ts', '**/*.spec.ts', '**/types.ts'],
    },
  },
});
```

**KPIs attendus** :

- ✅ 4 projets avec coverage tracking
- ✅ Baseline coverage établie pour chaque projet
- ✅ Coverage visible dans chaque PR
- ✅ PR bloquée si coverage baisse >2%

#### 2.2 Branch Protection (1h)

**Script automatique** :

```bash
# scripts/setup-branch-protection.sh
#!/bin/bash

REPOS=(
  "thonyAGP/CasaSync"
  "thonyAGP/Email_Assistant"
  "thonyAGP/au-marais"
  # ... tous les 26 repos
)

for repo in "${REPOS[@]}"; do
  echo "Protecting $repo..."

  # Obtenir la branche par défaut
  default_branch=$(gh api repos/$repo --jq .default_branch)

  # Activer protection
  gh api -X PUT "repos/$repo/branches/$default_branch/protection" \
    -f required_status_checks='{"strict":true,"contexts":["CI","coverage-gate"]}' \
    -f enforce_admins=true \
    -f required_pull_request_reviews='{"required_approving_review_count":1}' \
    -f restrictions=null \
    -f allow_force_pushes=false \
    -f allow_deletions=false

  echo "✅ $repo protected"
done
```

**Exécution** :

```bash
cd DevOps-Factory
chmod +x scripts/setup-branch-protection.sh
./scripts/setup-branch-protection.sh
```

**KPIs attendus** :

- ✅ 26 branches main/master protégées
- ✅ 1 review obligatoire pour merger
- ✅ CI + coverage obligatoires avant merge
- ✅ Force push bloqué sur toutes les branches principales

### Livrables Semaine 2

- [ ] 4 projets avec coverage tracking actif
- [ ] Coverage baseline documentée (`data/coverage-baseline.json`)
- [ ] 26 branches protégées
- [ ] Script `setup-branch-protection.sh` dans le repo
- [ ] Documentation mise à jour (README de chaque projet)
- [ ] Score santé moyen : 60 → **70/100** ✅

---

## 🗓️ Semaine 3 : Excellence (Performance + Types)

**Dates** : Semaine du 24 mars 2026
**Effort total** : 4h
**Impact** : Performance tracking, type safety maximale

### Actions

#### 3.1 Lighthouse CI (1h30)

**Projets Next.js** (7 projets) :

- CasaSync
- au-marais
- livret-au-marais
- Greg-Assainissement
- Site_1970_Plomberie
- Thumbfast
- Utilitaire_Webapp

**Commandes** :

```bash
cd DevOps-Factory

# Déployer lighthouse.yml
pnpm cross-update -- \
  --template templates/lighthouse.yml \
  --target .github/workflows/lighthouse.yml \
  --repos "CasaSync,au-marais,livret-au-marais,Greg-Assainissement,Site_1970_Plomberie,Thumbfast,Utilitaire_Webapp" \
  --pr-title "feat: add Lighthouse CI for performance tracking"

# Configuration budgets
for repo in CasaSync au-marais livret-au-marais ...; do
  # Copier lighthouserc.json
  gh api -X PUT "repos/thonyAGP/$repo/contents/lighthouserc.json" \
    --input templates/lighthouserc.json
done
```

**Budgets de performance** :

```json
// lighthouserc.json (template)
{
  "ci": {
    "collect": {
      "url": ["http://localhost:3000"],
      "numberOfRuns": 3
    },
    "assert": {
      "preset": "lighthouse:recommended",
      "assertions": {
        "first-contentful-paint": ["warn", { "maxNumericValue": 2000 }],
        "largest-contentful-paint": ["error", { "maxNumericValue": 2500 }],
        "cumulative-layout-shift": ["warn", { "maxNumericValue": 0.1 }],
        "total-blocking-time": ["error", { "maxNumericValue": 300 }],
        "speed-index": ["warn", { "maxNumericValue": 3000 }],
        "interactive": ["error", { "maxNumericValue": 3800 }],
        "categories:performance": ["warn", { "minScore": 0.9 }],
        "categories:accessibility": ["error", { "minScore": 0.9 }],
        "categories:seo": ["warn", { "minScore": 0.9 }]
      }
    },
    "upload": {
      "target": "temporary-public-storage"
    }
  }
}
```

**KPIs attendus** :

- ✅ 7 projets avec Lighthouse CI
- ✅ Budgets respectés sur toutes les pages
- ✅ Scores Lighthouse >90 (perf, a11y, SEO)
- ✅ Alertes automatiques si régression

#### 3.2 Type Coverage (1h)

**Commandes** :

```bash
# Déployer type-coverage.yml sur projets TypeScript
pnpm cross-update -- \
  --template templates/type-coverage.yml \
  --target .github/workflows/type-coverage.yml \
  --repos "CasaSync,Email_Assistant,au-marais,DevOps-Factory,ClubMedRoomAssignment,API_Claude,MCP_Quota_Claude" \
  --pr-title "feat: enforce TypeScript type coverage"
```

**Configuration** :

```json
// package.json (à ajouter)
{
  "scripts": {
    "type-coverage": "type-coverage --at-least 90 --strict"
  },
  "devDependencies": {
    "type-coverage": "^2.27.0"
  }
}
```

**KPIs attendus** :

- ✅ Type coverage minimum 90% sur tous les projets TS
- ✅ Type coverage rapporté dans chaque PR
- ✅ PR bloquée si type coverage baisse

#### 3.3 Mutation Testing Pilote (1h30)

**Projets pilotes** :

- DevOps-Factory (déjà 697 tests)
- CasaSync (bon candidat)

**Commandes** :

```bash
cd CasaSync
pnpm add -D @stryker-mutator/core @stryker-mutator/vitest-runner

# stryker.config.json
cat > stryker.config.json <<EOF
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "packageManager": "pnpm",
  "testRunner": "vitest",
  "coverageAnalysis": "perTest",
  "thresholds": {
    "high": 80,
    "low": 60,
    "break": 50
  },
  "mutate": [
    "src/**/*.ts",
    "!src/**/*.test.ts",
    "!src/**/*.spec.ts"
  ]
}
EOF

# Exécuter pour établir baseline
pnpm stryker run
```

**KPIs attendus** :

- ✅ Mutation score baseline établi (cible 70-80%)
- ✅ Tests faibles identifiés
- ✅ Roadmap pour améliorer mutation score

### Livrables Semaine 3

- [ ] 7 projets avec Lighthouse CI
- [ ] Budgets performance définis et trackés
- [ ] Type coverage 90% sur projets TS
- [ ] Mutation testing sur 2 projets pilotes
- [ ] Dashboard performance créé dans DevOps-Factory
- [ ] Score santé moyen : 70 → **80/100** ✅

---

## 🗓️ Semaine 4 : Automatisation Totale

**Dates** : Semaine du 31 mars 2026
**Effort total** : 6h
**Impact** : Zero intervention manuelle, documentation complète

### Actions

#### 4.1 Migration GraphQL (2h)

**Bénéfice** : -60% requêtes API (économie majeure)

**Fichiers à migrer** :

- `scripts/scan-and-configure.ts`
- `scripts/build-dashboard.ts`
- `scripts/self-heal.ts`
- Tous les scripts utilisant `gh api`

**Exemple de migration** :

```typescript
// AVANT (REST API - multiple requêtes)
const repo = ghJson(`api repos/${fullName}`);
const workflows = ghJson(`api repos/${fullName}/actions/workflows`);
const branches = ghJson(`api repos/${fullName}/branches`);
// = 3 requêtes

// APRÈS (GraphQL - 1 requête)
const query = `
  query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      name
      defaultBranchRef { name }
      isArchived
      isFork
      primaryLanguage { name }
      workflows: object(expression: "HEAD:.github/workflows") {
        ... on Tree {
          entries { name }
        }
      }
      refs(refPrefix: "refs/heads/", first: 100) {
        nodes {
          name
          target {
            ... on Commit {
              history(first: 1) {
                nodes { committedDate }
              }
            }
          }
        }
      }
    }
  }
`;

const result = await ghGraphQL(query, { owner, name });
// = 1 requête
```

**Script helper** :

```typescript
// scripts/gh-graphql.ts (NOUVEAU)
import { execSync } from 'child_process';

export const ghGraphQL = <T>(query: string, variables: Record<string, unknown>): T => {
  const result = execSync(
    `gh api graphql -f query='${query}' ${Object.entries(variables)
      .map(([k, v]) => `-F ${k}='${v}'`)
      .join(' ')}`,
    { encoding: 'utf-8' }
  );
  return JSON.parse(result).data as T;
};
```

**KPIs attendus** :

- ✅ 100% des scripts migrés vers GraphQL
- ✅ Requêtes/jour : 60 → 25 (-60%)
- ✅ Rate limit épuisé en : 12 jours → 60+ jours

#### 4.2 Releases Automatiques (1h)

**Semantic Release + Release Drafter**

```bash
cd DevOps-Factory

# Déployer semantic-release.yml
pnpm cross-update -- \
  --template templates/semantic-release.yml \
  --target .github/workflows/semantic-release.yml \
  --all-repos

# Déployer release-drafter.yml
pnpm cross-update -- \
  --template templates/release-drafter.yml \
  --target .github/workflows/release-drafter.yml \
  --all-repos
```

**Configuration conventional commits** :

```json
// .releaserc.json (template)
{
  "branches": ["main", "master"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/changelog",
    "@semantic-release/npm",
    "@semantic-release/github",
    "@semantic-release/git"
  ]
}
```

**KPIs attendus** :

- ✅ Versioning 100% automatique (via commits)
- ✅ Release notes générées automatiquement
- ✅ CHANGELOG.md mis à jour automatiquement
- ✅ Tags Git créés automatiquement

#### 4.3 Auto-labeling & Stale Bot (30min)

```bash
# Auto-label
pnpm cross-update -- \
  --template templates/auto-label.yml \
  --target .github/workflows/auto-label.yml \
  --all-repos

# Stale bot
pnpm cross-update -- \
  --template templates/stale-bot.yml \
  --target .github/workflows/stale.yml \
  --all-repos
```

**Configuration labels** :

```yaml
# .github/labeler.yml (template)
bug:
  - '**/*fix*/**'
  - '**/*bug*/**'
feature:
  - '**/*feat*/**'
  - '**/*feature*/**'
documentation:
  - '**/*.md'
  - 'docs/**/*'
dependencies:
  - 'package.json'
  - 'pnpm-lock.yaml'
  - 'package-lock.json'
```

**KPIs attendus** :

- ✅ 100% des PRs/issues auto-labellisées
- ✅ Issues inactives fermées après 30 jours
- ✅ PRs inactives fermées après 14 jours

#### 4.4 Documentation & Runbooks (2h30)

**Documentation DevOps-Factory** :

1. **README.md complet** (30min)
2. **CONTRIBUTING.md** (20min)
3. **ARCHITECTURE.md** (30min)
4. **Runbooks** (1h10) :
   - `docs/runbooks/rate-limit-exceeded.md`
   - `docs/runbooks/ci-failure-investigation.md`
   - `docs/runbooks/security-alert-response.md`
   - `docs/runbooks/performance-regression.md`
   - `docs/runbooks/coverage-drop.md`

**Structure runbook** :

```markdown
# Runbook: [Incident Name]

## Symptoms

- [Observable symptoms]

## Severity

- P0 (Critical) / P1 (High) / P2 (Medium) / P3 (Low)

## Investigation

1. [Step 1]
2. [Step 2]

## Resolution

### Quick Fix

[Immediate mitigation]

### Permanent Fix

[Root cause resolution]

## Prevention

[How to prevent recurrence]

## Related Runbooks

- [Link to related runbooks]
```

**Audit Final** :

```bash
# Générer rapport final
cd DevOps-Factory
pnpm audit-final

# Rapport incluant:
# - Score santé avant/après
# - Requêtes API avant/après
# - Coverage avant/après
# - Nombre de templates déployés
# - Nombre de PRs créées et mergées
# - ROI estimation (temps économisé vs temps investi)
```

### Livrables Semaine 4

- [ ] 100% scripts migrés vers GraphQL
- [ ] Releases 100% automatiques (26 repos)
- [ ] Auto-labeling actif (26 repos)
- [ ] Stale bot configuré (26 repos)
- [ ] Documentation DevOps-Factory complète
- [ ] 5 runbooks critiques documentés
- [ ] Rapport d'audit final
- [ ] Score santé moyen : 80 → **85+/100** ✅

---

## 📊 Tableau de Bord Final

### Métriques Globales (Avant/Après)

| Métrique                 | Avant  | Après  | Delta        |
| ------------------------ | ------ | ------ | ------------ |
| **Score santé moyen**    | 40/100 | 85/100 | **+113%** ✅ |
| **Requêtes GitHub/jour** | 417    | 25     | **-94%** ✅  |
| **Coverage tracking**    | 0/26   | 4/26   | N/A          |
| **Secret scanning**      | 0/26   | 26/26  | **+100%** ✅ |
| **Branch protection**    | 0/26   | 26/26  | **+100%** ✅ |
| **Performance tracking** | 0/7    | 7/7    | **+100%** ✅ |
| **Type coverage >90%**   | 0/20   | 20/20  | **+100%** ✅ |
| **Releases auto**        | 0/26   | 26/26  | **+100%** ✅ |
| **Temps deploy/projet**  | ~2h    | ~5min  | **-96%** ✅  |

### ROI Estimé

**Temps investi** : 15h (4 semaines × ~4h/semaine)

**Temps économisé par mois** :

- Configuration manuelle : 2h/projet/mois × 26 = 52h
- Investigation incidents : -50% (runbooks) = 10h
- Releases manuelles : 30min/release × 26 × 2/mois = 26h
- Review dépendances : -80% (Renovate) = 8h

**Total économisé** : **~96h/mois**

**ROI** : 96h/mois ÷ 15h investis = **6.4× dès le premier mois**

---

## 🎯 Checklist de Progression

### Semaine 1

- [ ] Cache manager implémenté
- [ ] Repos inactifs filtrés
- [ ] Crons réduits à 12h
- [ ] Gitleaks déployé (26/26)
- [ ] Renovate déployé (26/26)
- [ ] Semgrep déployé (26/26)
- [ ] Score: 60/100 atteint

### Semaine 2

- [ ] Coverage tracking (4/4)
- [ ] Coverage baseline établie
- [ ] Branches protégées (26/26)
- [ ] Required reviews configurés
- [ ] Score: 70/100 atteint

### Semaine 3

- [ ] Lighthouse CI (7/7)
- [ ] Budgets performance définis
- [ ] Type coverage 90% (20/20)
- [ ] Mutation testing (2/2 pilotes)
- [ ] Dashboard performance créé
- [ ] Score: 80/100 atteint

### Semaine 4

- [ ] GraphQL migration (100%)
- [ ] Semantic release (26/26)
- [ ] Release drafter (26/26)
- [ ] Auto-label (26/26)
- [ ] Stale bot (26/26)
- [ ] Documentation complète
- [ ] 5 runbooks créés
- [ ] Audit final exécuté
- [ ] Score: 85+/100 atteint

---

## 📞 Support & Escalation

**Questions ou blocages ?**

- Issues GitHub : `DevOps-Factory/issues`
- Runbooks : `docs/runbooks/`
- Documentation : `README.md`, `ARCHITECTURE.md`

**Escalation path** :

1. Consulter runbooks
2. Créer issue GitHub avec template
3. Tag `@devops-lead` si P0/P1

---

**Document créé** : 4 mars 2026
**Dernière mise à jour** : 4 mars 2026
**Responsable** : DevOps Team
**Statut** : ✅ APPROUVÉ - Prêt à commencer Semaine 1
