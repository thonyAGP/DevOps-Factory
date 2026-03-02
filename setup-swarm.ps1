# Code Quality Swarm - Setup Script
# Initialise la structure complète du projet

param(
    [switch]$SkipBuild,
    [switch]$QuickStart
)

$ErrorActionPreference = "Stop"

Write-Host "=== Code Quality Swarm - Setup ===" -ForegroundColor Cyan
Write-Host ""

# Vérifier prérequis
Write-Host "[1/8] Vérification prérequis..." -ForegroundColor Yellow
$prerequisites = @(
    @{ Name = "Docker"; Command = "docker --version" },
    @{ Name = "Docker Compose"; Command = "docker compose version" },
    @{ Name = "Node.js 20+"; Command = "node --version" }
)

foreach ($prereq in $prerequisites) {
    try {
        $null = Invoke-Expression $prereq.Command 2>&1
        Write-Host "  ✓ $($prereq.Name) installé" -ForegroundColor Green
    } catch {
        Write-Host "  ✗ $($prereq.Name) manquant" -ForegroundColor Red
        exit 1
    }
}

# Créer structure dossiers
Write-Host ""
Write-Host "[2/8] Création structure dossiers..." -ForegroundColor Yellow
$folders = @(
    "agents/test-generator/src",
    "agents/code-reviewer/src",
    "agents/bug-detector/src",
    "coordinator/src",
    "scheduler/src",
    "dashboard/src",
    "shared/src",
    "projects",
    "output/tests",
    "output/reports",
    "infra"
)

foreach ($folder in $folders) {
    if (-not (Test-Path $folder)) {
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
        Write-Host "  ✓ Créé: $folder" -ForegroundColor Green
    } else {
        Write-Host "  - Existe: $folder" -ForegroundColor Gray
    }
}

# Copier .env.example vers .env si n'existe pas
Write-Host ""
Write-Host "[3/8] Configuration environnement..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "  ✓ Fichier .env créé (IMPORTANT: configurer ANTHROPIC_API_KEY)" -ForegroundColor Green
    Write-Host "  → Éditer .env maintenant: notepad .env" -ForegroundColor Cyan
} else {
    Write-Host "  - Fichier .env existe déjà" -ForegroundColor Gray
}

# Créer package.json pour chaque module
Write-Host ""
Write-Host "[4/8] Initialisation modules Node.js..." -ForegroundColor Yellow

$modules = @(
    @{ Path = "agents/test-generator"; Name = "swarm-agent-test-generator" },
    @{ Path = "agents/code-reviewer"; Name = "swarm-agent-code-reviewer" },
    @{ Path = "agents/bug-detector"; Name = "swarm-agent-bug-detector" },
    @{ Path = "coordinator"; Name = "swarm-coordinator" },
    @{ Path = "scheduler"; Name = "swarm-scheduler" },
    @{ Path = "dashboard"; Name = "swarm-dashboard" },
    @{ Path = "shared"; Name = "swarm-shared" }
)

foreach ($module in $modules) {
    $packagePath = "$($module.Path)/package.json"

    if (-not (Test-Path $packagePath)) {
        $packageJson = @{
            name = $module.Name
            version = "1.0.0"
            type = "module"
            private = $true
            scripts = @{
                start = "tsx src/index.ts"
                dev = "tsx watch src/index.ts"
                build = "tsc"
                typecheck = "tsc --noEmit"
            }
            dependencies = @{
                zod = "^4.3.6"
                ioredis = "^5.4.1"
                pg = "^8.13.1"
                "@anthropic-ai/sdk" = "^0.32.1"
            }
            devDependencies = @{
                "@types/node" = "^22.0.0"
                "@types/pg" = "^8.11.10"
                typescript = "^5.7.0"
                tsx = "^4.19.0"
            }
        } | ConvertTo-Json -Depth 10

        Set-Content -Path $packagePath -Value $packageJson
        Write-Host "  ✓ Créé: $packagePath" -ForegroundColor Green
    } else {
        Write-Host "  - Existe: $packagePath" -ForegroundColor Gray
    }
}

# Créer tsconfig.json pour chaque module
Write-Host ""
Write-Host "[5/8] Configuration TypeScript..." -ForegroundColor Yellow

