<#
.SYNOPSIS
    Docker Image Prune - Weekly cleanup of unused Docker resources.
.DESCRIPTION
    Removes dangling images, stopped containers, unused volumes and networks.
    Designed to run weekly via Task Scheduler or manually.
.EXAMPLE
    .\docker-prune.ps1
    .\docker-prune.ps1 -DryRun
    .\docker-prune.ps1 -AggressiveMode
#>

param(
    [switch]$DryRun,
    [switch]$AggressiveMode
)

$ErrorActionPreference = "Stop"

function Write-Status($text, $color) { Write-Host $text -ForegroundColor $color -NoNewline }
function Write-Line($text, $color = "White") { Write-Host $text -ForegroundColor $color }

Write-Host ""
Write-Line "  DOCKER CLEANUP" Cyan
Write-Line "  ==============" DarkCyan
if ($DryRun) { Write-Line "  [DRY RUN MODE]" Yellow }
Write-Host ""

# Check Docker is running
try {
    $null = docker info 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Docker not running" }
}
catch {
    Write-Line "  ERROR: Docker is not running. Start Docker Desktop first." Red
    exit 1
}

# Before stats
$beforeImages = (docker images -q 2>$null | Measure-Object).Count
$beforeContainers = (docker ps -aq 2>$null | Measure-Object).Count
$beforeVolumes = (docker volume ls -q 2>$null | Measure-Object).Count
$diskBefore = docker system df --format "{{.Size}}" 2>$null | Select-Object -First 1

Write-Line "  Before:" White
Write-Line "    Images: $beforeImages" DarkGray
Write-Line "    Containers: $beforeContainers" DarkGray
Write-Line "    Volumes: $beforeVolumes" DarkGray
Write-Line "    Disk: $diskBefore" DarkGray
Write-Host ""

if ($DryRun) {
    Write-Line "  Would clean:" Yellow

    # Stopped containers
    $stopped = docker ps -aq --filter "status=exited" 2>$null
    $stoppedCount = ($stopped | Measure-Object).Count
    Write-Line "    - $stoppedCount stopped container(s)" DarkGray

    # Dangling images
    $dangling = docker images -f "dangling=true" -q 2>$null
    $danglingCount = ($dangling | Measure-Object).Count
    Write-Line "    - $danglingCount dangling image(s)" DarkGray

    if ($AggressiveMode) {
        # Images older than 7 days not used by running containers
        $running = docker ps -q 2>$null
        $allImages = docker images -q 2>$null
        $unusedCount = ($allImages | Measure-Object).Count - ($running | Measure-Object).Count
        Write-Line "    - ~$unusedCount unused image(s) (aggressive mode)" DarkGray
    }

    # Unused volumes
    $unusedVols = docker volume ls -qf "dangling=true" 2>$null
    $unusedVolCount = ($unusedVols | Measure-Object).Count
    Write-Line "    - $unusedVolCount unused volume(s)" DarkGray

    Write-Host ""
    Write-Line "  Run without -DryRun to execute cleanup." Yellow
    exit 0
}

# Execute cleanup
Write-Line "  Cleaning..." Cyan

# 1. Remove stopped containers
Write-Status "    Stopped containers... " White
$result = docker container prune -f 2>$null
$reclaimed = if ($result -match "reclaimed (.+)") { $Matches[1] } else { "0B" }
Write-Line "done ($reclaimed reclaimed)" Green

# 2. Remove dangling images
Write-Status "    Dangling images... " White
$result = docker image prune -f 2>$null
$reclaimed = if ($result -match "reclaimed (.+)") { $Matches[1] } else { "0B" }
Write-Line "done ($reclaimed reclaimed)" Green

# 3. Aggressive mode: remove all unused images
if ($AggressiveMode) {
    Write-Status "    All unused images... " White
    $result = docker image prune -a -f --filter "until=168h" 2>$null
    $reclaimed = if ($result -match "reclaimed (.+)") { $Matches[1] } else { "0B" }
    Write-Line "done ($reclaimed reclaimed)" Green
}

# 4. Remove unused volumes (careful - data loss!)
Write-Status "    Unused volumes... " White
$result = docker volume prune -f 2>$null
$reclaimed = if ($result -match "reclaimed (.+)") { $Matches[1] } else { "0B" }
Write-Line "done ($reclaimed reclaimed)" Green

# 5. Remove unused networks
Write-Status "    Unused networks... " White
docker network prune -f 2>$null | Out-Null
Write-Line "done" Green

# 6. Builder cache
Write-Status "    Build cache... " White
$result = docker builder prune -f --filter "until=168h" 2>$null
$reclaimed = if ($result -match "reclaimed (.+)") { $Matches[1] } else { "0B" }
Write-Line "done ($reclaimed reclaimed)" Green

Write-Host ""

# After stats
$afterImages = (docker images -q 2>$null | Measure-Object).Count
$afterContainers = (docker ps -aq 2>$null | Measure-Object).Count
$afterVolumes = (docker volume ls -q 2>$null | Measure-Object).Count
$diskAfter = docker system df --format "{{.Size}}" 2>$null | Select-Object -First 1

Write-Line "  After:" White
Write-Line "    Images: $beforeImages -> $afterImages" DarkGray
Write-Line "    Containers: $beforeContainers -> $afterContainers" DarkGray
Write-Line "    Volumes: $beforeVolumes -> $afterVolumes" DarkGray
Write-Line "    Disk: $diskBefore -> $diskAfter" DarkGray
Write-Host ""

$removed = $beforeImages - $afterImages + $beforeContainers - $afterContainers
Write-Line "  Cleanup complete! Removed $removed item(s)." Green
Write-Host ""
