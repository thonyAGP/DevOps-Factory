<#
.SYNOPSIS
    Deploy Husky + lint-staged + commitlint to Node.js projects.
.DESCRIPTION
    Scans D:\Projects for Node.js projects without Husky and sets up:
    - husky (pre-commit hooks)
    - lint-staged (run lint/format only on staged files)
    - commitlint (conventional commits)
.EXAMPLE
    .\deploy-husky.ps1                  # Dry run (show what would happen)
    .\deploy-husky.ps1 -Apply           # Actually install
    .\deploy-husky.ps1 -Target CasaSync # Single project
#>

param(
    [switch]$Apply,
    [string]$Target
)

$ErrorActionPreference = "Stop"
$ProjectsRoot = "D:\Projects"

$NodeProjects = @(
    @{ Name = "CasaSync"; Scripts = @("lint", "typecheck") },
    @{ Name = "Lecteur_Magic"; Scripts = @("lint") },
    @{ Name = "API_Claude"; Scripts = @("typecheck") },
    @{ Name = "MCP_Quota_Claude"; Scripts = @("lint") },
    @{ Name = "Statusline"; Scripts = @("lint") },
    @{ Name = "DevOps-Factory"; Scripts = @("lint", "typecheck") },
    @{ Name = "Site_Greg-Assainissement"; Scripts = @("lint") },
    @{ Name = "Site_1970_Plomberie"; Scripts = @() },
    @{ Name = "Thumbfast_createur_images"; Scripts = @("lint") },
    @{ Name = "Utilitaire_Webapp"; Scripts = @("lint") },
    @{ Name = "test_codingmenace"; Scripts = @("lint") }
)

function Test-HasHusky($projectPath) {
    return Test-Path (Join-Path $projectPath ".husky")
}

function Get-LintStagedConfig($scripts) {
    $config = @{}
    $commands = @()

    if ($scripts -contains "lint") {
        $commands += "pnpm lint --fix"
    }
    if ($scripts -contains "typecheck") {
        $commands += "pnpm typecheck"
    }

    if ($commands.Count -eq 0) {
        $commands += "pnpm lint --fix"
    }

    $config["*.{ts,tsx,js,jsx}"] = $commands
    return $config
}

foreach ($project in $NodeProjects) {
    if ($Target -and $project.Name -ne $Target) { continue }

    $path = Join-Path $ProjectsRoot $project.Name
    $pkgPath = Join-Path $path "package.json"

    if (-not (Test-Path $pkgPath)) {
        Write-Host "  SKIP: $($project.Name) - no package.json" -ForegroundColor DarkGray
        continue
    }

    if (Test-HasHusky $path) {
        Write-Host "  SKIP: $($project.Name) - already has Husky" -ForegroundColor Yellow
        continue
    }

    Write-Host "  $($project.Name)" -ForegroundColor Cyan -NoNewline

    if (-not $Apply) {
        Write-Host " (dry run - would install husky + lint-staged + commitlint)" -ForegroundColor DarkGray
        continue
    }

    Write-Host " - installing..." -ForegroundColor White

    Push-Location $path
    try {
        # Install devDependencies
        pnpm add -D husky lint-staged @commitlint/cli @commitlint/config-conventional

        # Init husky
        pnpm exec husky init

        # Create pre-commit hook
        $preCommitContent = "pnpm exec lint-staged"
        Set-Content -Path ".husky/pre-commit" -Value $preCommitContent -NoNewline

        # Create commit-msg hook
        $commitMsgContent = 'pnpm exec commitlint --edit "$1"'
        Set-Content -Path ".husky/commit-msg" -Value $commitMsgContent -NoNewline

        # Create commitlint config
        $commitlintConfig = @"
export default {
  extends: ['@commitlint/config-conventional'],
};
"@
        Set-Content -Path "commitlint.config.js" -Value $commitlintConfig

        # Add lint-staged config to package.json
        $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
        $lintStagedConfig = Get-LintStagedConfig $project.Scripts

        # Add lint-staged config
        $pkg | Add-Member -NotePropertyName "lint-staged" -NotePropertyValue $lintStagedConfig -Force

        # Add prepare script if missing
        if (-not $pkg.scripts.prepare) {
            $pkg.scripts | Add-Member -NotePropertyName "prepare" -NotePropertyValue "husky" -Force
        }

        $pkg | ConvertTo-Json -Depth 10 | Set-Content $pkgPath

        Write-Host "  OK: $($project.Name) - husky + lint-staged + commitlint installed" -ForegroundColor Green
    }
    catch {
        Write-Host "  ERROR: $($project.Name) - $($_.Exception.Message)" -ForegroundColor Red
    }
    finally {
        Pop-Location
    }
}

Write-Host ""
if (-not $Apply) {
    Write-Host "Dry run complete. Use -Apply to install." -ForegroundColor Yellow
}
else {
    Write-Host "Done. Remember to commit the changes in each project." -ForegroundColor Green
}
