# DevOps-Factory - OpenSpec

> Plateforme Node.js/TypeScript de monitoring et self-healing CI pour 25+ repos GitHub.
> Derniere MAJ: 2026-03-23

## Vue d'ensemble

DevOps-Factory scanne automatiquement tous les repos GitHub (thonyAGP), deploie des workflows CI/CD,
monitore la sante des pipelines, et genere des PRs de fix automatiques via un pipeline IA
(Groq/Gemini/Cerebras). 42 patterns CI, cooldown 4h par repo, dashboard HTML statique.

## Architecture

- **Runtime**: Node.js + TypeScript (tsx)
- **CI/CD**: GitHub Actions (24 workflows, crons 4h-12h)
- **IA**: Groq (llama-3.3-70b, primary) → Gemini (fallback) → Cerebras (llama3.1-8b, backup)
- **Registre**: `factory.config.ts` (25 projets) + auto-sync via `sync-registry.ts`
- **Patterns**: `data/patterns.json` (42 patterns CI avec confidence scores)
- **Dashboard**: GitHub Pages statique, rebuild toutes les 4h

## Fonctionnalites

| Feature                     | Status | Script                                       |
| --------------------------- | ------ | -------------------------------------------- |
| Scan & auto-configure repos | OK     | `scan-and-configure.ts`                      |
| Auto-sync registry          | OK     | `sync-registry.ts`                           |
| CI Health Check             | OK     | `ci-health-check.ts`                         |
| Self-heal (AI fix PRs)      | OK     | `self-heal.ts`                               |
| Dashboard HTML              | OK     | `build-dashboard.ts`                         |
| Factory Watchdog            | OK     | `factory-watchdog.ts`                        |
| Dependency Intelligence     | OK     | `dependency-intelligence.ts`                 |
| Quality Score               | OK     | `quality-score.ts`                           |
| Auto-merge conditionnel     | OK     | `self-heal.ts` (tryAutoMerge)                |
| Audit PRs / pattern scoring | OK     | `audit-pr-outcomes.ts`                       |
| Filtre email intelligent    | OK     | `ci-health-check.ts` (shouldAlertForFailure) |
| Outcome registry            | OK     | `outcome-registry.ts`                        |
| State machine repo          | OK     | `factory.config.ts` (healingState)           |

## Taches

### A traiter

### En cours

### Terminees (CHG-001)

- [x] R1: Auto-merge conditionnel dans self-heal.ts (confiance >= 85%, gh --auto --squash)
- [x] R2: Audit PRs fermees (audit-pr-outcomes.ts → data/pattern-scores.json)
- [x] R3: Filtre email intelligent dans ci-health-check.ts (alerte apres 2 cycles / >2h)

### Terminees

- [x] Ajouter LB2I-Fiscal-Manager dans factory.config.ts (2026-03-23)
- [x] Ajouter Zentra dans factory.config.ts (2026-03-23)
- [x] Merger zentra PR #34 (2026-03-23)
- [x] Creer sync-registry.ts pour auto-decouverte repos (2026-03-23)
- [x] Remplacer Claude API (payant) par Groq/Gemini/Cerebras (gratuit) (2026-03-23)
- [x] Ajouter magic-migration dans factory.config.ts (2026-03-23)

## Plans

### Plan actuel

**SWARM Verdict 2026-03-23** - Consensus unanime 5/5 agents

| Niveau          | Actions                                                   | Priorite |
| --------------- | --------------------------------------------------------- | -------- |
| 1 (Immediat)    | LB2I + zentra PR #34 + sync-registry                      | FAIT     |
| 2 (Court terme) | Auto-merge + audit PRs + filtre email + dedup + pre-check | FAIT     |
| 3 (Moyen terme) | Outcome registry + state machine repo                     | FAIT     |

### Historique des plans

- 2026-03-23: SWARM analysis (5 agents, 2 rounds, consensus unanime COMPROMISE)

## Decisions

| Date       | Decision                               | Contexte                                         | Alternatives rejetees                                             |
| ---------- | -------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| 2026-03-23 | IA gratuite (Groq/Cerebras/Gemini)     | Claude API trop cher pour self-heal auto         | Garder Claude API payante                                         |
| 2026-03-23 | Auto-merge conditionnel (pas aveugle)  | SWARM consensus: confiance >85% + delai 10min    | Suspendre self-heal (Avocat), auto-merge total (Pragmatiste)      |
| 2026-03-23 | Sync-registry automatique              | Eliminer ajout manuel de repos                   | Detection manuelle dans factory.config.ts                         |
| 2026-03-23 | Audit 62 PRs = donnees d'apprentissage | SWARM: les PRs fermees sont utiles, pas un echec | Ignorer l'historique (Pragmatiste), suspendre le systeme (Avocat) |

---

## Preferences Projet

| Preference         | Valeur                        | Raison                         |
| ------------------ | ----------------------------- | ------------------------------ |
| IA provider        | Groq (primary)                | Gratuit, rapide, llama-3.3-70b |
| Auto-merge         | Conditionnel (confiance >85%) | Securite: pas de merge aveugle |
| Cooldown self-heal | 4h par repo                   | Eviter spam PRs                |
| Scan interval      | 12h                           | Economie API quota             |

## A Retenir

- Les 62 PRs fermees manuellement = donnees d'apprentissage precieuses
- Zentra a des problemes structurels pre-existants (monorepo typecheck, DATABASE_URL)
- `configureGitAuth` necessaire pour git push dans les deterministic fixers
- Windows: `2>/dev/null` → `NUL` via shell-utils.ts

## Contexte Important

- FACTORY_PAT secret est le token GitHub pour toutes les operations cross-repo
- Le dashboard est sur GitHub Pages: https://thonyagp.github.io/DevOps-Factory/
- Cerebras a change de modele: llama-3.3-70b → llama3.1-8b (deprecation fev 2026)

---

## Changelog

- 2026-03-23 : CHG-002 implemente (outcome registry + state machine repo) - SWARM 3/3 complet
- 2026-03-23 : Dedup + pre-fix + audit filtering (9.5% taux reel, 9 PRs config exclues)
- 2026-03-23 : CHG-001 implemente (auto-merge, audit PRs, filtre email) - typecheck+lint+692 tests OK
- 2026-03-23 : SWARM analysis + implementation Niveau 1 + sync-registry + remplacement IA payante
- 2026-02-18 : Initialisation OpenSpec
