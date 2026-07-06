# Central Security Scan - 2026-07-06

Scans centralisés exécutés depuis DevOps-Factory (repo public = minutes gratuites). Les repos privés du plan Free n'ont ni Code Scanning ni quota Actions illimité.

**Total findings: 704** sur 25 repos _(sécurité uniquement — la duplication est mesurée en %, pas comptée ici)_

| Repo | Secrets (gitleaks) | SAST (semgrep) | Deps/Config (trivy) | Duplication (jscpd) |
|------|--------------------|----------------|---------------------|---------------------|
| DevOps-Factory | ⚠️ | 🔴 12 | 🔴 4 | 🔴 7.91% |
| Email_Assistant | 🔴 1 | 🔴 28 | 🔴 51 | 🔴 17.6% |
| ClubMedRoomAssignment | 🟢 0 | 🔴 15 | 🔴 54 | 🔴 3.28% |
| CasaSync | 🔴 13 | 🔴 15 | 🔴 4 | 🔴 3.9% |
| Livret_accueil_Au-Marais | 🔴 2 | 🔴 10 | 🔴 8 | 🟢 2.52% |
| Site_Au-marais | 🔴 2 | 🔴 11 | 🔴 20 | 🔴 12.97% |
| Lecteur_Magic | 🔴 4 | 🔴 19 | 🔴 48 | 🔴 10.67% |
| API_Claude | 🟢 0 | 🔴 9 | 🟢 0 | 🟢 1.75% |
| MCP_Quota_Claude | 🟢 0 | 🔴 9 | 🔴 13 | 🟢 1.48% |
| Statusline | 🟢 0 | 🔴 9 | 🔴 2 | 🟢 2.12% |
| Site_Greg-Assainissement | 🟢 0 | 🔴 13 | 🔴 9 | 🟢 2.06% |
| Site_1970_Plomberie | 🟢 0 | 🔴 9 | 🔴 10 | 🔴 8.48% |
| Thumbfast_createur_images | 🟢 0 | 🔴 10 | 🔴 8 | 🟢 1.51% |
| Utilitaire_Webapp | 🟢 0 | 🔴 9 | 🔴 6 | 🟢 1.87% |
| Site_Soraya | 🟢 0 | 🔴 8 | 🟢 0 | 🟢 1.36% |
| Benchmark_Claude | 🟢 0 | 🔴 8 | 🟢 0 | 🟢 1.7% |
| test_codingmenace | 🟢 0 | 🔴 10 | 🔴 11 | 🟢 1.97% |
| RemoteDevDashboard | 🟢 0 | 🔴 8 | 🟢 0 | 🟢 1.6% |
| ClaudePilot | 🟢 0 | 🔴 8 | 🔴 38 | 🔴 11.55% |
| Lanceur_Claude | 🟢 0 | 🔴 11 | 🟢 0 | 🟢 1.68% |
| analyse-negocio | 🟢 0 | 🔴 8 | 🔴 8 | 🔴 9.92% |
| SqlConnectionTest | 🟢 0 | 🔴 8 | 🟢 0 | 🟢 1.27% |
| Zentra | 🟢 0 | 🔴 16 | 🔴 25 | 🔴 5.14% |
| LB2I-Fiscal-Manager | 🔴 1 | 🔴 16 | 🔴 12 | 🔴 8.32% |
| magic-migration | 🔴 4 | 🔴 19 | 🔴 48 | 🔴 10.67% |

> Les détails (fichiers, règles, CVE) ne sont jamais publiés ici : chaque repo concerné reçoit sa propre issue `central-scan` avec les localisations.

---
_Généré par central-scan.ts — hebdomadaire, lundi 5h UTC_
