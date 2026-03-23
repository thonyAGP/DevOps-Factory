# CHG-003: Circuit Breaker + Feedback Negatif + PR Body Enrichi (SWARM Niveau 1)

**Status**: `APPROVED`
**Date**: 2026-03-23
**Origine**: SWARM analysis #2 - consensus unanime 5/5, niveau 1 immediat

## Contexte

Le self-heal n'a pas de mecanisme de protection contre les boucles infinies au-dela du cooldown par erreur.
Les PRs generees ne contiennent pas assez de contexte pour evaluer rapidement le fix.
Il n'existe pas de feedback loop negatif (marquer un fix comme mauvais).

## Requirements

### R1: Circuit Breaker par repo

- Le systeme SHALL compter les PRs healing non-mergees en attente par repo
- Si 3+ PRs ai-fix sont ouvertes sur un repo, le self-heal SHALL se mettre en pause pour ce repo
- Si le meme pattern echoue 2x sur le meme repo dans 72h, le self-heal SHALL dead-letter ce pattern/repo
- Le systeme SHALL loguer les pauses dans activity-log.json

### R2: Corps de PR enrichi

- Chaque PR SHALL inclure: pattern ID matche, signature detectee, niveau de confiance
- Chaque PR SHALL inclure le modele IA utilise (Groq/Gemini/Cerebras)
- Chaque PR SHALL inclure une section "Pourquoi ce fix?" avec le contexte de l'echec CI

### R3: Feedback loop negatif

- Si une PR ai-fix est fermee avec le label `fix-rejected`, le outcome registry SHALL abaisser la confiance du pattern
- Le systeme SHALL creer le label `fix-rejected` dans chaque repo healing
- L'outcome registry SHALL differencier fermeture manuelle (neutre) vs label fix-rejected (signal negatif fort)

## Impact Analysis

| Fichier                            | Modification                                                       |
| ---------------------------------- | ------------------------------------------------------------------ |
| `scripts/self-heal.ts`             | Ajouter circuit breaker (check PRs ouvertes), enrichir createFixPR |
| `scripts/outcome-registry.ts`      | Detecter label fix-rejected, appliquer penalite confiance          |
| `.github/workflows/scan-repos.yml` | Aucune modification                                                |
