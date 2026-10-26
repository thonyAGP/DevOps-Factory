# Central Security Scan - 2026-10-26

Scans centralisés exécutés depuis DevOps-Factory (repo public = minutes gratuites). Les repos privés du plan Free n'ont ni Code Scanning ni quota Actions illimité.

**Total findings: 748** sur 20 repos _(sécurité uniquement — la duplication est mesurée en %, pas comptée ici)_

| Repo | Secrets (gitleaks) | SAST (semgrep) | Deps/Config (trivy) | Duplication (jscpd) |
|------|--------------------|----------------|---------------------|---------------------|
| DevOps-Factory | ⏭️ | 🔴 13 | 🔴 10 | 🔴 8.82% |
| ClubMedRoomAssignment | 🟢 0 | 🔴 15 | 🔴 92 | 🔴 3.27% |
| CasaSync | 🔴 2 | 🔴 11 | 🔴 15 | 🔴 3.45% |
| Livret_accueil_Au-Marais | 🔴 5 | 🔴 6 | 🔴 29 | 🔴 5.65% |
| Site_Au-marais | 🔴 2 | 🔴 7 | 🔴 55 | 🔴 13.66% |
| LecteurMagic | 🔴 4 | 🔴 19 | 🔴 76 | 🔴 10.23% |
| API_Claude | 🟢 0 | 🔴 6 | 🔴 1 | 🔴 16.62% |
| MCP_Quota_Claude | 🟢 0 | 🔴 6 | 🔴 36 | 🔴 13.41% |
| Statusline | 🟢 0 | 🔴 6 | 🔴 8 | 🔴 12.95% |
| Site_Greg-Assainissement | 🟢 0 | 🔴 9 | 🔴 3 | 🔴 20.15% |
| Site_1970_Plomberie | 🟢 0 | 🔴 6 | 🔴 32 | 🔴 15.84% |
| Thumbfast_createur_images | 🟢 0 | 🔴 9 | 🔴 30 | 🔴 14.69% |
| Utilitaire_Webapp | 🟢 0 | 🔴 6 | 🔴 18 | 🔴 13.17% |
| Site_Soraya | 🟢 0 | 🔴 6 | 🟢 0 | 🔴 13.23% |
| test_codingmenace | 🟢 0 | 🔴 6 | 🔴 3 | 🔴 20.15% |
| Lanceur_Claude | 🟢 0 | 🔴 10 | 🟢 0 | 🟢 0.3% |
| analyse-negocio | 🟢 0 | 🔴 6 | 🔴 26 | 🔴 12.11% |
| SqlConnectionTest | 🟢 0 | 🔴 6 | 🟢 0 | 🔴 19.88% |
| Zentra | 🔴 1 | 🔴 14 | 🔴 99 | 🔴 6.65% |
| LB2I-Fiscal-Manager | 🔴 2 | 🔴 16 | 🔴 16 | 🔴 4.53% |

> Les détails (fichiers, règles, CVE) ne sont jamais publiés ici : chaque repo concerné reçoit sa propre issue `central-scan` avec les localisations.

---
_Généré par central-scan.ts — hebdomadaire, lundi 5h UTC_
