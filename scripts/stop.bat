@echo off
rem ---------------------------------------------------------------
rem  Stop all bot containers (postgres / redis / lavalink / adminer / bot / web).
rem  Volumes are preserved — your DB data is safe.
rem ---------------------------------------------------------------

setlocal

pushd "%~dp0.."

where docker >nul 2>nul
if errorlevel 1 (
    echo [stop.bat] docker not found in PATH.
    pause
    exit /b 1
)

docker compose down
set "RC=%ERRORLEVEL%"

popd

echo.
if "%RC%"=="0" (
    echo Stopped.
) else (
    echo [stop.bat] docker compose down exited with %RC%.
)
echo Press any key to close...
pause >nul
exit /b %RC%
