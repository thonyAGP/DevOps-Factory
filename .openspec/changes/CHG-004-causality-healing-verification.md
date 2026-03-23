# CHG-004: Causalite Outcomes + Healing Verification Post-Merge (SWARM Niveau 2)

**Status**: `APPROVED`
**Date**: 2026-03-23
**Origine**: SWARM analysis #2 - consensus unanime 5/5, niveau 2 court terme

## Contexte

L'outcome registry enregistre merge/close mais pas POURQUOI une PR a ete fermee.
Apres merge d'une PR healing, rien ne verifie que le CI passe effectivement sur master.
Sans ces mecanismes, le systeme ne peut pas apprendre de ses erreurs post-merge.

## Requirements

### R1: Causalite dans l'outcome registry

- Chaque OutcomeEntry SHALL avoir un champ `closeReason` categorisant la fermeture
- Les raisons possibles: `merged`, `rejected` (label), `reverted` (revert detecte), `superseded` (autre PR mergee sur les memes fichiers), `manual_close` (ferme sans label)
- Le systeme SHALL detecter les reverts: si un commit "Revert" mentionne une PR mergee dans les 7j, l'outcome devient negatif retroactif
- Les PRs revertees SHALL recevoir une penalite de confiance identique aux rejections

### R2: Healing verification post-merge

- Pour chaque PR healing mergee dans les dernieres 48h, le systeme SHALL verifier l'etat CI actuel du repo
- Si le CI est rouge apres le merge d'une PR healing, l'outcome SHALL etre marque `healing_failed`
- Un `healing_failed` SHALL appliquer une penalite de confiance (-10% par echec)
- Si le CI est vert, l'outcome SHALL etre marque `healing_verified`

## Impact Analysis

| Fichier                       | Modification                                                 |
| ----------------------------- | ------------------------------------------------------------ |
| `scripts/outcome-registry.ts` | Ajouter closeReason, detection reverts, healing verification |
| `data/outcome-registry.json`  | Nouveaux champs dans les entries                             |
