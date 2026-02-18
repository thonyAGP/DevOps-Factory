<#
.SYNOPSIS
  DevOps Factory - Dashboard Watcher with Windows Toast Notifications
.DESCRIPTION
  Polls statuses.json from GitHub Pages every 15 minutes.
  Shows Windows toast notifications on:
  - CI status changes (pass <-> fail)
  - Health score drops >= 15 points
  - New AI Fix PRs
  - Production site downtime (au-marais.fr, livret.au-marais.fr)
#>

$ErrorActionPreference = 'Continue'

$StatusesUrl = 'https://thonyagp.github.io/DevOps-Factory/statuses.json'
$CacheDir = "$env:LOCALAPPDATA\DevOps-Factory"
$CachePath = "$CacheDir\last-statuses.json"
$PollIntervalSeconds = 900 # 15 minutes

$ProductionSites = @(
    @{ Name = 'Site_Au-marais'; Url = 'https://au-marais.fr' },
    @{ Name = 'Livret_Au-Marais'; Url = 'https://livret.au-marais.fr' }
)

# Ensure cache directory exists
if (-not (Test-Path $CacheDir)) {
    New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null
}

# Toast notification function
function Show-Toast {
    param(
        [string]$Title,
        [string]$Message,
        [ValidateSet('Info', 'Warning', 'Error')]
        [string]$Type = 'Info'
    )

    $hasBurntToast = Get-Module -ListAvailable -Name BurntToast -ErrorAction SilentlyContinue

    if ($hasBurntToast) {
        Import-Module BurntToast -ErrorAction SilentlyContinue
        $icon = switch ($Type) {
            'Error'   { 'Alarm' }
            'Warning' { 'Warning' }
            default   { 'Default' }
        }
        New-BurntToastNotification -Text $Title, $Message -Sound $icon -AppLogo $null
    }
    else {
        # Fallback: System.Windows.Forms balloon notification
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
        $balloon = New-Object System.Windows.Forms.NotifyIcon
        $balloon.Icon = [System.Drawing.SystemIcons]::Information
        $balloon.Visible = $true
        $tipIcon = switch ($Type) {
            'Error'   { [System.Windows.Forms.ToolTipIcon]::Error }
            'Warning' { [System.Windows.Forms.ToolTipIcon]::Warning }
            default   { [System.Windows.Forms.ToolTipIcon]::Info }
        }
        $balloon.ShowBalloonTip(10000, $Title, $Message, $tipIcon)
        Start-Sleep -Seconds 2
        $balloon.Dispose()
    }
}

