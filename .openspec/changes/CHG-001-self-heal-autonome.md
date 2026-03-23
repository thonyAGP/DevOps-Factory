# CHG-001: Self-Heal Autonome (SWARM Niveau 2)

**Status**: `IMPLEMENTING`
**Date**: 2026-03-23
**Origine**: SWARM analysis - consensus unanime 5/5 agents

## Contexte

Le self-heal cree des PRs de fix mais ne les merge pas automatiquement.
62 PRs ont ete fermees manuellement, les confidence scores ne sont pas calibres
sur des donnees reelles, et les notifications email sont trop bruyantes.

## Requirements

### R1: Auto-merge conditionnel

- Le systeme SHALL auto-merger les PRs de fix quand:
  - Le pattern a un confidence score >= 85%
  - Tous les checks CI sont verts apres le fix
  - Un delai de securite de 10 minutes s'est ecoule
- Le systeme SHALL permettre a un humain d'annuler pendant le delai de 10min
- Le systeme MUST NOT auto-merger les PRs de patterns sans historique de succes
- Le systeme SHALL logger chaque auto-merge dans activity-log.json

### R2: Audit des PRs fermees / Pattern scoring

- Le systeme SHALL analyser les PRs fermees pour calculer le taux de succes par pattern
- Le systeme SHALL stocker les resultats dans `data/pattern-scores.json`
- Le systeme SHALL mettre a jour les confidence scores dans patterns.json en fonction des resultats
- Les patterns avec taux de succes < 50% SHOULD etre desactives automatiquement

### R3: Filtre email intelligent

- Le systeme SHALL ne PAS envoyer d'alerte email si le self-heal est en cours
- Le systeme SHALL envoyer une alerte UNIQUEMENT si la CI reste cassee apres 2 cycles consecutifs de self-heal (>2h)
- Le systeme MAY inclure un resume des tentatives de self-heal dans l'alerte

## Scenarios

### S1: Auto-merge reussi

```
GIVEN une PR de fix creee par self-heal avec pattern "prettier-format" (confiance 92%)
WHEN les checks CI passent tous au vert
THEN le systeme attend 10 minutes puis merge la PR en squash
AND loggue l'evenement dans activity-log.json
```

### S2: Auto-merge bloque (pattern inconnu)

```
GIVEN une PR de fix creee par self-heal avec pattern nouveau (confiance 60%)
WHEN les checks CI passent
THEN le systeme NE merge PAS automatiquement
AND laisse la PR en attente de review humaine
```

### S3: Alerte filtree

```
GIVEN une CI cassee sur repo X
WHEN le self-heal cree une PR de fix au cycle 1
THEN aucune alerte email n'est envoyee
WHEN la CI est toujours cassee apres le cycle 2 (>2h plus tard)
THEN une alerte email est envoyee avec le detail des tentatives
```

## Impact Analysis

| Fichier                           | Modification                                    |
| --------------------------------- | ----------------------------------------------- |
| `scripts/self-heal.ts`            | Ajouter auto-merge apres creation PR            |
| `data/patterns.json`              | MAJ confidence scores apres audit               |
| `scripts/audit-pr-outcomes.ts`    | NOUVEAU - audit des 62 PRs fermees              |
| `data/pattern-scores.json`        | NOUVEAU - resultats audit par pattern           |
| `scripts/ci-health-check.ts`      | Ajouter filtre alerte (2 cycles)                |
| `.github/workflows/self-heal.yml` | Pas de changement (le delai est dans le script) |

## Acceptance Criteria

- [ ] Auto-merge fonctionne pour patterns confiance >= 85%
- [ ] Patterns sans historique restent en review humaine
- [ ] Delai 10min respecte avant merge
- [ ] Audit des PRs fermees produit pattern-scores.json
- [ ] Confidence scores mis a jour dans patterns.json
- [ ] Alertes email filtrees (pas d'alerte si self-heal en cours, cycle 1)
- [ ] Alerte envoyee si CI cassee apres 2 cycles (>2h)

## Risques

| Risque                        | Mitigation                              |
| ----------------------------- | --------------------------------------- |
| Auto-merge d'un fix incorrect | Confiance >85% + CI verte + delai 10min |
| Pattern scoring biaise        | Audit sur donnees reelles (62 PRs)      |
| Silence excessif des alertes  | Alerte garantie apres 2 cycles (2h max) |
