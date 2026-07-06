# Central Security Scan - 2026-07-06

Scans centralisés exécutés depuis DevOps-Factory (repo public = minutes gratuites). Les repos privés du plan Free n'ont ni Code Scanning ni quota Actions illimité.

**Total findings: 171340** sur 25 repos

| Repo | Secrets (gitleaks) | SAST (semgrep) | Deps/Config (trivy) | Duplication (jscpd) |
|------|--------------------|----------------|---------------------|---------------------|
| DevOps-Factory | ⚠️ | 🔴 255 | 🔴 4 | 🔴 31.96% |
| Email_Assistant | 🔴 1 | 🔴 118 | 🔴 51 | 🔴 16.8% |
| ClubMedRoomAssignment | 🟢 0 | 🔴 100 | 🔴 54 | 🔴 3.08% |
| CasaSync | ⚠️ | 🔴 95 | 🔴 4 | 🔴 3.69% |
| Livret_accueil_Au-Marais | 🔴 2 | 🔴 94 | 🔴 8 | 🟢 2.32% |
| Site_Au-marais | 🔴 2 | 🔴 93 | 🔴 20 | 🔴 11.05% |
| Lecteur_Magic | 🔴 4 | 🔴 52 | 🔴 48 | 🔴 41.71% |
| API_Claude | 🟢 0 | 🔴 90 | 🟢 0 | 🟢 1.62% |
| MCP_Quota_Claude | 🟢 0 | 🔴 90 | 🔴 13 | 🟢 0.68% |
| Statusline | 🟢 0 | 🔴 90 | 🔴 2 | 🟢 1.97% |
| Site_Greg-Assainissement | 🟢 0 | 🔴 94 | 🔴 9 | 🟢 1.96% |
| Site_1970_Plomberie | 🟢 0 | 🔴 90 | 🔴 10 | 🔴 8.32% |
| Thumbfast_createur_images | 🟢 0 | 🔴 93 | 🔴 8 | 🟢 1.46% |
| Utilitaire_Webapp | 🟢 0 | 🔴 85 | 🔴 6 | 🟢 1.71% |
| Site_Soraya | 🟢 0 | 🔴 59 | 🟢 0 | 🟢 0.99% |
| Benchmark_Claude | 🟢 0 | 🔴 59 | 🟢 0 | 🟢 1.64% |
| test_codingmenace | 🟢 0 | 🔴 94 | 🔴 11 | 🟢 1.88% |
| RemoteDevDashboard | 🟢 0 | 🔴 59 | 🟢 0 | 🟢 1.51% |
| ClaudePilot | 🟢 0 | 🔴 59 | 🔴 38 | 🔴 10.22% |
| Lanceur_Claude | 🟢 0 | 🔴 87 | 🟢 0 | 🟢 1.76% |
| analyse-negocio | 🟢 0 | 🔴 60 | 🔴 8 | 🔴 6.59% |
| SqlConnectionTest | 🟢 0 | 🔴 75 | 🟢 0 | 🟢 1.23% |
| Zentra | 🟢 0 | 🔴 101 | 🔴 25 | 🔴 4.95% |
| LB2I-Fiscal-Manager | 🔴 1 | 🔴 156 | 🔴 12 | 🔴 7.98% |
| magic-migration | 🔴 4 | 🔴 52 | 🔴 48 | 🔴 41.71% |

> Les détails (fichiers, règles, CVE) ne sont jamais publiés ici : chaque repo concerné reçoit sa propre issue `central-scan` avec les localisations.

---
_Généré par central-scan.ts — hebdomadaire, lundi 5h UTC_
