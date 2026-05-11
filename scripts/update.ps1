#requires -version 5.1
<#
.SYNOPSIS
    Auto-update / install runner for the Discord bot.

.DESCRIPTION
    One command, idempotent:
      * If there is no git checkout in -InstallDir, clones the repo there.
      * Otherwise fetches origin and fast-forwards `main` (your local changes
        to gitignored files — most importantly `.env` — are NEVER touched).
      * Reinstalls pnpm deps only when package.json / lockfile changed.
      * Runs prisma migrate deploy + prisma generate only when the schema
        or migrations folder changed.
      * Restarts the running bot using whatever method it detects:
          1. docker compose            (if docker-compose.yml + docker present)
          2. pm2                       (if a pm2 process named "bot" exists)
          3. background pnpm bot:dev   (fallback for dev machines)

    Designed so the user can run it from any PowerShell session and end up
    with the latest code running, without touching `.env`, OAuth tokens,
    DATABASE_URL, or anything else they configured manually.

.PARAMETER InstallDir
    Where the bot lives on disk. Defaults to %USERPROFILE%\discord-bot.

.PARAMETER Repo
    HTTPS URL of the git repository. Defaults to the public repo.

.PARAMETER Branch
    Branch to track. Defaults to "main".

.PARAMETER NoRestart
    Skip the restart step (useful for CI / manual smoke tests).

.EXAMPLE
    iwr -useb https://raw.githubusercontent.com/ambasssadorvlon/qweqweqwe/main/scripts/update.ps1 | iex

.EXAMPLE
    .\scripts\update.ps1 -InstallDir C:\discord-bot
#>

[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:USERPROFILE 'discord-bot'),
    [string]$Repo       = 'https://github.com/ambasssadorvlon/qweqweqwe.git',
    [string]$Branch     = 'main',
    [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'

# --------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------

function Write-Section($text) {
    Write-Host ''
    Write-Host ('=== ' + $text + ' ===') -ForegroundColor Cyan
}

function Require-Command($name, $hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Write-Host "Missing required tool: $name" -ForegroundColor Red
        Write-Host $hint -ForegroundColor Yellow
        throw "Missing $name"
    }
}

