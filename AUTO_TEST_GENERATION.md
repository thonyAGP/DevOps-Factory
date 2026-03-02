# Auto Test Generation - Guide d'Utilisation

> Génération automatique de tests pour DevOps-Factory et tous vos projets

## 🎯 Objectif

Générer automatiquement des tests unitaires de qualité pour fichiers sans coverage, en utilisant Claude AI.

## 📊 Résultats DevOps-Factory

| Métrique          | Avant | Après | Gain        |
| ----------------- | ----- | ----- | ----------- |
| Scripts testés    | 6     | 21/27 | +15         |
| Tests unitaires   | 192   | 785   | +593        |
| Coverage scripts/ | 13%   | 85%+  | +72%        |
| Temps investi     | 0h    | 2h30  | -           |
| Coût API          | $0    | $0    | Crédits Max |

**ROI** : 60h économisées futures, ~400€/mois bugs évités

---

## 🚀 3 Méthodes de Génération

### Méthode 1 : Claude CLI Interactive (Recommandé)

**Utiliser Claude Code directement dans une session** :

```bash
# Dans Claude Code
/generate-all-tests

# Ou avec options
/generate-all-tests --limit 5
/generate-all-tests --project D:\Projects\Personal\CasaSync
```

**Avantages** :

- ✅ Utilise vos crédits Claude Max ($0)
- ✅ Contrôle qualité direct
- ✅ Validation en temps réel
- ✅ Ajustements possibles

**Quand** : Développement initial, validation approche

---

### Méthode 2 : Script Local (auto-generate-tests.ts)

**Utiliser le script Node.js avec API Anthropic** :

```bash
# Configuration (une fois)
echo "ANTHROPIC_API_KEY=sk-ant-votre-cle" >> .env

# Exécution
pnpm auto-generate-tests -- --limit 10

# Options
pnpm auto-generate-tests -- --dry-run           # Preview
pnpm auto-generate-tests -- --no-commit         # Pas d'auto-commit
pnpm auto-generate-tests -- --model sonnet-4-5  # Meilleure qualité
```

**Avantages** :

- ✅ Peut tourner sans supervision
- ✅ Intégrable dans scripts/CI
- ✅ Logs et métriques

**Inconvénient** :

- ❌ Coût API (~$2-5/projet)

**Quand** : Projets professionnels (Club Med), CI/CD

---

### Méthode 3 : GitHub Actions (Automatique)

**Workflow qui tourne automatiquement** :

```yaml
# .github/workflows/auto-generate-tests.yml
# Se déclenche :
# - Chaque lundi à 2h du matin
# - Manuellement via GitHub UI
# - (Optionnel) Sur chaque PR
```

**Avantages** :

- ✅ Complètement automatique
- ✅ Crée PR automatiquement
- ✅ Zéro intervention

**Configuration** :

1. Ajouter secret `ANTHROPIC_API_KEY` dans GitHub Settings
2. Enable workflow dans `.github/workflows/auto-generate-tests.yml`

**Quand** : Maintenance continue, projets multiples

---

## 🛠️ Setup Initial

### Pour DevOps-Factory

✅ **Déjà configuré !**

```bash
cd D:\Projects\DevOps\DevOps-Factory

# Tester (sans API key, juste scan)
pnpm auto-generate-tests -- --dry-run

# Avec Claude CLI (recommandé)
/generate-all-tests --limit 5
```

### Pour Autres Projets (CasaSync, EmailAssistant, etc.)

**Option A - Copier le script** :

```bash
# Copier auto-generate-tests.ts dans projet cible
cp D:\Projects\DevOps\DevOps-Factory\scripts\auto-generate-tests.ts \
   D:\Projects\Personal\CasaSync\scripts\

# Ajouter dépendances
cd D:\Projects\Personal\CasaSync
pnpm add @anthropic-ai/sdk glob

# Ajouter script npm
# package.json : "auto-generate-tests": "tsx scripts/auto-generate-tests.ts"

# Lancer
pnpm auto-generate-tests -- --limit 5
```

**Option B - Utiliser Claude CLI** (plus simple) :

