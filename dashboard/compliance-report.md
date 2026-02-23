# Compliance & Audit Report

**Generated**: 2/23/2026, 1:23:07 PM
**Period**: 30-day window

## Summary

| Metric | Value |
|--------|-------|
| Total Repos | 17 |
| Avg Compliance Score | 8/100 |
| Repos with Branch Protection | 0/17 |
| Repos with CI | 7/17 |
| PR Review Coverage | 0% |
| PRs Merged (30d) | 11 |
| Deployments (30d) | 62 |
| PRs with Review | 0/11 |

## Repository Compliance

| Repo | Score | Branch Prot | CI | Review | Security |
|------|-------|-------------|----|------------|----------|
| au-marais | 🔴 20/100 | ✗ | ✓ | ✗ | 0 |
| CasaSync | 🔴 20/100 | ✗ | ✓ | ✗ | 0 |
| ClubMedRoomAssignment | 🔴 20/100 | ✗ | ✓ | ✗ | 0 |
| Email_Assistant | 🔴 20/100 | ✗ | ✓ | ✗ | 0 |
| lecteur-magic | 🔴 20/100 | ✗ | ✓ | ✗ | 0 |
| livret-au-marais | 🔴 20/100 | ✗ | ✓ | ✗ | 0 |
| Utilitaire_Webapp | 🔴 20/100 | ✗ | ✓ | ✗ | 0 |
| claude-cli-wrapper | 🔴 0/100 | ✗ | ✗ | ✗ | 0 |
| claude-launcher | 🔴 0/100 | ✗ | ✗ | ✗ | 0 |
| Livret_accueil_Au-Marais | 🔴 0/100 | ✗ | ✗ | ✗ | 0 |
| MCP_Quota_Claude | 🔴 0/100 | ✗ | ✗ | ✗ | 0 |
| Site_1970_Plomberie | 🔴 0/100 | ✗ | ✗ | ✗ | 0 |
| Site_Greg-Assainissement | 🔴 0/100 | ✗ | ✗ | ✗ | 0 |
| SqlConnectionTest | 🔴 0/100 | ✗ | ✗ | ✗ | 0 |
| statusline | 🔴 0/100 | ✗ | ✗ | ✗ | 0 |
| test_codingmenace | 🔴 0/100 | ✗ | ✗ | ✗ | 0 |
| Thumbfast | 🔴 0/100 | ✗ | ✗ | ✗ | 0 |

## Compliance Gaps

### ⚠️ No Branch Protection (17)
- au-marais
- CasaSync
- ClubMedRoomAssignment
- Email_Assistant
- lecteur-magic
- livret-au-marais
- Utilitaire_Webapp
- claude-cli-wrapper
- claude-launcher
- Livret_accueil_Au-Marais
- MCP_Quota_Claude
- Site_1970_Plomberie
- Site_Greg-Assainissement
- SqlConnectionTest
- statusline
- test_codingmenace
- Thumbfast

### ⚠️ No CI Pipeline (10)
- claude-cli-wrapper
- claude-launcher
- Livret_accueil_Au-Marais
- MCP_Quota_Claude
- Site_1970_Plomberie
- Site_Greg-Assainissement
- SqlConnectionTest
- statusline
- test_codingmenace
- Thumbfast

### ⚠️ No Code Review (3)
- **au-marais**: 2 PRs merged without review
- **ClubMedRoomAssignment**: 3 PRs merged without review
- **Email_Assistant**: 6 PRs merged without review

### 🔴 Low Compliance Score < 60 (17)
- au-marais: 20/100
- CasaSync: 20/100
- ClubMedRoomAssignment: 20/100
- Email_Assistant: 20/100
- lecteur-magic: 20/100
- livret-au-marais: 20/100
- Utilitaire_Webapp: 20/100
- claude-cli-wrapper: 0/100
- claude-launcher: 0/100
- Livret_accueil_Au-Marais: 0/100
- MCP_Quota_Claude: 0/100
- Site_1970_Plomberie: 0/100
- Site_Greg-Assainissement: 0/100
- SqlConnectionTest: 0/100
- statusline: 0/100
- test_codingmenace: 0/100
- Thumbfast: 0/100

## Recommendations

1. **Enable Branch Protection** on all repos to enforce code review
2. **Setup CI/CD pipelines** for repos without automated testing
3. **Require code reviews** before merge on default branches
4. **Enable security scanning** (dependabot, code scanning)
5. **Monitor review coverage** - target 100% reviewed PRs

## Detailed Repository Breakdown

### au-marais | ❌ NEEDS WORK (20/100)

**Full Name**: `thonyAGP/au-marais`

**Controls**:
- Branch Protection: ✗
- Code Review Required: ✗
- CI/CD Enabled: ✓
- Security Findings: 0 alerts

**Review Coverage**: 0/2 PRs (0%)

**PRs Without Review**:
- #2 - Release: Observability, CI/CD, Client Portal (by thonyAGP)
- #1 - feat: reservation system, email tracking & admin improvements (by thonyAGP)

**Recent Deployments**: 7 successful deploys in 30 days

---

### CasaSync | ❌ NEEDS WORK (20/100)

**Full Name**: `thonyAGP/CasaSync`

**Controls**:
- Branch Protection: ✗
- Code Review Required: ✗
- CI/CD Enabled: ✓
- Security Findings: 0 alerts

**Recent Deployments**: 2 successful deploys in 30 days

---

### ClubMedRoomAssignment | ❌ NEEDS WORK (20/100)

**Full Name**: `thonyAGP/ClubMedRoomAssignment`

