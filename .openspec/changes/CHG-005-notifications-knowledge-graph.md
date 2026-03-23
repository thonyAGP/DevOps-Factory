# CHG-005: Notifications Push + Cross-Repo Knowledge Graph (SWARM Niveau 3)

**Status**: `IMPLEMENTED`
**Date**: 2026-03-23
**Origine**: SWARM analysis #2 - consensus unanime 5/5, niveau 3 moyen terme

## Contexte

Le dev solo ne surveille pas le dashboard GitHub Pages proactivement.
Les LLMs re-inventent la roue a chaque appel pour des patterns deja resolus dans d'autres repos.

## Requirements

### R1: Notifications Push (Webhook configurable)

- Le systeme SHALL supporter un webhook configurable (Discord/Telegram/Slack/custom)
- Le systeme SHALL notifier quand: PR healing creee, auto-merge active, circuit breaker declenche, healing verification echouee
- La config webhook SHALL etre dans factory.config.ts (URL + events actifs)
- Le systeme SHALL formatter les messages avec contexte (repo, pattern, confiance, lien PR)
- En absence de webhook configure, le systeme SHALL fonctionner silencieusement (pas de crash)

### R2: Cross-Repo Knowledge Graph

- Le systeme SHALL maintenir un fichier `data/knowledge-graph.json` persistant les fixes valides
- Chaque fix merge avec healing_verified SHALL etre indexe par: stack, pattern, fichiers touches
- Avant d'appeler un LLM, self-heal.ts SHALL chercher dans le knowledge graph un fix similaire
- Si un fix du graph matche (meme pattern + meme stack), le systeme SHALL l'appliquer directement sans appel LLM
- Le knowledge graph SHALL etre nettoye des entries dont le pattern a ete degrade sous 0.3

## Impact Analysis

| Fichier                       | Modification                                         |
| ----------------------------- | ---------------------------------------------------- |
| `factory.config.ts`           | Ajouter WebhookConfig                                |
| `scripts/notify.ts`           | NOUVEAU - webhook notifications                      |
| `scripts/self-heal.ts`        | Appeler notify + consulter knowledge graph avant LLM |
| `scripts/outcome-registry.ts` | Alimenter le knowledge graph apres healing_verified  |
| `data/knowledge-graph.json`   | NOUVEAU - fixes indexes par stack/pattern            |
