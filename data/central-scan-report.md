# Central Security Scan - 2026-09-14

Scans centralisés exécutés depuis DevOps-Factory (repo public = minutes gratuites). Les repos privés du plan Free n'ont ni Code Scanning ni quota Actions illimité.

**Total findings: 903** sur 25 repos _(sécurité uniquement — la duplication est mesurée en %, pas comptée ici)_

| Repo | Secrets (gitleaks) | SAST (semgrep) | Deps/Config (trivy) | Duplication (jscpd) |
|------|--------------------|----------------|---------------------|---------------------|
| DevOps-Factory | ⏭️ | 🔴 12 | 🔴 7 | 🔴 9.84% |
| Email_Assistant | 🔴 1 | 🔴 25 | 🔴 113 | 🔴 18.05% |
| ClubMedRoomAssignment | 🟢 0 | 🔴 15 | 🔴 80 | 🔴 3.28% |
| CasaSync | 🟢 0 | 🔴 11 | 🔴 16 | 🔴 3.89% |
| Livret_accueil_Au-Marais | 🔴 5 | 🔴 6 | 🔴 23 | 🔴 5.81% |
| Site_Au-marais | 🔴 2 | 🔴 7 | 🔴 43 | 🔴 14.05% |
| Lecteur_Magic | 🔴 4 | 🔴 19 | 🔴 64 | 🔴 10.29% |
| API_Claude | 🟢 0 | 🔴 6 | 🟢 0 | 🔴 16.74% |
| MCP_Quota_Claude | 🟢 0 | 🔴 6 | 🔴 23 | 🔴 13.47% |
| Statusline | 🟢 0 | 🔴 6 | 🔴 7 | 🔴 13.03% |
| Site_Greg-Assainissement | 🟢 0 | 🔴 9 | 🔴 24 | 🔴 20.33% |
| Site_1970_Plomberie | 🟢 0 | 🔴 6 | 🔴 24 | 🔴 15.9% |
| Thumbfast_createur_images | 🟢 0 | 🔴 6 | 🔴 23 | 🔴 14.82% |
| Utilitaire_Webapp | 🟢 0 | 🔴 6 | 🔴 16 | 🔴 13.17% |
| Site_Soraya | 🟢 0 | 🔴 6 | 🟢 0 | 🔴 13.12% |
| Benchmark_Claude | ⚠️ clone failed | — | — | — |
| test_codingmenace | 🟢 0 | 🔴 6 | 🔴 24 | 🔴 20.33% |
| RemoteDevDashboard | ⚠️ clone failed | — | — | — |
| ClaudePilot | ⚠️ clone failed | — | — | — |
| Lanceur_Claude | 🟢 0 | 🔴 11 | 🟢 0 | 🟢 1.68% |
| analyse-negocio | 🟢 0 | 🔴 6 | 🔴 22 | 🔴 12.13% |
| SqlConnectionTest | 🟢 0 | 🔴 6 | 🟢 0 | 🔴 20.02% |
| Zentra | 🟢 0 | 🔴 13 | 🔴 69 | 🔴 8.31% |
| LB2I-Fiscal-Manager | 🔴 1 | 🔴 16 | 🔴 21 | 🔴 8.03% |
| magic-migration | 🔴 4 | 🔴 19 | 🔴 64 | 🔴 10.29% |

> Les détails (fichiers, règles, CVE) ne sont jamais publiés ici : chaque repo concerné reçoit sa propre issue `central-scan` avec les localisations.

---
_Généré par central-scan.ts — hebdomadaire, lundi 5h UTC_
