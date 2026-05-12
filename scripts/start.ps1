#requires -version 5.1
<#
.SYNOPSIS
    Quick-start runner for the Discord bot with full preflight checks.

.DESCRIPTION
    Idempotent. Run it from anywhere — it locates the repo via this script's
    own location. Does in order:

      1. Tooling preflight: git / node / pnpm / docker present, Docker Desktop running.
      2. .env preflight: file exists; required keys are filled in (DISCORD_TOKEN,
         DISCORD_CLIENT_ID, DATABASE_URL, OWNER_IDS).
      3. Dependency preflight: pnpm install if node_modules is missing or
         pnpm-lock.yaml is newer than the install marker.
      4. Infrastructure: docker compose up -d postgres redis lavalink adminer,
         wait for healthy.
      5. Schema: prisma generate + prisma migrate deploy.
      6. App start, depending on -Mode:
           local  : docker compose up -d for infra, then `pnpm bot:build` and
                    `pnpm bot:start` in this same window (default for testing)
           docker : docker compose up -d --build bot web (full container build)
           dev    : pnpm bot:dev + pnpm web:dev in two windows (HMR)
           bot    : docker bot only (no web)
      7. Optional log tail (-Tail).

    NEVER touches .env. Refuses to overwrite anything.

.PARAMETER Mode
    docker (default), dev, or bot.

.PARAMETER Tail
    After everything is up, attach to `docker compose logs -f bot web`.

.PARAMETER SkipInstall
    Skip the pnpm install step (only set if you know deps are up-to-date).

.PARAMETER SkipMigrate
    Skip prisma migrate deploy.

.EXAMPLE
    .\scripts\start.ps1
    .\scripts\start.ps1 -Mode dev
    .\scripts\start.ps1 -Tail
#>

[CmdletBinding()]
param(
    [ValidateSet('local', 'docker', 'dev', 'bot')]
    [string]$Mode = 'local',
    [switch]$Tail,
    [switch]$SkipInstall,
    [switch]$SkipMigrate
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

# --------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------

function Step($n, $text) {
    Write-Host ''
    Write-Host "[$n] $text" -ForegroundColor Cyan
}
function Ok($t)   { Write-Host "  OK  $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  ??  $t" -ForegroundColor Yellow }
function Err($t)  { Write-Host "  !!  $t" -ForegroundColor Red }

function Test-CommandExists($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Parse-DotEnv($path) {
    $map = @{}
    if (-not (Test-Path $path)) { return $map }
    foreach ($line in Get-Content $path) {
        $line = $line.Trim()
        if (-not $line -or $line.StartsWith('#')) { continue }
        $eq = $line.IndexOf('=')
        if ($eq -lt 1) { continue }
        $k = $line.Substring(0, $eq).Trim()
        $v = $line.Substring($eq + 1).Trim()
        # strip surrounding quotes
        if ($v.Length -ge 2 -and (($v[0] -eq '"' -and $v[-1] -eq '"') -or ($v[0] -eq "'" -and $v[-1] -eq "'"))) {
            $v = $v.Substring(1, $v.Length - 2)
        }
        $map[$k] = $v
    }
    return $map
}

function Wait-DockerService([string]$name, [int]$timeoutSec = 90) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        $state = docker compose ps --format json $name 2>$null | Out-String
        if ($state -match '"Health"\s*:\s*"healthy"') { return $true }
        # services without healthcheck go to "running" with empty Health
        if ($state -match '"State"\s*:\s*"running"' -and $state -notmatch '"Health"\s*:\s*"(starting|unhealthy)"') {
            return $true
        }
        Start-Sleep -Seconds 2
    }
    return $false
}

# --------------------------------------------------------------------
# 1. tooling preflight
# --------------------------------------------------------------------

Step '1/6' 'Checking required tools'

$missing = @()
foreach ($t in 'git', 'node', 'pnpm') {
    if (Test-CommandExists $t) {
        $ver = (& $t --version) 2>$null
        Ok ("{0,-6} {1}" -f $t, $ver)
    } else {
        Err "$t not found"
        $missing += $t
    }
}

# Node version sanity (require >= 20, warn on >= 26)
if (Test-CommandExists 'node') {
    $nodeMajor = [int](((node --version) -replace '^v', '') -split '\.' | Select-Object -First 1)
    if ($nodeMajor -lt 20) {
        Err "Node $nodeMajor is too old; need >= 20 (recommended 22 LTS)."
        $missing += 'node-too-old'
    } elseif ($nodeMajor -ge 26) {
        Warn "Node $nodeMajor may break @discordjs/ws. Recommended: 22 LTS."
    }
}

