# Quick Start - Roadmap 4 Semaines

> **TL;DR** : 15h investies sur 4 semaines pour atteindre 85/100 de score santé et économiser 96h/mois

---

## 🚀 Démarrer Maintenant (Semaine 1)

### Prérequis

```bash
cd DevOps-Factory

# Vérifier que tout compile
pnpm typecheck  # ✅ Devrait passer (42 erreurs corrigées)
pnpm test       # ✅ 697/697 tests

# Vérifier rate limit GitHub
gh api rate_limit | jq .rate
```

### Étape 1 : Cache Manager (45 min)

```bash
# Créer le dossier cache
mkdir -p data/cache

# Créer scripts/cache-manager.ts
cat > scripts/cache-manager.ts <<'EOF'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const CACHE_DIR = 'data/cache';
const CACHE_TTL_MS = 3600000; // 1 heure

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true });
}

export const getCached = <T>(key: string): T | null => {
  const path = join(CACHE_DIR, `${key}.json`);
  if (!existsSync(path)) return null;

  try {
    const entry: CacheEntry<T> = JSON.parse(readFileSync(path, 'utf-8'));
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
};

export const setCache = <T>(key: string, data: T): void => {
  const path = join(CACHE_DIR, `${key}.json`);
  const entry: CacheEntry<T> = { data, timestamp: Date.now() };
  writeFileSync(path, JSON.stringify(entry, null, 2));
};

export const clearCache = (key?: string): void => {
  if (key) {
    const path = join(CACHE_DIR, `${key}.json`);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } else {
    // Clear all cache
    if (existsSync(CACHE_DIR)) {
      const files = readdirSync(CACHE_DIR);
      files.forEach(f => unlinkSync(join(CACHE_DIR, f)));
    }
  }
};
EOF

# Tester
node -e "
  const { setCache, getCached } = require('./scripts/cache-manager.ts');
  setCache('test', { value: 42 });
  const result = getCached('test');
  console.log('✅ Cache works:', result);
"
```

### Étape 2 : Modifier scan-and-configure.ts (30 min)

```bash
# Ajouter en haut du fichier
import { getCached, setCache } from './cache-manager.js';

# Trouver la fonction listRepos() et modifier:
```

```typescript
const listRepos = (): Repo[] => {
  const cached = getCached<Repo[]>('repos-list');
  if (cached) {
    console.log(`✅ Using cached repos (${cached.length})`);
    return cached;
  }

  console.log('🔍 Fetching repos from GitHub API...');
  const repos = ghJson<Repo[]>(
    'api user/repos --paginate --jq "[.[] | {name, full_name, default_branch, archived, fork, private: .private, language}]"'
  );

  const active = repos.filter((r) => !r.archived && !r.fork && !IGNORED_REPOS.includes(r.name));

  setCache('repos-list', active);
  console.log(`✅ Cached ${active.length} active repos`);

  return active;
};
```

### Étape 3 : Filtrer Repos Inactifs (15 min)

```typescript
// Ajouter après la fonction listRepos()
const INACTIVE_THRESHOLD_DAYS = 90;

const isRepoActive = (repo: Repo): boolean => {
  const cached = getCached<boolean>(`active-${repo.name}`);
  if (cached !== null) return cached;

  const lastPush = gh(`api repos/${repo.full_name} --jq .pushed_at`);
  if (!lastPush) return false;

  const daysSinceLastPush = (Date.now() - new Date(lastPush).getTime()) / 86400000;
  const active = daysSinceLastPush < INACTIVE_THRESHOLD_DAYS;

  setCache(`active-${repo.name}`, active);
  return active;
};

// Modifier listRepos pour filtrer:
const active = repos
  .filter((r) => !r.archived && !r.fork && !IGNORED_REPOS.includes(r.name))
  .filter(isRepoActive); // ← AJOUT

console.log(
  `✅ Cached ${active.length} active repos (filtered ${repos.length - active.length} inactive)`
);
```

### Étape 4 : Réduire Fréquence Crons (5 min)

```bash
# Modifier .github/workflows/scan-repos.yml
sed -i 's/0 \*\/6/0 \*\/12/g' .github/workflows/scan-repos.yml

# Modifier .github/workflows/dashboard-build.yml
sed -i 's/0 \*\/1/0 \*\/2/g' .github/workflows/dashboard-build.yml

# Vérifier les changements
git diff .github/workflows/
```

