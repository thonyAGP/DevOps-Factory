# Central Security Scan

## Pourquoi

Les repos privés du plan GitHub Free n'ont ni **Code Scanning** (l'upload SARIF
exige Advanced Security) ni minutes Actions illimitées (quota 2000 min/mois
partagé). Les scans planifiés qui tournaient dans chaque repo privé brûlaient
donc du quota et leurs résultats SARIF étaient perdus silencieusement.

DevOps-Factory étant **public**, ses minutes Actions sont gratuites et
illimitées : les scans hebdomadaires de tous les repos gérés tournent
désormais ici.

## Comment ça marche

`.github/workflows/central-scan.yml` (lundi 5h UTC + manuel) exécute
`pnpm central-scan` :

1. Clone chaque repo de `KNOWN_PROJECTS` avec `FACTORY_PAT` (clone complet,
   pour scanner tout l'historique git).
2. Exécute trois scanners — aucun n'exige d'installer les dépendances du
   projet cible :
   - **gitleaks** — secrets exposés (historique complet)
   - **semgrep** — SAST, OWASP Top 10 + rulesets par stack
   - **trivy fs** — dépendances vulnérables (lockfiles) + misconfigs Dockerfile/IaC
3. Écrit `data/central-scan-latest.json` (dashboard) et
   `data/central-scan-report.md`.
4. Crée une issue consolidée sur la Factory (label `central-scan`) s'il y a
   des findings ; ferme la précédente.

## Répartition avec les workflows par repo

| Où                     | Quoi                                  | Quand             |
| ---------------------- | ------------------------------------- | ----------------- |
| Repo cible (templates) | gitleaks, semgrep, knip, trivy        | Sur PR uniquement |
| Factory (central-scan) | gitleaks (historique), semgrep, trivy | Hebdo             |

Les templates par repo sont _private-aware_ : résultats en commentaire de PR,
job summary et artifact — plus aucune dépendance à l'onglet Security.

## Usage local

```bash
pnpm central-scan -- --dry-run                      # sans issue ni activity log
pnpm central-scan -- --repo thonyAGP/CasaSync       # un seul repo
```

Prérequis locaux : `gh` authentifié + `gitleaks`, `semgrep`, `trivy` dans le
PATH (les scanners absents sont marqués `skipped`).