**Controls**:
- Branch Protection: ✗
- Code Review Required: ✗
- CI/CD Enabled: ✓
- Security Findings: 0 alerts

**Review Coverage**: 0/3 PRs (0%)

**PRs Without Review**:
- #32 - fix: CI fix [pattern:auto-1771517616985] (by thonyAGP)
- #26 - fix: AI-generated CI fix (by thonyAGP)
- #18 - fix: AI-generated CI fix (by thonyAGP)

**Recent Deployments**: 3 successful deploys in 30 days

---

### Email_Assistant | ❌ NEEDS WORK (20/100)

**Full Name**: `thonyAGP/Email_Assistant`

**Controls**:
- Branch Protection: ✗
- Code Review Required: ✗
- CI/CD Enabled: ✓
- Security Findings: 0 alerts

**Review Coverage**: 0/6 PRs (0%)

**PRs Without Review**:
- #8 - feat: French AI summaries + navigation fixes + E2E tests (by thonyAGP)
- #6 - feat: Phase 11 quality hardening - E2E tests, folder/snooze fixes, 94% coverage (by thonyAGP)
- #5 - test: boost API route coverage from 52% to 82% (by thonyAGP)
- #4 - test: boost API route coverage from 26% to 52% + Groq SDK + ESLint cleanup (by thonyAGP)
- #3 - Claude/resume work za jh8 (by thonyAGP)
- #2 - feat: add Google/Microsoft Calendar integration (by thonyAGP)

**Recent Deployments**: 39 successful deploys in 30 days

---

### lecteur-magic | ❌ NEEDS WORK (20/100)

**Full Name**: `thonyAGP/lecteur-magic`

**Controls**:
- Branch Protection: ✗
- Code Review Required: ✗
- CI/CD Enabled: ✓
- Security Findings: 0 alerts

**Recent Deployments**: 8 successful deploys in 30 days

---

### livret-au-marais | ❌ NEEDS WORK (20/100)

**Full Name**: `thonyAGP/livret-au-marais`

**Controls**:
- Branch Protection: ✗
- Code Review Required: ✗
- CI/CD Enabled: ✓
- Security Findings: 0 alerts

**Recent Deployments**: 2 successful deploys in 30 days

---

### Utilitaire_Webapp | ❌ NEEDS WORK (20/100)

**Full Name**: `thonyAGP/Utilitaire_Webapp`

**Controls**:
- Branch Protection: ✗
- Code Review Required: ✗
- CI/CD Enabled: ✓
- Security Findings: 0 alerts

**Recent Deployments**: 1 successful deploys in 30 days

---

### claude-cli-wrapper | ❌ NEEDS WORK (0/100)

**Full Name**: `thonyAGP/claude-cli-wrapper`

**Controls**:
- Branch Protection: ✗
- Code Review Required: ✗
- CI/CD Enabled: ✗
- Security Findings: 0 alerts

---

### claude-launcher | ❌ NEEDS WORK (0/100)

**Full Name**: `thonyAGP/claude-launcher`

**Controls**:
- Branch Protection: ✗
- Code Review Required: ✗
- CI/CD Enabled: ✗
- Security Findings: 0 alerts

---

### Livret_accueil_Au-Marais | ❌ NEEDS WORK (0/100)

**Full Name**: `thonyAGP/Livret_accueil_Au-Marais`

**Controls**:
- Branch Protection: ✗
- Code Review Required: ✗
- CI/CD Enabled: ✗
- Security Findings: 0 alerts

---

### MCP_Quota_Claude | ❌ NEEDS WORK (0/100)

**Full Name**: `thonyAGP/MCP_Quota_Claude`

**Controls**:
- Branch Protection: ✗
- Code Review Required: ✗
- CI/CD Enabled: ✗
- Security Findings: 0 alerts

---

### Site_1970_Plomberie | ❌ NEEDS WORK (0/100)

**Full Name**: `thonyAGP/Site_1970_Plomberie`

**Controls**:
- Branch Protection: ✗
- Code Review Required: ✗
- CI/CD Enabled: ✗
- Security Findings: 0 alerts

---

### Site_Greg-Assainissement | ❌ NEEDS WORK (0/100)

**Full Name**: `thonyAGP/Site_Greg-Assainissement`

**Controls**:
- Branch Protection: ✗
- Code Review Required: ✗
- CI/CD Enabled: ✗
- Security Findings: 0 alerts

---

### SqlConnectionTest | ❌ NEEDS WORK (0/100)

**Full Name**: `thonyAGP/SqlConnectionTest`

**Controls**:
- Branch Protection: ✗
- Code Review Required: ✗
- CI/CD Enabled: ✗
- Security Findings: 0 alerts

---

### statusline | ❌ NEEDS WORK (0/100)

**Full Name**: `thonyAGP/statusline`

**Controls**:
- Branch Protection: ✗
- Code Review Required: ✗
- CI/CD Enabled: ✗
- Security Findings: 0 alerts

---

### test_codingmenace | ❌ NEEDS WORK (0/100)

**Full Name**: `thonyAGP/test_codingmenace`

**Controls**:
- Branch Protection: ✗
- Code Review Required: ✗
- CI/CD Enabled: ✗
- Security Findings: 0 alerts

---

### Thumbfast | ❌ NEEDS WORK (0/100)

**Full Name**: `thonyAGP/Thumbfast`

**Controls**:
- Branch Protection: ✗
- Code Review Required: ✗
- CI/CD Enabled: ✗
- Security Findings: 0 alerts

---
