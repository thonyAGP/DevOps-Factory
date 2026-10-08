# DevOps-Factory - OpenSpec

> Plateforme Node.js/TypeScript de monitoring et self-healing CI pour 25+ repos GitHub.
> Derniere MAJ: 2026-03-24

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
| Self-heal (AI fix PRs)      | OK     | `scripts/self-heal/index.ts` (13 modules)          |
| Dashboard HTML              | OK     | `scripts/dashboard/index.ts` (17 modules)          |
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

- [ ] Fix Zentra CI (monorepo typecheck TS6305 + DATABASE_URL) - probleme structurel, healingState=paused
- [ ] Fix ClubMed CI (monorepo types @clubmed/types manquant) - probleme structurel, healingState=paused

### Terminees (CHG-006 - Notification Cleanup)

- [x] R1: Repos non-fixables en healingState='paused' (Zentra, ClubMed) - self-heal les ignore
- [x] R2: Self-heal ne cree plus d'issues GitHub (createIssue/createEscalationIssue → log console)
- [x] R3: CI health check ne cree plus d'issues individuelles (log + activity tracker)
- [x] R4: cron-monitor.yml skip cascade (Factory Watchdog, Uptime Monitor, Build Dashboard)
- [x] R5: Dashboard self-heal triggers reduit de 3 a 1 par cycle

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

### Terminees (Plan APEX 2026-03-24)

- [x] S1: Modulariser self-heal.ts (2617 lignes → 13 modules dans scripts/self-heal/)
- [x] M4: Tests self-heal modules (103 tests: pattern-db, cooldown, error-analysis)
- [x] M2: GraphQL batch file checks (github-file-checker.ts, 97% reduction REST calls)
- [x] S4: Template parameterization (23 templates, {{nodeVersion}}/{{pnpmVersion}}/{{dotnetVersion}}, .devops-config.json per repo)
- [x] M3: logActivity dans 12 scripts (ActivitySource etendu de 7→22 sources, ~40 logActivity ajoutes)
- [x] S2: Modulariser build-dashboard.ts (1964 lignes → 17 modules dans scripts/dashboard/)
- [x] Email digest: batch triggers, rate-limited comments, daily digest issues, daily digest email

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

- 2026-03-24: Plan APEX refactoring (S1, S2, M2, M3, M4, S4) - en cours
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

