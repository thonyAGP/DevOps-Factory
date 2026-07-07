# Central Security Scan - 2026-07-07

Scans centralisés exécutés depuis DevOps-Factory (repo public = minutes gratuites). Les repos privés du plan Free n'ont ni Code Scanning ni quota Actions illimité.

**Total findings: 704** sur 25 repos _(sécurité uniquement — la duplication est mesurée en %, pas comptée ici)_

| Repo | Secrets (gitleaks) | SAST (semgrep) | Deps/Config (trivy) | Duplication (jscpd) |
|------|--------------------|----------------|---------------------|---------------------|
| DevOps-Factory | ⏭️ | 🔴 12 | 🔴 4 | 🔴 9.35% |
| Email_Assistant | 🔴 1 | 🔴 28 | 🔴 51 | 🔴 17.82% |
| ClubMedRoomAssignment | 🟢 0 | 🔴 15 | 🔴 54 | 🔴 3.28% |
| CasaSync | 🔴 13 | 🔴 15 | 🔴 4 | 🔴 4.46% |
| Livret_accueil_Au-Marais | 🔴 2 | 🔴 10 | 🔴 8 | 🔴 5.68% |
| Site_Au-marais | 🔴 2 | 🔴 11 | 🔴 20 | 🔴 13.84% |
| Lecteur_Magic | 🔴 4 | 🔴 19 | 🔴 48 | 🔴 10.85% |
| API_Claude | 🟢 0 | 🔴 9 | 🟢 0 | 🔴 12.51% |
| MCP_Quota_Claude | 🟢 0 | 🔴 9 | 🔴 13 | 🔴 10.71% |
| Statusline | 🟢 0 | 🔴 9 | 🔴 2 | 🔴 10.54% |
| Site_Greg-Assainissement | 🟢 0 | 🔴 13 | 🔴 9 | 🔴 14.22% |
| Site_1970_Plomberie | 🟢 0 | 🔴 9 | 🔴 10 | 🔴 13.43% |
| Thumbfast_createur_images | 🟢 0 | 🔴 10 | 🔴 8 | 🔴 11.37% |
| Utilitaire_Webapp | 🟢 0 | 🔴 9 | 🔴 6 | 🔴 10.59% |
| Site_Soraya | 🟢 0 | 🔴 8 | 🟢 0 | 🔴 11.44% |
| Benchmark_Claude | 🟢 0 | 🔴 8 | 🟢 0 | 🔴 16.83% |
| test_codingmenace | 🟢 0 | 🔴 10 | 🔴 11 | 🔴 13.89% |
| RemoteDevDashboard | 🟢 0 | 🔴 8 | 🟢 0 | 🔴 16.4% |
| ClaudePilot | 🟢 0 | 🔴 8 | 🔴 38 | 🔴 14.19% |
| Lanceur_Claude | 🟢 0 | 🔴 11 | 🟢 0 | 🟢 1.68% |
| analyse-negocio | 🟢 0 | 🔴 8 | 🔴 8 | 🔴 11.7% |
| SqlConnectionTest | 🟢 0 | 🔴 8 | 🟢 0 | 🔴 14.76% |
| Zentra | 🟢 0 | 🔴 16 | 🔴 25 | 🔴 7.87% |
| LB2I-Fiscal-Manager | 🔴 1 | 🔴 16 | 🔴 12 | 🔴 9.4% |
| magic-migration | 🔴 4 | 🔴 19 | 🔴 48 | 🔴 10.85% |

> Les détails (fichiers, règles, CVE) ne sont jamais publiés ici : chaque repo concerné reçoit sa propre issue `central-scan` avec les localisations.

---
_Généré par central-scan.ts — hebdomadaire, lundi 5h UTC_
