# CHG-007: Knowledge Brain - REVERTED

**Status**: `REVERTED`
**Date**: 2026-04-16 (created) → 2026-04-16 (archived) → 2026-04-16 (reverted)
**Commits d'origine**: `dc487349` (feat), `eb322285` (docs)
**Commits de revert**: `0257aff9` (revert feat), `6c26915c` (revert docs)

## Motif du revert

Apres livraison de la V1 (37 projets / 14316 fichiers / 186209 chunks indexes, MCP enregistre, query P95 6.88ms), feedback explicite du proprietaire :

> "ce n'est surtout pas ce que je voulais. Je t'ai demande quelque chose qui m'aide a construire les nouveaux projets, mutualiser, apprendre de mes erreurs, rendre la conception des projets plus efficace. Tu m'avais propose un systeme qui analysait mes projets, trouvait les dettes, etait proactif sur les fix. Et la tu m'as fait un stockage des projets centralise. C'est de la merde car pas le sujet."

Verdict : **hors-sujet**. Le besoin reel est :

1. Aider a la **conception** de nouveaux projets (scaffolding informe des learnings passes).
2. **Mutualiser** patterns, configs, skills entre projets.
3. **Apprendre des erreurs** passees (detection de patterns recurrents, anti-patterns).
4. **Proactivite** : detecter la dette et proposer des fixes automatiques (equivalent self-heal mais pour qualite/architecture, pas juste CI).

La V1 livree ne couvrait que le stockage / recherche lexicale, sans aucune brique d'analyse ni de proactivite. 95 % du code etait structurellement inadapte au besoin (indexation passive vs pipeline actif d'analyse/fix).

## Actions de revert (executees 2026-04-16)

| Action                                                  | Resultat                                          |
| ------------------------------------------------------- | ------------------------------------------------- |
| `git revert eb322285 dc487349`                          | OK (2 commits reverts crees : 0257aff9, 6c26915c) |
| Deregistrer `brain` de `~/.claude/.mcp.json`            | OK (backup `.bak.r6` restaure)                    |
| Supprimer hook `.husky/post-commit` dans DevOps-Factory | OK (fichier untracked supprime)                   |
| Supprimer artefacts residuels `packages/brain/data/`    | OK                                                |
| Statut CHG-007 : `ARCHIVED` → `REVERTED`                | OK (ce fichier)                                   |

## Decisions conservees malgre le revert

- Aucune. Le pnpm workspace, le scaffold, le MCP, la SQLite FTS5, les hooks : tout est retire.
- CHG-008 (a rediger) repartira d'une feuille blanche et choisira son architecture en fonction du besoin reel clarifie.

## Pointeur vers la suite

**CHG-008** (a creer) doit couvrir :

- Orchestrateur au-dessus des skills `CM_*` existantes (`CM_debt-tracker`, `CM_project-health`, `CM_sync-ecosystem`, `CM_knowledge-harvest`, `CM_scaffold`, `CM_spec-to-code`, `CM_review-loop`, `CM_ticket-autopilot`).
- Pattern mining cross-projets (bugs recurrents, anti-patterns, deps toxiques).
- Scaffolding informe des learnings (ce qui a marche / echoue sur les 37 projets existants).
- Boucle de feedback proactive (PRs automatiques pour derive qualite / architecture, analogue self-heal).
- Format de sortie hebdomadaire a aligner (mail / dashboard / PRs / rapport HTML) - **a clarifier avec le proprietaire avant toute implementation**.

## Lecons a retenir

1. **Avant de coder, valider la definition du besoin**. "Knowledge" etait ambigu : stockage vs analyse proactive. Un SWARM ou un round EPADE en amont aurait evite la derive.
2. **Les 37 projets ne manquent pas d'indexation**, ils manquent d'un **mecanisme d'analyse + action** qui consomme l'information deja disponible (via grep, AST, git log, tests, deps).
3. Les skills `CM_*` existantes couvrent deja 80 % du besoin proactif. CHG-008 = **orchestrateur + boucle**, pas **nouveau stockage**.
