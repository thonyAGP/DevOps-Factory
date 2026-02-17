# DevOps Factory

AI-powered automated DevOps for multi-project management.

## What it does

- **Auto-detects** new repos pushed to GitHub
- **Configures** CI workflows, Claude Code review, self-healing, and Qodo Merge
- **Monitors** all projects via a centralized dashboard
- **Self-heals** CI failures with AI-generated fix PRs
- **Reports** daily status via GitHub Issues

## Architecture

```
DevOps-Factory/
  .github/workflows/
    scan-repos.yml         # Cron: detect new repos, configure
    dashboard-build.yml    # Cron: generate dashboard + GitHub Pages
    daily-report.yml       # Cron: daily issue report
  templates/
    ci-standard.yml        # Reusable CI template
    claude-review.yml      # Claude Code PR review
    self-healing.yml       # Auto-fix CI failures
    qodo-merge.yml         # Qodo Merge review
  scripts/
    scan-and-configure.ts  # Repo scanner
    build-dashboard.ts     # Dashboard generator
  dashboard/               # GitHub Pages output
```

## Setup

### 1. Required secrets

Configure these in GitHub repo settings > Secrets:

| Secret | Description |
|--------|-------------|
| `FACTORY_PAT` | GitHub PAT with `repo`, `workflow` scopes |
| `ANTHROPIC_API_KEY` | For Claude Code reviews (in each target repo) |
| `OPENAI_KEY` | For Qodo Merge (in each target repo, optional) |

### 2. GitHub Pages

Enable GitHub Pages in repo settings:
- Source: GitHub Actions
- The dashboard will be deployed automatically

### 3. Run manually

```bash
pnpm install
pnpm scan       # Scan repos and create config PRs
pnpm dashboard  # Generate dashboard HTML
```

## Cost estimation

| Service | Monthly cost |
|---------|-------------|
| Claude API (Haiku + Sonnet) | ~$6-10 |
| Qodo Merge (Gemini) | $0 (free tier) |
| GitHub Actions | $0 (free tier) |
| GitHub Pages | $0 |
| **Total** | **$6-10/month** |