# Docker (optional for dev mode, required for docker / bot mode)
$hasDocker = Test-CommandExists 'docker'
if ($hasDocker) {
    try {
        docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Ok 'docker  daemon reachable'
        } else {
            Warn 'docker present but daemon not reachable. Start Docker Desktop.'
            if ($Mode -ne 'dev') { $missing += 'docker-daemon' }
        }
    } catch {
        Warn 'docker present but daemon not reachable. Start Docker Desktop.'
        if ($Mode -ne 'dev') { $missing += 'docker-daemon' }
    }
} else {
    if ($Mode -ne 'dev') {
        Err 'docker not found (required for Mode=docker|bot)'
        $missing += 'docker'
    } else {
        Warn 'docker not found (skipping infra startup; you must run postgres/redis/lavalink yourself)'
    }
}

if ($missing.Count -gt 0) {
    Err 'Preflight failed. Install missing tooling and re-run.'
    Write-Host '  git   : https://git-scm.com/download/win'
    Write-Host '  node  : https://nodejs.org/    (22 LTS)'
    Write-Host '  pnpm  : npm install -g pnpm@9.15.1'
    Write-Host '  docker: https://www.docker.com/products/docker-desktop/'
    throw 'preflight failed'
}

# --------------------------------------------------------------------
# 2. .env preflight
# --------------------------------------------------------------------

Step '2/6' 'Checking .env'

$envPath = Join-Path $RepoRoot '.env'
$envExamplePath = Join-Path $RepoRoot '.env.example'

