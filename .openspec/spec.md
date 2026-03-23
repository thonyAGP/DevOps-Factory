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

| Feature                     | Status | Script                                             |
| --------------------------- | ------ | -------------------------------------------------- |
| Scan & auto-configure repos | OK     | `scan-and-configure.ts`                            |
| Auto-sync registry          | OK     | `sync-registry.ts`                                 |
| CI Health Check             | OK     | `ci-health-check.ts`                               |
| Self-heal (AI fix PRs)      | OK     | `self-heal.ts`                                     |
| Dashboard HTML              | OK     | `build-dashboard.ts`                               |
| Factory Watchdog            | OK     | `factory-watchdog.ts`                              |
| Dependency Intelligence     | OK     | `dependency-intelligence.ts`                       |
| Quality Score               | OK     | `quality-score.ts`                                 |
| Auto-merge conditionnel     | OK     | `self-heal.ts` (tryAutoMerge)                      |
| Audit PRs / pattern scoring | OK     | `audit-pr-outcomes.ts`                             |
| Filtre email intelligent    | OK     | `ci-health-check.ts` (shouldAlertForFailure)       |
| Outcome registry            | OK     | `outcome-registry.ts`                              |
| State machine repo          | OK     | `factory.config.ts` (healingState)                 |
| Circuit breaker par repo    | OK     | `self-heal.ts` (isCircuitBreakerOpen)              |
| PR body enrichi             | OK     | `self-heal.ts` (createFixPR)                       |
| Feedback loop negatif       | OK     | `outcome-registry.ts` (fix-rejected label)         |
| Causalite outcomes          | OK     | `outcome-registry.ts` (closeReason + reverts)      |
| Healing verification        | OK     | `outcome-registry.ts` (CI check post-merge)        |
| Push notifications          | OK     | `notify.ts` (Discord/Telegram/Slack/webhook)       |
| Cross-repo knowledge graph  | OK     | `knowledge-graph.ts` + `data/knowledge-graph.json` |

## Taches

### A traiter

- [ ] Fix Zentra CI (monorepo typecheck TS6305 + DATABASE_URL) - probleme structurel dans le repo zentra
- [ ] Fix ClubMed CI (monorepo types @clubmed/types manquant) - probleme structurel dans le repo ClubMed

### Terminees (CHG-005)

- [x] R1: Notifications push (Discord/Telegram/Slack/custom webhook) dans self-heal.ts et outcome-registry.ts
- [x] R2: Cross-repo knowledge graph (data/knowledge-graph.json, indexation fixes verifies, lookup avant LLM, cleanup degraded)

### Terminees (CHG-004)

- [x] R1: Causalite outcomes (closeReason: merged/healing_verified/healing_failed/reverted/rejected/manual_close)
- [x] R2: Detection reverts automatique (scan commits "Revert" referençant les PRs mergees)
- [x] R3: Healing verification post-merge (CI check 48h apres merge, healing_verified/healing_failed)
- [x] R4: Penalites differenciees (-15% rejection/revert, -10% healing_failed)
- [x] R5: Backfill legacy entries sans closeReason

### Terminees (CHG-003)

- [x] R1: Circuit breaker par repo (max 3 PRs ouvertes, pause auto du self-heal)
- [x] R2: Corps de PR enrichi (pattern ID, confiance, modele IA, signature, section "Pourquoi ce fix?")
- [x] R3: Feedback loop negatif (label fix-rejected → penalite -15%/rejection sur confiance pattern)

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

**SWARM #2 Verdict 2026-03-23** - Consensus unanime 5/5 agents

| Niveau          | Actions                                                      | Priorite |
| --------------- | ------------------------------------------------------------ | -------- |
| 1 (Immediat)    | Circuit breaker + PR body enrichi + feedback negatif         | FAIT     |
| 2 (Court terme) | Causalite outcomes + healing verification + revert detection | FAIT     |
| 3 (Moyen terme) | Notifications push + knowledge graph cross-repo              | FAIT     |

### Historique des plans

- 2026-03-23: SWARM analysis (5 agents, 2 rounds, consensus unanime COMPROMISE)

## Decisions

| Date       | Decision                               | Contexte                                         | Alternatives rejetees                                             |
| ---------- | -------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| 2026-03-23 | IA gratuite (Groq/Cerebras/Gemini)     | Claude API trop cher pour self-heal auto         | Garder Claude API payante                                         |
| 2026-03-23 | Auto-merge conditionnel (pas aveugle)  | SWARM consensus: confiance >85% + delai 10min    | Suspendre self-heal (Avocat), auto-merge total (Pragmatiste)      |
| 2026-03-23 | Sync-registry automatique              | Eliminer ajout manuel de repos                   | Detection manuelle dans factory.config.ts                         |
| 2026-03-23 | Audit 62 PRs = donnees d'apprentissage | SWARM: les PRs fermees sont utiles, pas un echec | Ignorer l'historique (Pragmatiste), suspendre le systeme (Avocat) |
| 2026-03-23 | Circuit breaker + feedback negatif     | SWARM #2: confiance operationnelle prioritaire   | Event Sourcing Bus (trop lourd), Prediction Engine (premature)    |

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

- 2026-03-23 : CHG-005 implemente (notifications push + knowledge graph cross-repo) - SWARM #2 Niveau 3 complet
- 2026-03-23 : CHG-004 implemente (causalite outcomes + healing verification post-merge) - SWARM #2 Niveau 2 complet
- 2026-03-23 : CHG-003 implemente (circuit breaker + PR body enrichi + feedback negatif) - SWARM #2 Niveau 1 complet
- 2026-03-23 : Auto-promotion SUPERVISED→GRADUATED implementee dans outcome-registry.ts (3+ PRs mergees, 70%+ success rate)
- 2026-03-23 : CHG-002 implemente (outcome registry + state machine repo) - SWARM 3/3 complet
- 2026-03-23 : Dedup + pre-fix + audit filtering (9.5% taux reel, 9 PRs config exclues)
- 2026-03-23 : CHG-001 implemente (auto-merge, audit PRs, filtre email) - typecheck+lint+692 tests OK
- 2026-03-23 : SWARM analysis + implementation Niveau 1 + sync-registry + remplacement IA payante
- 2026-02-18 : Initialisation OpenSpec
