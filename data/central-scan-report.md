# Central Security Scan - 2026-10-12

Scans centralisés exécutés depuis DevOps-Factory (repo public = minutes gratuites). Les repos privés du plan Free n'ont ni Code Scanning ni quota Actions illimité.

**Total findings: 914** sur 21 repos _(sécurité uniquement — la duplication est mesurée en %, pas comptée ici)_

| Repo | Secrets (gitleaks) | SAST (semgrep) | Deps/Config (trivy) | Duplication (jscpd) |
|------|--------------------|----------------|---------------------|---------------------|
| DevOps-Factory | ⏭️ | 🔴 13 | 🔴 9 | 🔴 8.97% |
| Email_Assistant | 🔴 1 | 🔴 25 | 🔴 142 | 🔴 18.05% |
| ClubMedRoomAssignment | 🟢 0 | 🔴 15 | 🔴 86 | 🔴 3.28% |
| CasaSync | 🔴 2 | 🔴 11 | 🔴 9 | 🔴 3.59% |
| Livret_accueil_Au-Marais | 🔴 5 | 🔴 6 | 🔴 26 | 🔴 5.65% |
| Site_Au-marais | 🔴 2 | 🔴 7 | 🔴 49 | 🔴 13.7% |
| LecteurMagic | 🔴 4 | 🔴 19 | 🔴 70 | 🔴 10.25% |
| API_Claude | 🟢 0 | 🔴 6 | 🟢 0 | 🔴 16.74% |
| MCP_Quota_Claude | 🟢 0 | 🔴 6 | 🔴 29 | 🔴 13.47% |
| Statusline | 🟢 0 | 🔴 6 | 🔴 8 | 🔴 13.03% |
| Site_Greg-Assainissement | 🟢 0 | 🔴 9 | 🔴 27 | 🔴 20.33% |
| Site_1970_Plomberie | 🟢 0 | 🔴 6 | 🔴 30 | 🔴 15.9% |
| Thumbfast_createur_images | 🟢 0 | 🔴 6 | 🔴 26 | 🔴 14.82% |
| Utilitaire_Webapp | 🟢 0 | 🔴 6 | 🔴 18 | 🔴 13.17% |
| Site_Soraya | 🟢 0 | 🔴 6 | 🟢 0 | 🔴 13.12% |
| test_codingmenace | 🟢 0 | 🔴 6 | 🔴 27 | 🔴 20.33% |
| Lanceur_Claude | 🟢 0 | 🔴 11 | 🟢 0 | 🟢 1.68% |
| analyse-negocio | 🟢 0 | 🔴 6 | 🔴 23 | 🔴 12.13% |
| SqlConnectionTest | 🟢 0 | 🔴 6 | 🟢 0 | 🔴 20.02% |
| Zentra | 🟢 0 | 🔴 14 | 🔴 87 | 🔴 6.85% |
| LB2I-Fiscal-Manager | 🔴 2 | 🔴 16 | 🔴 26 | 🔴 4.89% |

> Les détails (fichiers, règles, CVE) ne sont jamais publiés ici : chaque repo concerné reçoit sa propre issue `central-scan` avec les localisations.

---
_Généré par central-scan.ts — hebdomadaire, lundi 5h UTC_
