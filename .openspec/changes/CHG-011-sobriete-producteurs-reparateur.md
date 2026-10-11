# CHG-011: Un seul producteur de PR, des issues sobres, un garde de marque sûr

**Status**: `IMPLEMENTED`
**Date**: 2026-10-11
**Origine**: Plan d'intégration proactive du 11/10/2026 (`DevOps/Platform/PROPOSITION-INTEGRATION-2026-10-11.md`), lots B3 et D2. Doctrine `rules/assistance-proactive.md` : une remontée porte une action préparée ou un blocage nommé, jamais une tâche nue.
**Chantier**: `.chantier/2026-10-08-watchdog-silence/` (watchdog) ; livraison du 11/10 par agent, rejouée par le pilote.

## Contexte

Mesure sur 60 jours (10/08 → 10/10) : 688 issues créées par les workflows, dont 584 « DevOps Report » fermées puis recréées à chaque build du tableau de bord (toutes les 3 h). Le daemon Ecosystem-Agent produisait en parallèle des correctifs orphelins (5 129 en attente, purgés). Branding Guard rouge depuis le 07/07 (96 échecs : `fatal: empty ident name`), Renovate rouge depuis le 28/08 (44 échecs : `platform-unknown-error` sur trois dépôts supprimés). 820 issues automatiques fermées le 11/10 (0 échec).

## Objectif

Le dépôt ne produit plus de bruit : une alerte d'exploitation devient une PR préparée (routine « réparateur »), les rapports vivent dans `data/` ou dans une issue unique, et aucun workflow ne pousse de réécriture ambiguë sur un dépôt tiers.

## Requirements

- Le système SHALL créer l'issue « DevOps Report » uniquement depuis `daily-report.yml` (`DAILY_REPORT_ISSUE=true`) ; `dashboard-build.yml` MUST NOT en créer.
- `code-guard.yml` SHALL ignorer les pushes du propriétaire et de l'App Factory en comparant `github.actor` (non falsifiable), jamais le nom d'auteur git.
- Le Branding Guard SHALL configurer une identité git `--global` (les clones vivent sous `$RUNNER_TEMP`), SHALL signaler sans réécrire toute expression ambiguë (« AI-generated » dans un prompt ou une description), MUST NOT committer quand rien n'est retiré, SHALL offrir `--dry-run`, et SHALL isoler l'erreur d'un dépôt (scan des autres poursuivi, code de sortie 1).
- Le registre `KNOWN_PROJECTS` MUST NOT référencer un dépôt qui n'existe plus (Benchmark_Claude, RemoteDevDashboard, ClaudePilot retirés) ; la configuration Renovate générée SHALL ne contenir que des dépôts vérifiés.
- La routine « réparateur » (`docs/routines/reparateur.md`, source versionnée) SHALL ouvrir au plus une PR par passage, sur une branche `reparateur/<slug>`, en REST seulement, sans toucher aux issues, secrets, rulesets ni à `master` ; elle SHALL s'arrêter sans écrire quand rien n'est rouge.

### Scénarios

- GIVEN un dépôt cible où « AI-generated » apparaît dans un prompt LLM, WHEN le garde tourne, THEN la ligne est listée « kept for manual review » et aucun commit n'est poussé.
- GIVEN le build du tableau de bord déclenché par `workflow_run`, WHEN il se termine, THEN aucune issue « DevOps Report » n'est créée ni fermée.
- GIVEN un push de `thonyAGP` sur master, WHEN `code-guard` s'exécute, THEN aucune issue « Direct push » n'est ouverte.

## Impact

- `.github/workflows/ai-branding-guard.yml`, `code-guard.yml`, `daily-report.yml` ; `scripts/ai-branding-guard.ts` (+ tests), `scripts/dashboard/index.ts`, `factory.config.ts` ; `docs/routines/reparateur.md` (nouveau).
- Hors dépôt : routine claude.ai « DevOps-Factory - réparateur » créée désactivée (première passe à la main) ; daemon Ecosystem-Agent : scanners et fixers coupés (`ECOSYSTEM_DISABLE_SCANNERS=1`, commit local a5330f7).

## Acceptance

- [x] `pnpm typecheck` 0, `pnpm lint` 0 erreur, `pnpm test` 37 fichiers / 954 passés, prettier OK (pilote, 11/10).
- [x] Run Branding Guard 38120921692 : vert, « 0 fixes in 0 repo(s), 19 clean, 0 error(s) », CasaSync « kept for manual review ».
- [ ] Run Renovate 38120923251 : plus de `platform-unknown-error` (à lire).
- [ ] Première passe de la routine réparateur lue et conforme à la checklist de `docs/routines/reparateur.md`, puis `enabled: true`.
- [ ] Propositions non appliquées (cron-monitor, factory-watchdog, dependency-intelligence, branch-protection-audit, central-scan, weekly-veille : issue unique mise à jour ou `data/` seul) : décision d'Anthony.

## Décisions pour Anthony

- Retirer ou non `Repository admin` du contournement du ruleset `master-protection` (sinon une routine qui pousse sous son identité n'est retenue que par le prompt).
- Corriger ou non les slugs `lecteur-magic` / `magic-migration` (redirigent vers `LecteurMagic`, ignoré par Renovate ; le corriger lance PR et automerges sur ce gros dépôt).
- Renovate 42.99.0 « unsupported » dans les journaux : monter de version.