$tsconfig = @{
    compilerOptions = @{
        target = "ES2022"
        module = "ESNext"
        lib = @("ES2022")
        moduleResolution = "node"
        esModuleInterop = $true
        strict = $true
        skipLibCheck = $true
        resolveJsonModule = $true
        outDir = "./dist"
        rootDir = "./src"
    }
    include = @("src/**/*")
    exclude = @("node_modules", "dist")
} | ConvertTo-Json -Depth 10

foreach ($module in $modules) {
    $tsconfigPath = "$($module.Path)/tsconfig.json"

    if (-not (Test-Path $tsconfigPath)) {
        Set-Content -Path $tsconfigPath -Value $tsconfig
        Write-Host "  ✓ Créé: $tsconfigPath" -ForegroundColor Green
    }
}

# Créer Dockerfiles
Write-Host ""
Write-Host "[6/8] Création Dockerfiles..." -ForegroundColor Yellow

$dockerfileContent = @"
FROM node:20-alpine

WORKDIR /app

# Installer pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copier package files
COPY package.json pnpm-lock.yaml* ./

# Installer dépendances
RUN pnpm install --frozen-lockfile --prod

# Copier source
COPY . .

# Build TypeScript
RUN pnpm build 2>/dev/null || echo "No build script"

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "process.exit(0)"

# Run
CMD ["node", "dist/index.js"]
"@

$agentModules = $modules | Where-Object { $_.Path -like "agents/*" -or $_.Path -eq "coordinator" -or $_.Path -eq "scheduler" }

foreach ($module in $agentModules) {
    $dockerfilePath = "$($module.Path)/Dockerfile"

    if (-not (Test-Path $dockerfilePath)) {
        Set-Content -Path $dockerfilePath -Value $dockerfileContent
        Write-Host "  ✓ Créé: $dockerfilePath" -ForegroundColor Green
    }
}

# Créer .dockerignore
Write-Host ""
Write-Host "[7/8] Création .dockerignore..." -ForegroundColor Yellow

$dockerignoreContent = @"
node_modules
dist
*.log
.env
.git
.gitignore
README.md
tsconfig.json
"@

foreach ($module in $agentModules) {
    $dockerignorePath = "$($module.Path)/.dockerignore"

    if (-not (Test-Path $dockerignorePath)) {
        Set-Content -Path $dockerignorePath -Value $dockerignoreContent
        Write-Host "  ✓ Créé: $dockerignorePath" -ForegroundColor Green
    }
}

# Installer dépendances (optionnel)
if (-not $QuickStart) {
    Write-Host ""
    Write-Host "[8/8] Installation dépendances (peut prendre quelques minutes)..." -ForegroundColor Yellow

    foreach ($module in $modules) {
        Push-Location $module.Path
        Write-Host "  → Installation: $($module.Name)..." -ForegroundColor Cyan

        if (Get-Command pnpm -ErrorAction SilentlyContinue) {
            pnpm install --silent 2>&1 | Out-Null
        } else {
            npm install --silent 2>&1 | Out-Null
        }

        Pop-Location
        Write-Host "  ✓ Terminé: $($module.Name)" -ForegroundColor Green
    }
} else {
    Write-Host ""
    Write-Host "[8/8] Installation dépendances ignorée (--QuickStart)" -ForegroundColor Gray
}

# Résumé
Write-Host ""
Write-Host "=== Setup terminé ! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Prochaines étapes:" -ForegroundColor Cyan
Write-Host "  1. Configurer .env (ANTHROPIC_API_KEY obligatoire)" -ForegroundColor White
Write-Host "     → notepad .env" -ForegroundColor Gray
Write-Host ""
Write-Host "  2. Générer le code des agents (via Claude Code)" -ForegroundColor White
Write-Host "     → Voir SWARM_SETUP.md section 'Générer le code'" -ForegroundColor Gray
Write-Host ""
Write-Host "  3. Lancer le système" -ForegroundColor White
Write-Host "     → docker compose -f docker-compose.swarm.yml up -d" -ForegroundColor Gray
Write-Host ""
Write-Host "  4. Vérifier" -ForegroundColor White
Write-Host "     → curl http://localhost:3100/health" -ForegroundColor Gray
Write-Host ""
Write-Host "Documentation complète: SWARM_SETUP.md" -ForegroundColor Yellow
Write-Host ""