function Restart-Bot([string]$InstallDir) {
    # 1. docker compose
    $compose = Join-Path $InstallDir 'docker-compose.yml'
    $hasDocker = Get-Command 'docker' -ErrorAction SilentlyContinue
    if ($hasDocker -and (Test-Path $compose)) {
        Push-Location $InstallDir
        try {
            $running = docker compose ps --status running --services 2>$null
            if ($running) {
                Write-Host 'Restarting via docker compose…' -ForegroundColor Green
                docker compose up -d --build bot web
                return
            }
        } catch {
            Write-Host "docker compose check failed: $($_.Exception.Message)" -ForegroundColor Yellow
        } finally {
            Pop-Location
        }
    }

    # 2. pm2
    $hasPm2 = Get-Command 'pm2' -ErrorAction SilentlyContinue
    if ($hasPm2) {
        $pm2Has = & pm2 jlist 2>$null | Out-String
        if ($pm2Has -match '"name":"bot"') {
            Write-Host 'Restarting pm2 process "bot"…' -ForegroundColor Green
            pm2 reload bot
            return
        }
    }

    # 3. local pnpm bot:dev fallback (dev machine)
    Write-Host 'No docker / pm2 detected — starting "pnpm bot:dev" in a new window…' -ForegroundColor Green
    $shell = if (Get-Command 'pwsh' -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell' }
    Start-Process -FilePath $shell -ArgumentList @(
        '-NoExit', '-Command',
        "Set-Location `"$InstallDir`"; pnpm bot:dev"
    ) -WorkingDirectory $InstallDir
}

# --------------------------------------------------------------------
# preflight
# --------------------------------------------------------------------

Require-Command 'git'  'Install Git for Windows: https://git-scm.com/download/win'
Require-Command 'node' 'Install Node.js 22 LTS: https://nodejs.org/'
Require-Command 'pnpm' 'Install pnpm: npm install -g pnpm@9.15.1'

# --------------------------------------------------------------------
# 1. clone or fast-forward
# --------------------------------------------------------------------

$cloneNeeded = $false
if (-not (Test-Path $InstallDir)) {
    $cloneNeeded = $true
} elseif (-not (Test-Path (Join-Path $InstallDir '.git'))) {
    $existing = Get-ChildItem -Force $InstallDir -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "$InstallDir exists but is not a git checkout, and is not empty." -ForegroundColor Red
        Write-Host 'Refusing to overwrite. Either:' -ForegroundColor Yellow
        Write-Host '  1) pass a different -InstallDir to a brand new path, or' -ForegroundColor Yellow
        Write-Host '  2) move this folder aside and re-run with the same -InstallDir.' -ForegroundColor Yellow
        Write-Host 'The script will NEVER force-delete an existing directory.' -ForegroundColor Yellow
        throw "Refusing to overwrite $InstallDir"
    }
    $cloneNeeded = $true
}

if ($cloneNeeded) {
    Write-Section "Cloning $Repo -> $InstallDir"
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    git clone --branch $Branch $Repo $InstallDir
} else {
    Write-Section "Updating $InstallDir"
    Push-Location $InstallDir
    try {
        # Only block on TRACKED-file modifications. Untracked files are fine
        # (e.g. .env, .last-update-sha, build artifacts).
        git diff --quiet HEAD --
        $dirtyExit = $LASTEXITCODE
        if ($dirtyExit -ne 0) {
            $dirty = git status --porcelain --untracked-files=no
            Write-Host 'Working tree has tracked-file changes:' -ForegroundColor Red
            Write-Host $dirty
            Write-Host 'Commit, stash, or revert them before updating.' -ForegroundColor Yellow
            throw 'dirty working tree'
        }
        git fetch --prune origin
        git checkout $Branch
        git merge --ff-only "origin/$Branch"
    } finally {
        Pop-Location
    }
}

# --------------------------------------------------------------------
# 2. detect what changed since last run
# --------------------------------------------------------------------

Push-Location $InstallDir
try {
    $lastRunFile = Join-Path $InstallDir '.last-update-sha'
    $previousSha = $null
    if (Test-Path $lastRunFile) {
        $previousSha = (Get-Content $lastRunFile -Raw).Trim()
    }
    $currentSha = (git rev-parse HEAD).Trim()

    $changed = @()
    if ($previousSha -and $previousSha -ne $currentSha) {
        $changed = git diff --name-only $previousSha $currentSha
    } elseif (-not $previousSha) {
        $changed = @('package.json', 'pnpm-lock.yaml', 'prisma/schema.prisma')
    }

    $depsChanged = ($changed | Where-Object { $_ -in 'package.json', 'pnpm-lock.yaml' -or $_ -like 'apps/*/package.json' }).Count -gt 0
    $prismaChanged = ($changed | Where-Object { $_ -like 'prisma/*' }).Count -gt 0

    # ---------- 3. .env handling ----------

    Write-Section 'Checking .env'
    $envPath = Join-Path $InstallDir '.env'
    if (-not (Test-Path $envPath)) {
        Write-Host 'No .env file found.' -ForegroundColor Yellow
        $example = Join-Path $InstallDir '.env.example'
        if (Test-Path $example) {
            Write-Host 'Copy .env.example -> .env and fill it in:' -ForegroundColor Yellow
            Write-Host "    Copy-Item `"$example`" `"$envPath`"" -ForegroundColor Yellow
        }
        Write-Host 'Continuing anyway — the bot will refuse to start without it.' -ForegroundColor Yellow
    } else {
        Write-Host '.env present (left unchanged).' -ForegroundColor Green
    }

    # ---------- 4. install deps ----------

    if ($depsChanged) {
        Write-Section 'Installing dependencies (pnpm install)'
        pnpm install --frozen-lockfile
    } else {
        Write-Host 'Dependencies unchanged — skipping pnpm install.' -ForegroundColor DarkGray
    }

    # ---------- 5. prisma migrate ----------

    if ($prismaChanged) {
        Write-Section 'Applying Prisma migrations'
        pnpm --filter @bot/core prisma:generate
        pnpm --filter @bot/core prisma:deploy
    } else {
        Write-Host 'Prisma schema/migrations unchanged — skipping migrate.' -ForegroundColor DarkGray
    }

    # ---------- 6. restart ----------

    if (-not $NoRestart) {
        Write-Section 'Restarting bot'
        Restart-Bot -InstallDir $InstallDir
    } else {
        Write-Host 'NoRestart specified — leaving running processes alone.' -ForegroundColor DarkGray
    }

    Set-Content -Path $lastRunFile -Value $currentSha -NoNewline
    Write-Section "Done — HEAD is at $currentSha"
} finally {
    Pop-Location
}
