# Central Security Scan - 2026-07-20

Scans centralisés exécutés depuis DevOps-Factory (repo public = minutes gratuites). Les repos privés du plan Free n'ont ni Code Scanning ni quota Actions illimité.

**Total findings: 643** sur 25 repos _(sécurité uniquement — la duplication est mesurée en %, pas comptée ici)_

| Repo | Secrets (gitleaks) | SAST (semgrep) | Deps/Config (trivy) | Duplication (jscpd) |
|------|--------------------|----------------|---------------------|---------------------|
| DevOps-Factory | ⏭️ | 🔴 12 | 🔴 4 | 🔴 9.74% |
| Email_Assistant | 🔴 1 | 🔴 25 | 🔴 51 | 🔴 18.05% |
| ClubMedRoomAssignment | 🟢 0 | 🔴 15 | 🔴 54 | 🔴 3.28% |
| CasaSync | 🔴 13 | 🔴 11 | 🔴 4 | 🔴 4.64% |
| Livret_accueil_Au-Marais | 🔴 2 | 🔴 6 | 🔴 8 | 🔴 5.97% |
| Site_Au-marais | 🔴 2 | 🔴 7 | 🔴 20 | 🔴 14.36% |
| Lecteur_Magic | 🔴 4 | 🔴 19 | 🔴 46 | 🔴 10.85% |
| API_Claude | 🟢 0 | 🔴 6 | 🟢 0 | 🔴 16.74% |
| MCP_Quota_Claude | 🟢 0 | 🔴 6 | 🔴 13 | 🔴 13.47% |
| Statusline | 🟢 0 | 🔴 6 | 🔴 2 | 🔴 13.03% |
| Site_Greg-Assainissement | 🟢 0 | 🔴 9 | 🔴 9 | 🔴 20.33% |
| Site_1970_Plomberie | 🟢 0 | 🔴 6 | 🔴 10 | 🔴 15.9% |
| Thumbfast_createur_images | 🟢 0 | 🔴 6 | 🔴 8 | 🔴 14.82% |
| Utilitaire_Webapp | 🟢 0 | 🔴 6 | 🔴 6 | 🔴 13.17% |
| Site_Soraya | 🟢 0 | 🔴 6 | 🟢 0 | 🔴 13.12% |
| Benchmark_Claude | 🟢 0 | 🔴 6 | 🟢 0 | 🔴 21.48% |
| test_codingmenace | 🟢 0 | 🔴 6 | 🔴 11 | 🔴 20.33% |
| RemoteDevDashboard | 🟢 0 | 🔴 6 | 🟢 0 | 🔴 20.76% |
| ClaudePilot | 🟢 0 | 🔴 6 | 🔴 38 | 🔴 15.04% |
| Lanceur_Claude | 🟢 0 | 🔴 11 | 🟢 0 | 🟢 1.68% |
| analyse-negocio | 🟢 0 | 🔴 6 | 🔴 8 | 🔴 12.13% |
| SqlConnectionTest | 🟢 0 | 🔴 6 | 🟢 0 | 🔴 20.02% |
| Zentra | 🟢 0 | 🔴 13 | 🔴 25 | 🔴 8.33% |
| LB2I-Fiscal-Manager | 🔴 1 | 🔴 16 | 🔴 12 | 🔴 9.43% |
| magic-migration | 🔴 4 | 🔴 19 | 🔴 46 | 🔴 10.85% |

> Les détails (fichiers, règles, CVE) ne sont jamais publiés ici : chaque repo concerné reçoit sa propre issue `central-scan` avec les localisations.

---
_Généré par central-scan.ts — hebdomadaire, lundi 5h UTC_
