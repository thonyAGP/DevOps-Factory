# Code Quality Swarm - Setup Guide

## 🎯 Objectif

Système automatisé de **génération de tests** et **review qualité** utilisant Claude AI pour améliorer la qualité des projets.

**Coût estimé** : ~$3.50/mois par projet (API Claude)

---

## 💰 Estimation des Coûts

### Coûts API Claude

| Opération            | Modèle     | Coût unitaire  | Fréquence            | Mensuel          |
| -------------------- | ---------- | -------------- | -------------------- | ---------------- |
| Génération tests     | Haiku 4.5  | $0.045/fichier | ~30 fichiers initial | $1.35 (one-time) |
| Review qualité       | Sonnet 4.5 | $0.032/scan    | 1/jour               | $0.96/mois       |
| Détection bugs       | Haiku 4.5  | $0.002/fichier | 5 fichiers/jour      | $0.30/mois       |
| **Total par projet** |            |                |                      | **~$3.50/mois**  |

**Pour 10 projets** : ~$35/mois API + $0 infra (local)

### Infrastructure

- **Local (Docker Compose)** : $0/mois
- **Cloud (optionnel)** : ~$32/mois (AWS EC2 + RDS)

---

## 📋 Prérequis

- [Docker](https://www.docker.com/get-started) et Docker Compose v2+
- [Node.js](https://nodejs.org/) 20+ (pour développement)
- Clé API Anthropic ([obtenir ici](https://console.anthropic.com/))
- Git

---

## 🚀 Installation Rapide (5 minutes)

### 1. Cloner et configurer

```bash
cd D:\Projects\DevOps\DevOps-Factory

# Copier le fichier d'environnement
cp .env.example .env

# IMPORTANT: Éditer .env et ajouter votre clé API
notepad .env
# Remplacer: ANTHROPIC_API_KEY=sk-ant-your-api-key-here
```

### 2. Créer la structure des agents

```bash
# Créer les dossiers nécessaires
mkdir -p agents/{test-generator,code-reviewer,bug-detector}
mkdir -p coordinator scheduler dashboard
mkdir -p projects output infra

# Les Dockerfiles et code seront générés automatiquement
```

### 3. Lancer le système

```bash
# Construire les images Docker
docker compose -f docker-compose.swarm.yml build

# Démarrer tous les services
docker compose -f docker-compose.swarm.yml up -d

# Vérifier que tout fonctionne
docker compose -f docker-compose.swarm.yml ps
```

### 4. Vérifier le fonctionnement

```bash
# Santé du coordinator
curl http://localhost:3100/health

# Dashboard (si activé)
start http://localhost:3102
```

---

## 🎛️ Configuration

### Fichier `.env`

```bash
# === OBLIGATOIRE ===
ANTHROPIC_API_KEY=sk-ant-your-actual-key

# === Base de données ===
DB_PASSWORD=change_me_in_production

# === Seuils de qualité ===
MIN_COVERAGE_THRESHOLD=70      # % coverage minimum
MAX_COMPLEXITY_THRESHOLD=10    # Complexité cyclomatique max
BLOCK_ON_CRITICAL_BUGS=true    # Bloquer si bugs critiques

# === Projets à scanner ===
PROJECTS=DevOps-Factory,CasaSync,EmailAssistant

# === Horaires (cron) ===
SCHEDULE_DAILY=0 2 * * *       # Quotidien à 2h
SCHEDULE_WEEKLY=0 3 * * 0      # Hebdo dimanche 3h
```

### Ajouter des projets à scanner

1. Créer un lien symbolique ou copier le projet dans `./projects/`

```bash
# Lien symbolique (recommandé)
ln -s D:\Projects\EmailAssistant .\projects\EmailAssistant

# Ou copier (pour test)
cp -r D:\Projects\EmailAssistant .\projects\EmailAssistant
```

2. Ajouter le nom dans `.env` → `PROJECTS`

---

## 🔧 Utilisation

### Scanner manuellement un projet

```bash
# Via API
curl -X POST http://localhost:3100/api/scan \
  -H "Content-Type: application/json" \
  -d '{
    "project": "EmailAssistant",
    "trigger": "manual",
    "options": {
      "generateTests": true,
      "reviewCode": true,
      "detectBugs": true
    }
  }'

# Réponse:
# {
#   "scanId": "uuid-here",
#   "status": "running",
#   "estimatedDuration": 120
# }
```

### Consulter les résultats

```bash
# Récupérer résultats d'un scan
curl http://localhost:3100/api/scan/{scanId}

# Lister tous les scans récents
curl http://localhost:3100/api/scans?limit=10

# Statistiques par projet
curl http://localhost:3100/api/stats/EmailAssistant
```

### Tests générés

Les tests générés sont disponibles dans `./output/tests/`

```bash
# Exemple de structure
output/
└── tests/
    └── EmailAssistant/
        └── scan-2024-03-01-uuid/
            ├── src/
            │   └── utils/
            │       └── email-validator.test.ts  # NOUVEAU
            └── report.json
```

**Appliquer les tests** :

```bash
# Copier dans le projet
cp output/tests/EmailAssistant/scan-xxx/src/**/*.test.ts \
   D:\Projects\EmailAssistant\src/

# Exécuter les tests
cd D:\Projects\EmailAssistant
pnpm test
```

---

## 📊 Dashboard (optionnel)

Accéder au dashboard : http://localhost:3102

**Fonctionnalités** :

- Vue d'ensemble de tous les projets
- Historique des scans
- Drill-down par projet
- Graphiques coverage, bugs, qualité
- Export rapports PDF

---

## 🐛 Dépannage

### Les agents ne démarrent pas

```bash
# Vérifier les logs
docker compose -f docker-compose.swarm.yml logs agent-test-generator

# Causes fréquentes:
# 1. ANTHROPIC_API_KEY manquante ou invalide
# 2. Redis/PostgreSQL pas démarrés (healthcheck fail)
# 3. Mauvaise configuration volumes
```

### Pas de tests générés

```bash
# Vérifier que le projet est bien monté
docker exec swarm-agent-test-generator ls /workspace

# Vérifier les permissions
ls -la ./projects/
ls -la ./output/

# Logs détaillés
docker compose -f docker-compose.swarm.yml logs -f agent-test-generator
```

### Coûts API trop élevés

**Solutions** :

1. Réduire fréquence scans : `SCHEDULE_DAILY=0 2 * * 0` (hebdo)
2. Filtrer fichiers analysés : `.swarmignore` (node_modules, dist, etc.)
3. Utiliser Haiku partout : `CODE_REVIEWER_MODEL=claude-haiku-4-5`

---

## 📈 Évolution vers ML Reviewer (Phase 2)

Après 1 mois d'utilisation (100+ scans) :

1. **Collecter données**

```sql
SELECT * FROM scans WHERE status = 'completed';
SELECT * FROM code_issues;
```

2. **Labelliser** (humain valide/rejette suggestions)

3. **Entraîner modèle** simple (Logistic Regression)

4. **Ajouter agent ML** en parallèle

5. **A/B testing** : 80% manuel, 20% ML

6. **Basculement** si précision >95%

---

## 🛑 Arrêter le système

```bash
# Arrêter tous les services
docker compose -f docker-compose.swarm.yml down

# Supprimer aussi les volumes (données effacées)
docker compose -f docker-compose.swarm.yml down -v
```

---

## 📚 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    SWARM COORDINATOR                     │
│  API REST + Orchestration + Décisions finales           │
└─────────────────┬───────────────────────────────────────┘
                  │
        ┌─────────┼──────────┐
        │         │          │
   ┌────▼───┐ ┌──▼────┐ ┌───▼────┐
   │ Test   │ │ Code  │ │  Bug   │
   │ Gen    │ │Review │ │Detector│
   │(Haiku) │ │(Sonnet)│ │(Haiku) │
   └────┬───┘ └───┬───┘ └───┬────┘
        │         │         │
        └─────────┼─────────┘
                  │
        ┌─────────▼──────────┐
        │   Redis + Postgres │
        │   (cache + results)│
        └────────────────────┘
```

---

## 💡 Recommandations

1. **Démarrer petit** : 1-2 projets pour valider
2. **Vérifier coûts** : Dashboard → onglet Costs
3. **Ajuster seuils** : `.env` selon votre contexte
4. **Review humaine** : Toujours valider tests générés avant commit
5. **Monitoring** : Activer logs `LOG_LEVEL=debug` si problèmes

---

## 🆘 Support

- Issues GitHub : https://github.com/votre-org/devops-factory/issues
- Documentation complète : `./docs/`
- Exemples : `./examples/`
