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

## Le moteur LLM : token d'abonnement (sans clé API)

L'agent tourne via `anthropics/claude-code-action` authentifié par un **token
OAuth d'abonnement** (`claude_code_oauth_token`) — pas de clé API, donc **aucune
facturation à l'usage** : la conso passe par le quota de l'abonnement Claude
(Pro/Max). Le pire cas est un rate-limit, jamais une facture. (TOS : ce token
n'est autorisé que pour Claude Code / `claude-code-action`, pas pour l'Agent
SDK.)

Générer le token une fois, avec **ton** compte perso :

```bash
claude /logout        # si le CLI est logué sur un autre compte
claude setup-token    # flux OAuth navigateur → copie le sk-ant-oat01-…
```

## Activation (opt-in explicite)

1. **App Claude** : installe-la **une fois** sur _All repositories_
   (github.com/apps/claude) — elle donne les permissions repo. Pas de répétition
   par repo.
2. **Secret sur les repos cibles** : `CLAUDE_CODE_OAUTH_TOKEN`. Plutôt que de
   cliquer 25 fois, distribue-le en masse (localement, `gh` authentifié) :
   ```bash
   export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
   pnpm distribute-remediation-secret            # tous les repos gérés
   pnpm distribute-remediation-secret -- --only lecteur-magic   # ou un sous-ensemble
   ```
   Le secret est **inerte** tant que le repo n'est pas dans l'allowlist + n'a pas
   le workflow — le distribuer largement est sans risque.
3. **Workflow agent** : `ai-remediation.yml` déployé via `redeploy-templates`
   (ou `scan-and-configure`).
4. **`factory.config.ts` → `REMEDIATION_CONFIG`** : `enabled: true` + ajouter les
   repos dans `enabledRepos` (commencez par **un seul**).
5. Onglet Actions → **Remediation Dispatch** → Run workflow. Laissez
   `dry_run: true` d'abord pour voir les cibles sélectionnées, puis `false`.

Aucun cron n'est configuré : le dispatch reste manuel tant que la boucle n'est
pas éprouvée. Le passage à un cron (quotidien) est un changement d'une ligne
une fois la confiance établie.

## Usage local

```bash
pnpm remediation-dispatch -- --dry-run   # liste les cibles sans rien lancer
```
