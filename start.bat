@echo off
setlocal enableextensions enabledelayedexpansion

rem ============================================================
rem  Self-contained launcher for the Discord bot. Double-click
rem  this file from the repo root. Runs every preflight check
rem  inline so there are no surprises.
rem
rem  Steps (each one bails out with a friendly error on failure):
rem    1. Codepage -> UTF-8 (so Russian logs render correctly)
rem    2. Required tools : node, pnpm, docker, git
rem    3. .env present and looks sane
rem    4. docker compose up -d postgres redis
rem    5. pnpm install (frozen lockfile)
rem    6. pnpm prisma:deploy (apply migrations)
rem    7. pnpm bot:build
rem    8. pnpm bot:start (foreground; Ctrl+C to stop)
rem ============================================================

chcp 65001 >nul 2>nul

rem Always run from the directory this file lives in, regardless
rem of where it was launched from.
cd /d "%~dp0"
set "REPO=%CD%"

echo.
echo === Discord bot launcher ===========================
echo  Repo: %REPO%
echo ====================================================

rem ----------------------------------------------------------------
rem  Step 1/7 : required tools
rem ----------------------------------------------------------------
echo.
echo [1/7] Checking required tools...

call :need node    "https://nodejs.org/  (install 22 LTS)"           || goto :fail
call :need pnpm    "npm install -g pnpm@9.15.1"                       || goto :fail
call :need docker  "https://www.docker.com/products/docker-desktop/" || goto :fail
call :need git     "https://git-scm.com/download/win"                || goto :fail

rem Check docker daemon is actually up.
docker info --format "{{.ServerVersion}}" >nul 2>nul
if errorlevel 1 (
    echo   !! docker is installed but the daemon is not running.
    echo      Open Docker Desktop, wait for the whale icon to settle, then retry.
    goto :fail
)
echo   OK  docker daemon reachable

rem ----------------------------------------------------------------
rem  Step 2/7 : .env preflight
rem ----------------------------------------------------------------
echo.
echo [2/7] Checking .env...

if not exist "%REPO%\.env" (
    echo   !! .env not found at %REPO%\.env
    if exist "%REPO%\.env.example" (
        echo      Create it:  copy /Y .env.example .env
        echo      Then edit:  notepad .env
    )
    goto :fail
)

call :env_has DISCORD_TOKEN     || goto :fail
call :env_has DISCORD_CLIENT_ID || goto :fail
call :env_has DATABASE_URL      || goto :fail
call :env_has OWNER_IDS         || goto :fail
echo   OK  .env present and required keys are filled

rem ----------------------------------------------------------------
rem  Step 3/7 : infrastructure (postgres + redis)
rem ----------------------------------------------------------------
echo.
echo [3/7] Bringing up postgres + redis (docker compose)...
docker compose up -d postgres redis
if errorlevel 1 (
    echo   !! docker compose up failed.
    goto :fail
)
echo   OK  postgres + redis are up

rem ----------------------------------------------------------------
rem  Step 4/7 : dependencies
rem ----------------------------------------------------------------
echo.
echo [4/7] Installing dependencies (pnpm install)...
call pnpm install --frozen-lockfile
if errorlevel 1 (
    echo   !! pnpm install failed.
    goto :fail
)
echo   OK  dependencies installed

rem ----------------------------------------------------------------
rem  Step 5/7 : prisma migrate deploy
rem ----------------------------------------------------------------
echo.
echo [5/7] Applying database migrations (prisma migrate deploy)...
call pnpm prisma:deploy
if errorlevel 1 (
    echo   !! prisma migrate deploy failed.
    goto :fail
)
echo   OK  migrations applied

rem ----------------------------------------------------------------
rem  Step 6/7 : build
rem ----------------------------------------------------------------
echo.
echo [6/7] Building bot (pnpm bot:build)...
call pnpm bot:build
if errorlevel 1 (
    echo   !! pnpm bot:build failed.
    goto :fail
)
if not exist "%REPO%\apps\bot\dist\index.js" (
    echo   !! Build finished without errors but apps\bot\dist\index.js is missing.
    echo      Run `pnpm --filter @bot/core build` manually for verbose output.
    goto :fail
)
echo   OK  bot compiled to apps\bot\dist

rem ----------------------------------------------------------------
rem  Step 7/7 : start
rem ----------------------------------------------------------------
echo.
echo [7/7] Starting bot (Ctrl+C to stop)...
echo ====================================================
echo  Logs follow. Ctrl+C exits gracefully.
echo ====================================================
echo.
call pnpm bot:start
set "RC=%ERRORLEVEL%"

echo.
echo ====================================================
echo  Bot exited with code %RC%.
echo ====================================================
echo Press any key to close this window...
pause >nul
exit /b %RC%

rem ============================================================
rem  Subroutines
rem ============================================================

:need
rem  %1 = command name, %2 = hint string (with quotes)
where %1 >nul 2>nul
if errorlevel 1 (
    echo   !! %1 not found in PATH.
    echo      Install: %~2
    exit /b 1
)
for /f "tokens=*" %%v in ('%1 --version 2^>nul') do (
    echo   OK  %1 %%v
    goto :need_done
)
echo   OK  %1 present
:need_done
exit /b 0

:env_has
rem  %1 = key name. Looks for ^KEY=<at least one char> at line start.
rem  Returns 0 if the key is present and has a non-empty value.
findstr /r /c:"^%1=." "%REPO%\.env" >nul 2>nul
if errorlevel 1 (
    echo   !! .env is missing key or has empty value: %1
    echo      Edit it: notepad .env
    exit /b 1
)
exit /b 0

:fail
echo.
echo === FAILED =========================================
echo  Fix the issue above and run start.bat again.
echo ====================================================
echo Press any key to close this window...
pause >nul
exit /b 1
