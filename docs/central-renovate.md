# Central Renovate

## Pourquoi

~400 vulnérabilités CRITICAL/HIGH de dépendances détectées par le scan
central, et aucun repo n'avait Renovate. L'app Mend nécessiterait une
installation + un `renovate.json` par repo ; à la place, **Renovate tourne en
self-hosted depuis la Factory** (repo public = minutes Actions gratuites)
avec `FACTORY_PAT`, contre tous les repos de `KNOWN_PROJECTS`.

## Comment ça marche

`.github/workflows/renovate.yml` (quotidien 6h UTC + manuel) :

1. `pnpm renovate-config` (`scripts/central-renovate.ts`) génère la config
   globale : liste des repos depuis `factory.config.ts` + défauts hérités de
   `templates/renovate.json` (groupes, automerge, plafonds de PRs).
2. `npx renovate` traite chaque repo et ouvre les PRs de mise à jour.

Points clés :

- **Sécurité d'abord** : `osvVulnerabilityAlerts` (base OSV, indépendante des
  alertes Dependabot) — les PRs de vulnérabilités ignorent les plannings et
  s'automergent (`vulnerabilityAlerts.automerge: true`).
- **Quota-friendly** : mises à jour non-majeures groupées en une PR par repo
  (planifiées le week-end), patchs devDependencies en automerge branche,
  `prConcurrentLimit: 5` / `prHourlyLimit: 2` — la CI des repos privés n'est
  pas noyée.
- **Majeures** : jamais d'automerge, label `breaking`, revue manuelle.
- Un `renovate.json` présent dans un repo **prend le dessus** sur les défauts
  (`requireConfig: optional`, onboarding désactivé).
- Le quality score accorde `depsUpToDate` à tous les repos couverts
  (`CENTRAL_RENOVATE_ENABLED`).

## Usage local

```bash
pnpm renovate-config -- --out /tmp/renovate-config.json  # inspecter la config générée
```
