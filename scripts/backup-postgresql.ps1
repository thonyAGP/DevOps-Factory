<#
.SYNOPSIS
    PostgreSQL backup with rotation for CasaSync.
.DESCRIPTION
    Performs pg_dump via Docker, compresses, and manages rotation:
    - 7 daily backups
    - 4 weekly backups (Sunday)
    - 3 monthly backups (1st of month)
    Monthly restore test to verify backup integrity.
.EXAMPLE
    .\backup-postgresql.ps1                    # Run backup
    .\backup-postgresql.ps1 -RestoreTest       # Run monthly restore test
    .\backup-postgresql.ps1 -List              # List existing backups
#>

param(
    [switch]$RestoreTest,
    [switch]$List
)

$ErrorActionPreference = "Stop"

# --- Configuration ---
$BackupRoot = "D:\Backups\PostgreSQL\CasaSync"
$DockerContainer = "casasync-db-1"
$DbName = "casasync"
$DbUser = "postgres"
$Timestamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$DayOfWeek = (Get-Date).DayOfWeek
$DayOfMonth = (Get-Date).Day

$DailyDir = Join-Path $BackupRoot "daily"
$WeeklyDir = Join-Path $BackupRoot "weekly"
$MonthlyDir = Join-Path $BackupRoot "monthly"
$RestoreTestDir = Join-Path $BackupRoot "restore-test"
$LogFile = Join-Path $BackupRoot "backup.log"

# --- Helpers ---
function Write-Log($message) {
    $entry = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $message"
    Write-Host $entry
    Add-Content -Path $LogFile -Value $entry
}

function Ensure-Dir($path) {
    if (-not (Test-Path $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
}

function Test-DockerRunning {
    $result = docker ps --filter "name=$DockerContainer" --format "{{.Names}}" 2>$null
    return $result -eq $DockerContainer
}

function Invoke-Backup($outputDir, $prefix) {
    $filename = "${prefix}_${Timestamp}.sql.gz"
    $outputPath = Join-Path $outputDir $filename

    Write-Log "Starting backup: $filename"

    # pg_dump via docker, pipe to gzip
    docker exec $DockerContainer pg_dump -U $DbUser -d $DbName --format=plain |
        & { process { $_ } } |
        powershell -Command "& { `$input | Out-File -Encoding utf8 '$outputPath.tmp' }"

    # Compress
    if (Test-Path "$outputPath.tmp") {
        Compress-Archive -Path "$outputPath.tmp" -DestinationPath "$outputPath.zip" -Force
        Remove-Item "$outputPath.tmp" -Force
        $size = (Get-Item "$outputPath.zip").Length / 1MB
        Write-Log "Backup complete: $filename.zip (${size:N2} MB)"
        return "$outputPath.zip"
    }
    else {
        Write-Log "ERROR: Backup failed - no output file"
        return $null
    }
}

function Remove-OldBackups($dir, $keepCount) {
    $files = Get-ChildItem $dir -File | Sort-Object CreationTime -Descending
    if ($files.Count -gt $keepCount) {
        $toDelete = $files | Select-Object -Skip $keepCount
        foreach ($f in $toDelete) {
            Write-Log "Rotating: $($f.Name)"
            Remove-Item $f.FullName -Force
        }
    }
}

# --- Commands ---

if ($List) {
    Write-Host "`n  POSTGRESQL BACKUPS - CasaSync`n" -ForegroundColor Cyan

    foreach ($dir in @($DailyDir, $WeeklyDir, $MonthlyDir)) {
        $label = Split-Path $dir -Leaf
        Write-Host "  $($label.ToUpper()):" -ForegroundColor Yellow
        if (Test-Path $dir) {
            $files = Get-ChildItem $dir -File | Sort-Object CreationTime -Descending
            foreach ($f in $files) {
                $size = "{0:N2}" -f ($f.Length / 1MB)
                $age = ((Get-Date) - $f.CreationTime).Days
                Write-Host "    $($f.Name)  ${size}MB  (${age}d ago)" -ForegroundColor White
            }
            if ($files.Count -eq 0) { Write-Host "    (empty)" -ForegroundColor DarkGray }
        }
        else {
            Write-Host "    (not created yet)" -ForegroundColor DarkGray
        }
    }
    Write-Host ""
    exit 0
}

# Ensure directories
foreach ($dir in @($DailyDir, $WeeklyDir, $MonthlyDir, $RestoreTestDir)) {
    Ensure-Dir $dir
}

# Check Docker
if (-not (Test-DockerRunning)) {
    Write-Log "ERROR: Docker container '$DockerContainer' is not running"
    Write-Log "Start it with: docker compose up -d (in CasaSync directory)"
    exit 1
}

if ($RestoreTest) {
    Write-Log "=== RESTORE TEST ==="

    # Find latest daily backup
    $latestBackup = Get-ChildItem $DailyDir -File | Sort-Object CreationTime -Descending | Select-Object -First 1
    if (-not $latestBackup) {
        Write-Log "ERROR: No backup found to test"
        exit 1
    }

    Write-Log "Testing restore of: $($latestBackup.Name)"

    $testDbName = "casasync_restore_test"

    # Create test database
    docker exec $DockerContainer psql -U $DbUser -c "DROP DATABASE IF EXISTS $testDbName;" 2>$null
    docker exec $DockerContainer psql -U $DbUser -c "CREATE DATABASE $testDbName;"

    # Extract and restore
    $tempDir = Join-Path $RestoreTestDir "temp"
    Ensure-Dir $tempDir
    Expand-Archive -Path $latestBackup.FullName -DestinationPath $tempDir -Force

    $sqlFile = Get-ChildItem $tempDir -Filter "*.sql*" | Select-Object -First 1
    if ($sqlFile) {
        docker cp $sqlFile.FullName "${DockerContainer}:/tmp/restore-test.sql"
        $result = docker exec $DockerContainer psql -U $DbUser -d $testDbName -f /tmp/restore-test.sql 2>&1
        Write-Log "Restore output (last 5 lines):"
        $result | Select-Object -Last 5 | ForEach-Object { Write-Log "  $_" }
    }

    # Verify table count
    $tableCount = docker exec $DockerContainer psql -U $DbUser -d $testDbName -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
    Write-Log "Restored database has $($tableCount.Trim()) tables"

    # Cleanup
    docker exec $DockerContainer psql -U $DbUser -c "DROP DATABASE IF EXISTS $testDbName;"
    Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue

    Write-Log "=== RESTORE TEST COMPLETE ==="
    exit 0
}

# --- Main Backup ---
Write-Log "=== BACKUP START ==="

# Daily backup (always)
$backupFile = Invoke-Backup $DailyDir "daily"
Remove-OldBackups $DailyDir 7

# Weekly backup (Sunday)
if ($DayOfWeek -eq "Sunday") {
    Write-Log "Sunday - creating weekly backup"
    if ($backupFile) {
        Copy-Item $backupFile -Destination $WeeklyDir
        Remove-OldBackups $WeeklyDir 4
    }
}

# Monthly backup (1st of month)
if ($DayOfMonth -eq 1) {
    Write-Log "1st of month - creating monthly backup"
    if ($backupFile) {
        Copy-Item $backupFile -Destination $MonthlyDir
        Remove-OldBackups $MonthlyDir 3
    }

    # Auto restore test on 1st of month
    Write-Log "Running monthly restore test..."
    & $PSCommandPath -RestoreTest
}

Write-Log "=== BACKUP COMPLETE ==="