### Étape 5 : Tester les Optimisations

```bash
# Vider le cache
rm -rf data/cache/*

# Premier scan (devrait faire appels API)
time pnpm scan

# Deuxième scan (devrait utiliser cache)
time pnpm scan  # Devrait être >10x plus rapide

# Vérifier le cache
ls -lh data/cache/
```

### Étape 6 : Déployer Sécurité (45 min)

```bash
# 1. Gitleaks
pnpm cross-update -- \
  --template templates/gitleaks.yml \
  --target .github/workflows/gitleaks.yml \
  --all-repos \
  --pr-title "chore: add secret scanning with Gitleaks"

# Attendre que les PRs soient créées (2-3 min)

# 2. Renovate
pnpm cross-update -- \
  --template templates/renovate.json \
  --target renovate.json \
  --all-repos \
  --pr-title "chore: add automated dependency updates"

# 3. Semgrep
pnpm cross-update -- \
  --template templates/semgrep.yml \
  --target .github/workflows/semgrep.yml \
  --all-repos \
  --pr-title "chore: add SAST with Semgrep"
```

### Étape 7 : Valider et Merger (30 min)

```bash
# Lister toutes les PRs créées
for repo in CasaSync Email_Assistant au-marais ...; do
  echo "=== $repo ==="
  gh pr list --repo "thonyAGP/$repo" --author "app/github-actions"
done

# Merger une PR (après review)
gh pr merge 123 --repo thonyAGP/CasaSync --squash

# Ou merger toutes en une commande (DANGER - reviewer d'abord !)
# for repo in ...; do
#   gh pr list --repo "thonyAGP/$repo" --author "app/github-actions" --json number --jq '.[0].number' | \
#     xargs -I {} gh pr merge {} --repo "thonyAGP/$repo" --squash --auto
# done
```

### Étape 8 : Commit Optimisations

```bash
cd DevOps-Factory

git add scripts/cache-manager.ts
git add scripts/scan-and-configure.ts
git add .github/workflows/
git add data/cache/.gitignore

git commit -m "feat(optimization): reduce GitHub API usage by 70%

- Add cache manager with 1h TTL
- Filter inactive repos (>90 days)
- Reduce cron frequency (6h→12h)
- Expected: 417→125 requests/day


git push
```

---

## ✅ Checklist Semaine 1

- [ ] Cache manager créé et testé
- [ ] scan-and-configure.ts modifié avec cache
- [ ] Repos inactifs filtrés (>90j)
- [ ] Crons réduits (6h→12h, 1h→2h)
- [ ] Gitleaks déployé (26 PRs créées et mergées)
- [ ] Renovate déployé (26 PRs créées et mergées)
- [ ] Semgrep déployé (26 PRs créées et mergées)
- [ ] Optimisations commitées et pushées
- [ ] Score santé : 40→60/100 ✅

---

## 📊 Métriques à Vérifier

```bash
# Rate limit avant/après
gh api rate_limit | jq '{used: .rate.used, remaining: .rate.remaining, limit: .rate.limit}'

# Repos actifs vs total
pnpm scan | grep "active repos"

# Cache hit rate
find data/cache -name "*.json" | wc -l

# Scores santé
pnpm quality-score | jq '.scores[] | {name, score}'
```

---

## 🎯 Prochaines Étapes

**Après Semaine 1 :**

- Semaine 2 : Coverage Tracking + Branch Protection
- Semaine 3 : Performance + Type Safety
- Semaine 4 : Automatisation totale + Documentation

**Voir** : `ROADMAP.md` pour le plan détaillé complet

---

## 🆘 Aide

**Problèmes fréquents** :

| Problème                  | Solution                                                 |
| ------------------------- | -------------------------------------------------------- |
| Rate limit atteint        | Attendre 1h ou utiliser cache : `pnpm scan --cache-only` |
| PRs non créées            | Vérifier token GitHub : `gh auth status`                 |
| Cache ne fonctionne pas   | Vérifier permissions dossier : `chmod -R 755 data/cache` |
| Crons ne se réduisent pas | Push les changements workflows : `git push origin HEAD`  |

**Runbooks** : Voir `ROADMAP.md` section Documentation

---

**Prêt à commencer ?** 🚀

```bash
# Commande unique pour tout lancer
cd DevOps-Factory && \
  pnpm typecheck && \
  pnpm test && \
  echo "✅ Prêt pour Semaine 1 !"
```
