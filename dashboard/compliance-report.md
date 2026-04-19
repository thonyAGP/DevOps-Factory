# Compliance & Audit Report

**Generated**: 4/19/2026, 7:20:52 AM
**Period**: 30-day window

## Summary

| Metric | Value |
|--------|-------|
| Total Repos | 2 |
| Avg Compliance Score | 80/100 |
| Repos with Branch Protection | 0/2 |
| Repos with CI | 2/2 |
| PR Review Coverage | 0% |
| PRs Merged (30d) | 10 |
| Deployments (30d) | 18 |
| PRs with Review | 0/10 |

## Repository Compliance

| Repo | Score | Branch Prot | CI | Review | Security |
|------|-------|-------------|----|------------|----------|
| claude-launcher | 🟢 80/100 | ✗ | ✓ | ✗ | 0 |
| SqlConnectionTest | 🟢 80/100 | ✗ | ✓ | ✗ | 0 |

## Compliance Gaps

### ⚠️ No Branch Protection (2)
- claude-launcher
- SqlConnectionTest

### ⚠️ No Code Review (2)
- **claude-launcher**: 5 PRs merged without review
- **SqlConnectionTest**: 5 PRs merged without review

## Recommendations

1. **Enable Branch Protection** on all repos to enforce code review
2. **Setup CI/CD pipelines** for repos without automated testing
3. **Require code reviews** before merge on default branches
4. **Enable security scanning** (dependabot, code scanning)
5. **Monitor review coverage** - target 100% reviewed PRs

## Detailed Repository Breakdown

### claude-launcher | ✓ EXCELLENT (80/100)

**Full Name**: `thonyAGP/claude-launcher`

**Controls**:
- Branch Protection: ✗
- Code Review Required: ✗
- CI/CD Enabled: ✓
- Security Findings: 0 alerts

**Review Coverage**: 0/5 PRs (0%)

**PRs Without Review**:
- #6 - chore: add DevOps-Factory AI workflows (by thonyAGP)
- #5 - chore: add DevOps-Factory AI workflows (by thonyAGP)
- #4 - chore: add SAST with Semgrep (by thonyAGP)
- #3 - chore: add automated dependency updates with Renovate (by thonyAGP)
- #2 - chore: add secret scanning with Gitleaks (by thonyAGP)

**Recent Deployments**: 13 successful deploys in 30 days

---

### SqlConnectionTest | ✓ EXCELLENT (80/100)

**Full Name**: `thonyAGP/SqlConnectionTest`

**Controls**:
- Branch Protection: ✗
- Code Review Required: ✗
- CI/CD Enabled: ✓
- Security Findings: 0 alerts

**Review Coverage**: 0/5 PRs (0%)

**PRs Without Review**:
- #6 - chore: add DevOps-Factory AI workflows (by thonyAGP)
- #5 - chore: add DevOps-Factory AI workflows (by thonyAGP)
- #4 - chore: add SAST with Semgrep (by thonyAGP)
- #3 - chore: add automated dependency updates with Renovate (by thonyAGP)
- #2 - chore: add secret scanning with Gitleaks (by thonyAGP)

**Recent Deployments**: 5 successful deploys in 30 days

---