function Test-SiteUp {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

function Get-RemoteStatuses {
    try {
        $response = Invoke-RestMethod -Uri $StatusesUrl -TimeoutSec 15 -ErrorAction Stop
        return $response
    }
    catch {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Failed to fetch statuses: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

function Compare-Statuses {
    param($Previous, $Current)

    $alerts = @()

    foreach ($project in $Current.projects) {
        $prevProject = $Previous.projects | Where-Object { $_.name -eq $project.name }

        if (-not $prevProject) {
            continue
        }

        # CI status change
        if ($prevProject.ciStatus -ne $project.ciStatus) {
            if ($project.ciStatus -eq 'fail') {
                $alerts += @{
                    Title   = "CI FAILED: $($project.name)"
                    Message = "CI went from $($prevProject.ciStatus) to fail"
                    Type    = 'Error'
                }
            }
            elseif ($project.ciStatus -eq 'pass' -and $prevProject.ciStatus -eq 'fail') {
                $alerts += @{
                    Title   = "CI FIXED: $($project.name)"
                    Message = "CI is passing again"
                    Type    = 'Info'
                }
            }
        }

        # Health drop >= 15 points
        $healthDrop = $prevProject.healthScore - $project.healthScore
        if ($healthDrop -ge 15) {
            $alerts += @{
                Title   = "HEALTH DROP: $($project.name)"
                Message = "Health dropped from $($prevProject.healthScore) to $($project.healthScore) (-$healthDrop)"
                Type    = 'Warning'
            }
        }

        # New AI Fix PRs
        $prevAiCount = ($prevProject.aiFixPRs | Measure-Object).Count
        $currAiCount = ($project.aiFixPRs | Measure-Object).Count
        if ($currAiCount -gt $prevAiCount) {
            $newCount = $currAiCount - $prevAiCount
            $alerts += @{
                Title   = "NEW AI FIX: $($project.name)"
                Message = "$newCount new AI fix PR(s) need review"
                Type    = 'Warning'
            }
        }
    }

    return $alerts
}

# Main loop
Write-Host ""
Write-Host "=== DevOps Factory Watcher ===" -ForegroundColor Cyan
Write-Host "Polling: $StatusesUrl"
Write-Host "Interval: $($PollIntervalSeconds / 60) minutes"
Write-Host "Cache: $CachePath"
Write-Host "Press Ctrl+C to stop"
Write-Host ""

$isFirstRun = -not (Test-Path $CachePath)

while ($true) {
    $now = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Host "[$now] Checking..." -ForegroundColor Gray

    $current = Get-RemoteStatuses

    if ($null -eq $current) {
        Write-Host "  Skipping this cycle (fetch failed)" -ForegroundColor Yellow
        Start-Sleep -Seconds $PollIntervalSeconds
        continue
    }

    Write-Host "  Fetched $($current.projects.Count) projects (updated: $($current.timestamp))"

    # Check production sites
    foreach ($site in $ProductionSites) {
        $isUp = Test-SiteUp -Url $site.Url
        if (-not $isUp) {
            Write-Host "  SITE DOWN: $($site.Name) ($($site.Url))" -ForegroundColor Red
            Show-Toast -Title "SITE DOWN: $($site.Name)" -Message "$($site.Url) is not responding" -Type 'Error'
        }
        else {
            Write-Host "  $($site.Name): OK" -ForegroundColor Green
        }
    }

    if ($isFirstRun) {
        Write-Host "  First run - caching initial state" -ForegroundColor Yellow
        $current | ConvertTo-Json -Depth 10 | Set-Content -Path $CachePath -Encoding utf8
        $isFirstRun = $false

        # Summary toast
        $failCount = ($current.projects | Where-Object { $_.ciStatus -eq 'fail' } | Measure-Object).Count
        $avgHealth = [math]::Round(($current.projects | Measure-Object -Property healthScore -Average).Average)
        Show-Toast -Title "DevOps Factory Watcher Started" -Message "$($current.projects.Count) projects monitored, $failCount failing, avg health $avgHealth" -Type 'Info'
    }
    else {
        $previous = Get-Content -Path $CachePath -Raw | ConvertFrom-Json
        $alerts = Compare-Statuses -Previous $previous -Current $current

        if ($alerts.Count -gt 0) {
            Write-Host "  $($alerts.Count) alert(s) detected!" -ForegroundColor Red
            foreach ($alert in $alerts) {
                Write-Host "    [$($alert.Type)] $($alert.Title): $($alert.Message)" -ForegroundColor $(
                    switch ($alert.Type) { 'Error' { 'Red' } 'Warning' { 'Yellow' } default { 'Cyan' } }
                )
                Show-Toast -Title $alert.Title -Message $alert.Message -Type $alert.Type
            }
        }
        else {
            Write-Host "  No changes detected" -ForegroundColor Green
        }

        # Update cache
        $current | ConvertTo-Json -Depth 10 | Set-Content -Path $CachePath -Encoding utf8
    }

    Write-Host "  Next check at $(Get-Date (Get-Date).AddSeconds($PollIntervalSeconds) -Format 'HH:mm:ss')" -ForegroundColor Gray
    Start-Sleep -Seconds $PollIntervalSeconds
}