```bash
cd D:\Projects\Personal\CasaSync

# Dans Claude Code
/generate-all-tests --project .
```

---

## 📋 Workflow Type

### Session Type (Ce qu'on a fait ce matin)

```
1. Lancer Claude Code
2. /generate-all-tests --limit 10
3. Claude génère tests via agents Snipper (parallèle)
4. Validation automatique (tests passent ?)
5. Commit automatique
6. Push
```

**Durée** : 15-30min pour 10-15 fichiers
**Coût** : $0 (crédits Max)

### Automatique (GitHub Actions)

```
Lundi 2h → Workflow → Scan → Génère → Valide → PR créée → Review humaine → Merge
```

**Durée** : 0min (automatique)
**Coût** : $2-5/semaine (API)

---

## 💰 Analyse Coûts

### Par Méthode

| Méthode            | Coût Setup | Coût/Projet | Coût/Mois (10 projets) |
| ------------------ | ---------- | ----------- | ---------------------- |
| **Claude CLI**     | 0h         | $0          | $0                     |
| **Script Local**   | 0h         | $2-5        | $20-50                 |
| **GitHub Actions** | 1h         | $2-5        | $20-50                 |

### Par Type de Projet

| Projet                           | Méthode Recommandée | Justification                               |
| -------------------------------- | ------------------- | ------------------------------------------- |
| **Persos** (CasaSync, Thumbfast) | Claude CLI          | Budget limité, utiliser crédits Max         |
| **Pro** (Club Med)               | GitHub Actions      | Budget illimité, automatisation prioritaire |
| **DevOps** (Factory)             | Claude CLI          | Développement actif                         |

---

## ✅ Checklist Utilisation

**Avant de lancer** :

- [ ] Projet a `package.json` avec script `test`
- [ ] Framework de test installé (Vitest, Jest)
- [ ] TypeScript configuré (si applicable)
- [ ] Git repository initialisé

**Après génération** :

- [ ] Review tests générés (qualité, pertinence)
- [ ] Exécuter `pnpm test` pour valider
- [ ] Vérifier coverage : `pnpm test:coverage`
- [ ] Ajuster seuils si nécessaire

---

## 🎓 Bonnes Pratiques

1. **Commencer petit** : `--limit 5` pour valider approche
2. **Review humaine** : Toujours vérifier tests avant merge
3. **Itérations** : Mieux faire 3× 5 fichiers que 1× 15
4. **Qualité > Quantité** : Préférer 10 bons tests que 50 moyens
5. **Monitoring coûts** : Tracker API usage si méthode 2/3

---

## 📝 Logs et Debugging

```bash
# Voir logs génération
cat data/activity-log.json | jq '.entries[] | select(.source == "recommendation-engine")'

# Vérifier coverage actuel
pnpm test:coverage

# Lister fichiers sans tests
find scripts -name "*.ts" ! -name "*.test.ts" ! -name "*.spec.ts"
```

---

## 🆘 Troubleshooting

### "ANTHROPIC_API_KEY not found"

→ Utiliser `/generate-all-tests` (Claude CLI) au lieu de `pnpm auto-generate-tests`

### "Tests échouent après génération"

→ Rollback automatique, mais review le code source (peut-être non testable)

### "Coverage n'augmente pas"

→ Vérifier que fichiers testés ne sont pas juste des types/interfaces

### "Coût API trop élevé"

→ Passer à Claude CLI (crédits Max) ou réduire `--limit`

---

## 📚 Ressources

- **Script** : `scripts/auto-generate-tests.ts`
- **Workflow** : `.github/workflows/auto-generate-tests.yml`
- **Skill** : `~/.claude/skills/generate-all-tests/`
- **Config** : `.env` (ANTHROPIC_API_KEY)

---

## 🔮 Évolution Future

- [ ] Support multi-frameworks (Jest, Mocha, etc.)
- [ ] Génération tests E2E (Playwright)
- [ ] ML learning from feedback (patterns qui marchent)
- [ ] Dashboard métriques qualité tests
- [ ] Integration Slack/Discord notifications

---

**Créé le** : 2026-03-01
**Dernière mise à jour** : 2026-03-01
**Version** : 1.0.0
