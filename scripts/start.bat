@echo off
rem ---------------------------------------------------------------
rem  Quick-start wrapper. Double-click this file or run from cmd.
rem  Delegates to scripts\start.ps1 which does all the heavy lifting.
rem
rem  Optional environment override:
rem      BOT_MODE   = local | docker | dev | bot   (default: local)
rem      BOT_TAIL   = 1                            (tail logs after start)
rem
rem  local  = postgres+redis in docker, bot via `pnpm bot:start`
rem           (this is what you want for quick local testing)
rem  docker = everything in docker (bot + web + infra)
rem  dev    = no docker; `pnpm bot:dev` + `pnpm web:dev` HMR
rem  bot    = bot container only (no web)
rem ---------------------------------------------------------------

rem Console codepage → UTF-8 so Russian text in logs doesn't turn into
rem garbage like "╦Џ╦Р╦Ч╦»╦™". Safe even when chcp is unavailable.
chcp 65001 >nul 2>nul

setlocal

set "PS=%~dp0start.ps1"

if not exist "%PS%" (
    echo [start.bat] Cannot find %PS%
    pause
    exit /b 1
)

if "%BOT_MODE%"=="" set "BOT_MODE=local"

set "EXTRA="
if "%BOT_TAIL%"=="1" set "EXTRA=-Tail"

rem Prefer PowerShell 7 if installed.
where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
    pwsh -NoProfile -ExecutionPolicy Bypass -File "%PS%" -Mode %BOT_MODE% %EXTRA%
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%PS%" -Mode %BOT_MODE% %EXTRA%
)

set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
    echo [start.bat] start.ps1 exited with code %RC%.
)
echo Press any key to close...
pause >nul
exit /b %RC%