- 2026-04-17 : CHG-010 `DRAFT` - Ecosystem Agent **V3** plan (8 phases). Axes : Intelligence (trends, auto-fix debt etendu, CI gate, MCP V2), Visibilite (notifications Slack/Discord/email, dashboard WebSocket), Portabilite (multi-machine sync, Linux/WSL). Voir `.openspec/changes/CHG-010-ecosystem-agent-v3.md`.
- 2026-04-17 : CHG-009 `ARCHIVED` - Ecosystem Agent **V2 DELIVERED**. 4 phases livrees : V2-P1 service Windows auto-boot (`678f7a3`), V2-P2 tray icon + notifications (`b79aacf`), V2-P3 FTS5 knowledge search + health score divergences (`10cb28d`), V2-P4 auto-fix low-risk configsync/deps patches (`a6b3624`).
- 2026-04-17 : CHG-008 `ARCHIVED` - **V1 DELIVERED**. Phase 6 acceptance `smoke-acceptance-v1.sh` : 29/29 criteres PASS (24 projets, 1661 debts, 57 divergences, 59 patterns, 75 fixes, 7 MCP tools, 8 pages web, scaffold OK, register-mcp OK). DB 13.9MB / 35768 fichiers. Commit `f339031`.
- 2026-04-17 : CHG-008 `IMPLEMENTING` - Phase 5 livree dans `DevOps/Ecosystem-Agent` (commit `35f207b`) : MCP Server stdio 7 outils (`ecosystem_health`, `ecosystem_debt`, `ecosystem_divergence`, `ecosystem_recurring_issues`, `ecosystem_similar`, `ecosystem_scaffold`, `ecosystem_knowledge`) + Scaffold Advisor (`POST /api/scaffold` + page `/scaffold` + table `scaffold_history`) + `register-mcp.ps1`. 6 decisions figees Phase 5 (#34-39).
- 2026-04-17 : CHG-008 `IMPLEMENTING` - Phase 4c livree dans `DevOps/Ecosystem-Agent` (commit `7e166bf`) : DebtFixer scanner lit DebtRecords actifs pour 4 types auto-fixables (any→unknown, console.log→suppression, test.skip→revert, test.only→revert) + push worker etendu (3 types: configsync, deps_upgrade, debt) + scheduler 24h + stagger +120s + `POST /api/scans/run?kind=debt-fixer` + UI bouton "Refresh DebtFixer" + card last scan. 4 decisions figees Phase 4c (#30-33). Prochaine phase : 5 (Scaffold Advisor + MCP Server).
- 2026-04-17 : CHG-008 `IMPLEMENTING` - Phase 4b.2 livree dans `DevOps/Ecosystem-Agent` (commit `63558a4`) : DepsUpgradeFixer scanner `npm outdated --json` par projet (timeout 30s, patches+minors only, majors exclus V1) + push worker etendu `deps_upgrade` (parse diff → modify package.json → `pnpm install --lockfile-only` → commit lockfile) + scheduler 24h + stagger +90s + `POST /api/scans/run?kind=deps-upgrade` + `/health` enrichi + UI bouton "Refresh DepsUpgrade" + card last scan. 4 decisions figees Phase 4b.2 (#26-29). Prochaine phase : 4c (DebtFixer).
- 2026-04-17 : CHG-008 `IMPLEMENTING` - Phase 4b.1 livree dans `DevOps/Ecosystem-Agent` (commit `79b38ac`) : push worker `pushApprovedFixes` avec 8 safety gates (git repo, toplevel match, github remote, clean tree, branch conflict, gh auth, applicable fixes, type implemented) + dry-run mode + `git-utils.ts` wrappers safe (execFileSync shell:false) + `POST /api/fixes/push` endpoint + composant PushButton (Preview/Push approved) dans section "Approved (awaiting push)" de `/fixes` + ESLint flat config natif (`eslint-config-next@16`, remplace `next lint` deprecie) + auto-fix import/order 15 fichiers. 5 decisions figees Phase 4b.1 (#21-25). Prochaine phase : 4b.2 (DepsUpgradeFixer patches+minors).
- 2026-04-16 : CHG-008 `IMPLEMENTING` - Phase 4a livree dans `DevOps/Ecosystem-Agent` (commit `e8944dd`) : ConfigSyncFixer DRY-RUN + queue de validation UI. 5 decisions figees Phase 4a : (16) decoupage 4a/4b/4c (4a = infra + ConfigSync DRY-RUN strict, aucune ecriture ni git), (17) mode push = PR via `gh pr create` sur branche dediee `ecosystem-agent/configsync-{yyyy-mm-dd}` reportee en 4b, (18) diff unifie stocke en colonne TEXT via generateur LCS zero-dep single-hunk, (19) `replacePendingFixes` preserve approved/rejected/pushed + supprime stale pending + upsert seulement si `status='pending'` (signature `sha1(configsync|projectPath|targetFile)` = idempotence stable), (20) page `/fixes` = pending + approved sections, expand diff inline, approve 409-si-already-approved, reject 409-si-pushed, stats 4 statuts. Nouvelle table `fixes_queue(id, project_id, type, title, description, target_file, diff TEXT, signature, status, pushed_ref, scanner, created_at, updated_at)` avec UNIQUE(project_id, type, signature) + 4 indexes ; ConfigSyncFixer compare 5 canoniques par stack (nextjs : tsconfig.nextjs.json / eslint.nextjs.config.mjs / vitest.nextjs.config.ts / vitest.setup.ts / commitlint.config.js ; node : tsconfig.backend.json / eslint.backend.config.mjs / vitest.config.ts / ...) contre `~/.claude/templates/configs/` ; scheduler `runConfigsyncNow` + cadence 24h + mutex + meta `last_configsync_scan_at`/`_ms`/`_inserted`/`_updated`/`_deleted` ; `/health` enrichi ; `POST /api/scans/run?kind=configsync|fix|all` ; 5 endpoints `/api/fixes` (list+stats+detail+approve+reject) ; page `/fixes` Suspense + 4 StatCards + 2 sections FixesTable + composant expandable avec boutons approve/reject contextuels ; 5e card "Last configsync scan" sur Overview ; nav 7e lien Fixes icone Wrench ; smoke-phase4a valide 25 fixes indexes en 12ms, round-trip approve+reject+409 double-approve, idempotence re-scan (scheduler log `skipped=2` = approved+rejected preserves), `/fixes` 200 + nav 7 links ; `pnpm typecheck` OK 5 packages. Prochaine phase : 4b (DepsUpgradeFixer + push worker `gh pr create`).
- 2026-04-16 : CHG-008 `IMPLEMENTING` - Phase 3c livree dans `DevOps/Ecosystem-Agent` (commit `5e97f86`) : PatternMiner via `git log` (execFileSync, separateurs `\x1f`/`\x1e`, fenetre 90 jours, cap 2000 commits/projet) + categorisation first-match-wins sur 12 categories regex (security > auth > db > api > build > test > deploy > perf > config > docs > refactor > fix) + thresholds `recurrent_fix` (3+ commits meme categorie/projet) et `cross_project_trend` (2+ projets avec 2+ commits chacun). Decisions figees Phase 3c : (13) fenetre 90j + cap 2000, separateurs ASCII non-printables pour parsing robuste, (14) seuils bas V1 (3/2+2) adaptes a ecosysteme petit 37 projets, ajustables via options miner, (15) table `patterns` avec `project_id=NULL` pour cross-project + alias `?project=cross` dans API evite ambiguite vs absence de filtre, signature sha1-16chars pour idempotence. Nouvelle table `patterns(project_id, category, kind, occurrences, first_seen, last_seen, projects JSON, samples JSON, signature, scanner, detected_at)` idempotente via DELETE WHERE scanner + INSERT tx ; scheduler `runPatternNow` + cadence daily + initialDelay+30s ; meta `last_pattern_scan_at`/`_ms`/`_inserted`/`_recurrent`/`_cross` ; `GET /api/patterns?project=&category=&kind=&limit=` + `POST /api/scans/run?kind=pattern|all` ; page `/patterns` Suspense + useSearchParams + 4 StatCards + 2 sections filtered tables + 12 tone classes badges + nav icone Activity ; smoke-phase3c-real sur `D:/Projects/DevOps` (5 repos git reels) valide 7 `recurrent_fix` detectes en 85ms (2000 commits DevOps-Factory -> 46 categorises docs/test, 5 Ecosystem-Agent -> 1 categorise) ; `pnpm typecheck` OK 5 packages, `pnpm build` OK 7 routes. Prochaine phase : 4 (Fixers ConfigSync/DepsUpgrade/Debt + queue PRs + UI validation).
- 2026-04-16 : CHG-008 `IMPLEMENTING` - Phase 3b livree dans `DevOps/Ecosystem-Agent` (commit `d6ba799`) : ArchitectureInspector avec 3 sub-scanners (stack = detection language TS/JS/C#/Python + framework.web next/react/vue/svelte/angular/astro + framework.api fastify/nestjs/express/koa/hono + ORM prisma/drizzle/typeorm/mongoose/kysely + test.runner vitest/jest/mocha ; conventions = pkg.manager pnpm/yarn/npm + lint.eslint/prettier/editorconfig + hooks.husky/lint_staged + ts.strict ; structure = README/LICENSE/CI GitHub Actions/GitLab/Azure/Bitbucket). Decisions figees Phase 3b : (10) nouvelle table `architecture_facts(project_id, scanner, key, value, detected_at)` idempotente via DELETE+INSERT par scanner, (11) manques no_license/no_readme/no_ci stockes dans table `debts` severite `low` (coherent avec no_tests 3a, actionnables via Fixers Phase 4), (12) enrichir page Projects existante plutot que nouvelle page /architecture. Scheduler `runArchitectureNow` + cadence 6h ; meta `last_architecture_scan_at`/`last_architecture_scan_ms`/`last_architecture_scan_facts`/`last_architecture_scan_debts` ; `GET /api/architecture?project=&scanner=` + `POST /api/scans/run?kind=architecture|all` ; page `/projects` enrichie (colonnes Stack + Pkg + badges README/LICENSE/CI vert/rouge + bouton "Refresh architecture") ; smoke-phase3b valide 62 facts indexes + 15 structure-debts sur 5 packages internes, `fastify 5.0.0` detecte correctement, scan `all` complet en 28ms. Prochaine phase : 3c PatternMiner (git log + regex categories + recurrence).
- 2026-04-16 : CHG-008 `IMPLEMENTING` - Phase 3a livree dans `DevOps/Ecosystem-Agent` (commit `06ced59`) : RiskScanner avec 3 passes (tests-missing = detection projets source sans tests, large-files > 100KB avec exclusions medias/docs/lockfiles, deps-cve = `npm audit --json` read-only via lockfile sans install) ; scheduler riskIntervalMs 24h + initialDelay+120s pour eviter burst npm registry au boot ; `/api/scans/run?kind=` etendu (debt|divergence|risk|risk-offline|both|all) ; `/health` expose `last_risk_scan_at` ; nouvelle page `/risks` avec 4 StatCards (tests missing / large files / CVE findings / critical CVEs) + 3 sections DebtsTable filtrees par type + bouton "Check deps now" (kind=risk) + bouton "Scan risk (offline)" (kind=risk-offline) ; lien Risks dans nav ; overview affiche "Last risk scan" ; types etendus (`large_file` dans DebtType, `no_tests`/`large_file`/`dep_cve`/`dep_outdated` dans dropdown DebtsTable) ; smoke-phase3a valide scan offline <5ms, 5 kinds scan 200 OK, 3 endpoints /api/debts?type risk 200, page /risks render 200, nav contient Risks ; `pnpm typecheck` + `pnpm build` OK 6 routes. Prochaine phase : 3b ArchitectureInspector.
- 2026-04-16 : CHG-008 `IMPLEMENTING` - Phase 3 decoupee en 3a/3b/3c. Decisions figees : (7) phases separees RiskScanner d'abord, (8) PatternMiner = regex+categorisation mot-cle (auth/db/api/build/test/deploy), (9) npm audit daily + bouton UI "Check deps now". Phase 3a en cours : RiskScanner (deps-cve via npm audit + large-files > 100KB + tests-missing) + API `/api/risks` + page Risks.
- 2026-04-16 : CHG-008 `IMPLEMENTING` - Phase 2 livree dans `DevOps/Ecosystem-Agent` (commit `50013ad`) : dashboard Next.js 15 App Router sur `localhost:3201` + Tailwind 3 dark + lucide-react + SWR polling 30s ; 4 pages (Overview/Projects/Debts/Divergences) avec filtres type+severity ; proxy Next `/api/*` → Fastify `127.0.0.1:3200/api/*` (same-origin) ; bouton "Scan now" POST `/api/scans/run` + revalidate SWR ; smoke-phase2 valide 9 endpoints 200 OK (4 HTML + 5 API) ; `pnpm typecheck` OK 5 packages, `pnpm build` OK 5 routes ; bloc ports 3200-3209 enregistre dans `DevServices/services.json`. Prochaine phase : Scanners Risk + PatternMiner + ArchitectureInspector.
- 2026-04-16 : CHG-008 `IMPLEMENTING` - Phase 1 livree dans `DevOps/Ecosystem-Agent` (commit `d70325e`) : scanners code-debt (TODO/FIXME/HACK/XXX/any/test.skip/test.only/console.log) + secret-leak (aws/github/slack/rsa/jwt/dsn, severite critical, valeur redacted) + config-drift (tsconfig/eslint/prettier/editorconfig vs `~/.claude/templates/configs/`) + scheduler setInterval+mutex (debt 15min, divergence 1h) + endpoint `/api/divergences` + `POST /api/scans/run` ; smoke-phase1 valide 13 dettes + 48 divergences detectees sur Ecosystem-Agent en <20ms, 7 endpoints 200 OK. Prochaine phase : Dashboard Next.js.
- 2026-04-16 : CHG-008 `IMPLEMENTING` - Phase 0 livree dans `DevOps/Ecosystem-Agent` (commit `968b357`) : monorepo pnpm + SQLite (better-sqlite3) + daemon chokidar + server Fastify (4 endpoints 200 OK sur `127.0.0.1:3200`, 24 projets decouverts) + scripts service Windows (install/uninstall via node-windows). Prochaine phase : scanners Debt + Divergence.
- 2026-04-16 : CHG-008 `APPROVED` - Ecosystem Agent (Dashboard localhost:3200 + Daemon Service Windows + MCP). 6 decisions figees (stack Fastify/Next.js/SQLite, node-windows service, scan 15min/1h/daily, seuils critiques secrets+CVE+CI48h+dette, ConfigSync auto-push, loc `DevOps/Ecosystem-Agent`). Voir `.openspec/changes/CHG-008-ecosystem-agent.md`.
- 2026-04-16 : CHG-007 Knowledge Brain **REVERTED** (commits dc487349, eb322285 reverts via 0257aff9, 6c26915c). Produit livre = stockage indexation cross-projets, mais hors-sujet du besoin reel (aide conception / mutualisation / dette proactive). Voir `.openspec/changes/CHG-007-knowledge-brain-semantic-search.md` (note de revert).
- 2026-03-24 : M3 logActivity - ActivitySource 7→22, ~40 logActivity dans 12 scripts (self-heal, outcome-registry, migration-tracker, ci-health, factory-watchdog, audit-pr, weekly-veille, etc.)
- 2026-03-24 : S4 template parameterization - template-config.ts, 23 templates with {{placeholders}}, .devops-config.json per-repo, scan-and-configure + redeploy-templates integrated
- 2026-03-24 : CHG-006 notification cleanup - healingState paused, self-heal/ci-health issues → logs, cron-monitor cascade fix, dashboard triggers 3→1
- 2026-03-24 : M2 GraphQL batch file checks - github-file-checker.ts, scan-and-configure + sync-registry refactored
- 2026-03-24 : Plan APEX - S1 (self-heal 13 modules), M4 (103 tests), S2 (dashboard 17 modules), email digest fix - 795 tests OK
- 2026-03-23 : CHG-005 implemente (notifications push + knowledge graph cross-repo) - SWARM #2 Niveau 3 complet
- 2026-03-23 : CHG-004 implemente (causalite outcomes + healing verification post-merge) - SWARM #2 Niveau 2 complet
- 2026-03-23 : CHG-003 implemente (circuit breaker + PR body enrichi + feedback negatif) - SWARM #2 Niveau 1 complet
- 2026-03-23 : Auto-promotion SUPERVISED→GRADUATED implementee dans outcome-registry.ts (3+ PRs mergees, 70%+ success rate)
- 2026-03-23 : CHG-002 implemente (outcome registry + state machine repo) - SWARM 3/3 complet
- 2026-03-23 : Dedup + pre-fix + audit filtering (9.5% taux reel, 9 PRs config exclues)
- 2026-03-23 : CHG-001 implemente (auto-merge, audit PRs, filtre email) - typecheck+lint+692 tests OK
- 2026-03-23 : SWARM analysis + implementation Niveau 1 + sync-registry + remplacement IA payante
- 2026-02-18 : Initialisation OpenSpec