if (-not (Test-Path $envPath)) {
    Err ".env not found at $envPath"
    if (Test-Path $envExamplePath) {
        Write-Host "  Create it with:" -ForegroundColor Yellow
        Write-Host "    Copy-Item `"$envExamplePath`" `"$envPath`""
        Write-Host "    notepad `"$envPath`""
    }
    throw '.env missing'
}

$env_ = Parse-DotEnv $envPath
$required = @('DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DATABASE_URL', 'OWNER_IDS')
$missingKeys = @()
foreach ($k in $required) {
    if (-not $env_.ContainsKey($k) -or [string]::IsNullOrWhiteSpace($env_[$k])) {
        $missingKeys += $k
    }
}
if ($missingKeys.Count -gt 0) {
    Err ".env is missing or has empty values for: $($missingKeys -join ', ')"
    Write-Host "  Fill them in:" -ForegroundColor Yellow
    Write-Host "    notepad `"$envPath`""
    throw '.env incomplete'
}
Ok '.env present, required keys filled'

# Friendly extra checks
if ($env_['DATABASE_URL'] -notmatch '^(postgres|postgresql)://') {
    Warn "DATABASE_URL doesn't look like a Postgres URL ($($env_['DATABASE_URL']))"
}
if ($env_['SESSION_SECRET'] -eq 'change-me-please' -or $env_['JWT_SECRET'] -eq 'change-me-please') {
    Warn 'SESSION_SECRET / JWT_SECRET are still default placeholders — replace before production.'
}

# --------------------------------------------------------------------
# 3. dependencies
# --------------------------------------------------------------------

Step '3/6' 'Dependencies'

$markerPath = Join-Path $RepoRoot 'node_modules\.pnpm-lock.snapshot'
$lockPath = Join-Path $RepoRoot 'pnpm-lock.yaml'
$nodeModulesExists = Test-Path (Join-Path $RepoRoot 'node_modules')
$needInstall = $false

if (-not $SkipInstall) {
    if (-not $nodeModulesExists) {
        Warn 'node_modules missing — running pnpm install'
        $needInstall = $true
    } elseif (-not (Test-Path $markerPath)) {
        Warn 'no install marker — running pnpm install to be safe'
        $needInstall = $true
    } else {
        $lockTime   = (Get-Item $lockPath).LastWriteTimeUtc
        $markerTime = (Get-Item $markerPath).LastWriteTimeUtc
        if ($lockTime -gt $markerTime) {
            Warn 'pnpm-lock.yaml newer than last install — running pnpm install'
            $needInstall = $true
        }
    }
    if ($needInstall) {
        Push-Location $RepoRoot
        try {
            pnpm install --frozen-lockfile
            if ($LASTEXITCODE -ne 0) { throw "pnpm install failed (exit $LASTEXITCODE)" }
            New-Item -ItemType File -Force -Path $markerPath | Out-Null
            (Get-Item $markerPath).LastWriteTimeUtc = (Get-Date).ToUniversalTime()
        } finally {
            Pop-Location
        }
        Ok 'dependencies installed'
    } else {
        Ok 'dependencies up to date'
    }
} else {
    Warn 'SkipInstall — not touching node_modules'
}

# --------------------------------------------------------------------
# 4. infrastructure
# --------------------------------------------------------------------

if ($Mode -ne 'dev') {
    if ($Mode -eq 'local') {
        Step '4/6' 'Bringing up infrastructure (postgres / redis only — local bot mode)'
    } else {
        Step '4/6' 'Bringing up infrastructure (postgres / redis / lavalink / adminer)'
    }
    Push-Location $RepoRoot
    try {
        if ($Mode -eq 'local') {
            docker compose up -d postgres redis
        } else {
            docker compose up -d postgres redis lavalink adminer
        }
        if ($LASTEXITCODE -ne 0) { throw "docker compose up failed (exit $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
    $svcsToCheck = if ($Mode -eq 'local') { @('postgres', 'redis') } else { @('postgres', 'redis', 'lavalink') }
    foreach ($svc in $svcsToCheck) {
        Push-Location $RepoRoot
        try {
            if (Wait-DockerService $svc 90) {
                Ok "$svc healthy"
            } else {
                Warn "$svc did not become healthy in 90s; continuing — check 'docker compose logs $svc'"
            }
        } finally {
            Pop-Location
        }
    }
} else {
    Step '4/6' 'Mode=dev — skipping docker infrastructure (start postgres/redis/lavalink yourself)'
}

# --------------------------------------------------------------------
# 5. migrations
# --------------------------------------------------------------------

Step '5/6' 'Prisma schema + migrations'

if ($SkipMigrate) {
    Warn 'SkipMigrate — not applying migrations'
} else {
    Push-Location $RepoRoot
    try {
        pnpm --filter @bot/core prisma:generate
        if ($LASTEXITCODE -ne 0) { throw "prisma generate failed (exit $LASTEXITCODE)" }
        pnpm --filter @bot/core prisma:deploy
        if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy failed (exit $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
    Ok 'prisma client generated; migrations applied'
}

# --------------------------------------------------------------------
# 6. start app
# --------------------------------------------------------------------

Step '6/6' "Starting app (mode=$Mode)"

Push-Location $RepoRoot
try {
    switch ($Mode) {
        'local' {
            Write-Host '  Building bot …'
            pnpm bot:build
            if ($LASTEXITCODE -ne 0) { throw "pnpm bot:build failed (exit $LASTEXITCODE)" }
            Ok 'bot built successfully'
            Write-Host ''
            Write-Host '=== Starting bot (Ctrl+C to stop) ===' -ForegroundColor Cyan
            pnpm bot:start
            # Falls through to the "=== Done. ===" line after Ctrl+C.
        }
        'docker' {
            docker compose up -d --build bot web
            if ($LASTEXITCODE -ne 0) { throw "docker compose up bot/web failed (exit $LASTEXITCODE)" }
            Ok 'bot + web containers running'
            $webPort     = if ($env_['WEB_PORT'])      { $env_['WEB_PORT'] }      else { '3000' }
            $botHttpPort = if ($env_['BOT_HTTP_PORT']) { $env_['BOT_HTTP_PORT'] } else { '3001' }
            $adminerPort = if ($env_['ADMINER_PORT']) { $env_['ADMINER_PORT'] } else { '8080' }
            Write-Host "    web    : http://localhost:$webPort"
            Write-Host "    bot    : http://localhost:$botHttpPort"
            Write-Host "    adminer: http://localhost:$adminerPort"
        }
        'bot' {
            docker compose up -d --build bot
            if ($LASTEXITCODE -ne 0) { throw "docker compose up bot failed (exit $LASTEXITCODE)" }
            Ok 'bot container running (no web)'
        }
        'dev' {
            $sh = if (Test-CommandExists 'pwsh') { 'pwsh' } else { 'powershell' }
            Write-Host '  Spawning two windows: "pnpm bot:dev" and "pnpm web:dev"…'
            Start-Process -FilePath $sh -ArgumentList @(
                '-NoExit', '-Command',
                "Set-Location `"$RepoRoot`"; pnpm bot:dev"
            ) -WorkingDirectory $RepoRoot | Out-Null
            Start-Process -FilePath $sh -ArgumentList @(
                '-NoExit', '-Command',
                "Set-Location `"$RepoRoot`"; pnpm web:dev"
            ) -WorkingDirectory $RepoRoot | Out-Null
            Ok 'two dev windows spawned'
        }
    }
} finally {
    Pop-Location
}

if ($Tail -and $Mode -ne 'dev') {
    Write-Host ''
    Write-Host '=== Tailing logs (Ctrl+C to detach; containers keep running) ===' -ForegroundColor Cyan
    Push-Location $RepoRoot
    try {
        if ($Mode -eq 'bot') {
            docker compose logs -f bot
        } else {
            docker compose logs -f bot web
        }
    } finally {
        Pop-Location
    }
}

Write-Host ''
Write-Host '=== Done. ===' -ForegroundColor Green
