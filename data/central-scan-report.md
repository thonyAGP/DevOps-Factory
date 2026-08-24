# Central Security Scan - 2026-08-24

Scans centralisés exécutés depuis DevOps-Factory (repo public = minutes gratuites). Les repos privés du plan Free n'ont ni Code Scanning ni quota Actions illimité.

**Total findings: 885** sur 25 repos _(sécurité uniquement — la duplication est mesurée en %, pas comptée ici)_

| Repo | Secrets (gitleaks) | SAST (semgrep) | Deps/Config (trivy) | Duplication (jscpd) |
|------|--------------------|----------------|---------------------|---------------------|
| DevOps-Factory | ⏭️ | 🔴 12 | 🔴 7 | 🔴 9.82% |
| Email_Assistant | 🔴 1 | 🔴 25 | 🔴 94 | 🔴 18.05% |
| ClubMedRoomAssignment | 🟢 0 | 🔴 15 | 🔴 70 | 🔴 3.28% |
| CasaSync | 🔴 13 | 🔴 11 | 🔴 11 | 🔴 4.59% |
| Livret_accueil_Au-Marais | 🔴 2 | 🔴 6 | 🔴 17 | 🔴 5.97% |
| Site_Au-marais | 🔴 2 | 🔴 7 | 🔴 35 | 🔴 14.15% |
| Lecteur_Magic | 🔴 4 | 🔴 19 | 🔴 58 | 🔴 10.29% |
| API_Claude | 🟢 0 | 🔴 6 | 🟢 0 | 🔴 16.74% |
| MCP_Quota_Claude | 🟢 0 | 🔴 6 | 🔴 19 | 🔴 13.47% |
| Statusline | 🟢 0 | 🔴 6 | 🔴 5 | 🔴 13.03% |
| Site_Greg-Assainissement | 🟢 0 | 🔴 9 | 🔴 18 | 🔴 20.33% |
| Site_1970_Plomberie | 🟢 0 | 🔴 6 | 🔴 18 | 🔴 15.9% |
| Thumbfast_createur_images | 🟢 0 | 🔴 6 | 🔴 17 | 🔴 14.82% |
| Utilitaire_Webapp | 🟢 0 | 🔴 6 | 🔴 12 | 🔴 13.17% |
| Site_Soraya | 🟢 0 | 🔴 6 | 🟢 0 | 🔴 13.12% |
| Benchmark_Claude | 🟢 0 | 🔴 6 | 🟢 0 | 🔴 21.48% |
| test_codingmenace | 🟢 0 | 🔴 6 | 🔴 20 | 🔴 20.33% |
| RemoteDevDashboard | 🟢 0 | 🔴 6 | 🟢 0 | 🔴 20.76% |
| ClaudePilot | 🟢 0 | 🔴 6 | 🔴 58 | 🔴 15.04% |
| Lanceur_Claude | 🟢 0 | 🔴 11 | 🟢 0 | 🟢 1.68% |
| analyse-negocio | 🟢 0 | 🔴 6 | 🔴 17 | 🔴 12.13% |
| SqlConnectionTest | 🟢 0 | 🔴 6 | 🟢 0 | 🔴 20.02% |
| Zentra | 🟢 0 | 🔴 13 | 🔴 59 | 🔴 8.31% |
| LB2I-Fiscal-Manager | 🔴 1 | 🔴 16 | 🔴 24 | 🔴 9.33% |
| magic-migration | 🔴 4 | 🔴 19 | 🔴 58 | 🔴 10.29% |

> Les détails (fichiers, règles, CVE) ne sont jamais publiés ici : chaque repo concerné reçoit sa propre issue `central-scan` avec les localisations.

---
_Généré par central-scan.ts — hebdomadaire, lundi 5h UTC_
