# Autonomous Remediation (saut #3)

Le modèle **agent éphémère déclenché par événement**, pas la session persistante.
La Factory (état durable) sélectionne les repos les plus mal notés dans le
registre de sécurité (état durable) et lance, pour chacun, un agent de codage
**court** qui corrige et ouvre une PR — puis meurt. Aucune session résidente.

```
security-registry.json ──► remediation-dispatch ──► gh workflow run ai-remediation.yml
   (état durable)              (Factory, quota)         (repo cible, agent éphémère)
                                                              │
                                                    lit l'issue central-scan
                                                    corrige → PR → exit
```

## Garde-fous (fail-closed)

Rien ne part tant que tout n'est pas explicitement autorisé :

- `REMEDIATION_CONFIG.enabled` = `false` par défaut → le dispatcher est un no-op
- `enabledRepos` vide par défaut → **allowlist** : seuls les repos listés sont éligibles
- `minGrade` (`F` par défaut) → seuls les repos assez mal notés qualifient
- **quota journalier** (`maxPerDay`, 2) → borne le nombre d'agents lancés/jour
- l'agent cible est lui-même borné : `max_turns`, `allowed_tools`, prompt à
  périmètre serré (jamais de secrets, jamais de refactor/majeure, tests
  obligatoires, une seule PR)

La logique de sélection est une **fonction pure testée** (`selectRemediationTargets`).

## Activation (opt-in explicite)

1. Dans chaque repo cible : secret `ANTHROPIC_API_KEY` + le workflow
   `ai-remediation.yml` (déployé via `redeploy-templates` ou `scan-and-configure`).
2. Dans `factory.config.ts` → `REMEDIATION_CONFIG` : `enabled: true` et ajouter
   les repos dans `enabledRepos` (commencez par **un seul**).
3. Onglet Actions → **Remediation Dispatch** → Run workflow. Laissez
   `dry_run: true` d'abord pour voir les cibles sélectionnées, puis `false`.

Aucun cron n'est configuré : le dispatch reste manuel tant que la boucle n'est
pas éprouvée. Le passage à un cron (quotidien) est un changement d'une ligne
une fois la confiance établie.

## Usage local

```bash
pnpm remediation-dispatch -- --dry-run   # liste les cibles sans rien lancer
```
