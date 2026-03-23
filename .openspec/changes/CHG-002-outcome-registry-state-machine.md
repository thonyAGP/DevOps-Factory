# CHG-002: Outcome Registry + State Machine Repo (SWARM Niveau 3)

**Status**: `APPROVED`
**Date**: 2026-03-23
**Origine**: SWARM analysis - consensus unanime, niveau 3

## Contexte

Le self-heal cree des PRs mais ne capture pas le resultat (mergee/rejetee/modifiee).
Les repos sont tous traites de la meme facon, sans progression automatique
vers plus d'autonomie quand ils ont prouve leur fiabilite.

## Requirements

### R1: Outcome Registry

- Le systeme SHALL capturer l'etat final de chaque PR self-heal (merged/closed)
- Le systeme SHALL stocker les outcomes dans `data/outcome-registry.json`
- Le systeme SHALL recalculer les confidence scores apres chaque cycle
- Les patterns avec taux succes > 85% sur 5+ PRs SHOULD etre promus auto-merge
- Les patterns avec taux succes < 30% sur 5+ PRs SHOULD etre desactives

### R2: State Machine Repo

- Chaque repo SHALL avoir un etat dans factory.config.ts:
  - DISCOVERED: detecte par scan, pas encore monitore
  - MONITORED: CI surveillee, self-heal desactive
  - HEALING_SUPERVISED: self-heal actif, PRs en review humaine
  - HEALING_GRADUATED: self-heal actif, auto-merge pour patterns fiables
- Les transitions SHOULD etre automatiques basees sur les outcomes
- Un repo MUST accumuler 3+ PRs mergees pour passer de SUPERVISED a GRADUATED

## Impact Analysis

| Fichier                            | Modification                                 |
| ---------------------------------- | -------------------------------------------- |
| `scripts/outcome-registry.ts`      | NOUVEAU - capture outcomes, recalcule scores |
| `factory.config.ts`                | Ajouter champ `healingState` a ProjectConfig |
| `scripts/self-heal.ts`             | Verifier healingState avant de creer PRs     |
| `.github/workflows/scan-repos.yml` | Ajouter etape outcome-registry               |
