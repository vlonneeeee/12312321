@echo off
rem ---------------------------------------------------------------
rem  Top-level launcher. Double-click this file from the repo root.
rem
rem  Delegates to scripts\start.bat which delegates to start.ps1.
rem  Default mode is "local" (docker postgres+redis, bot via pnpm).
rem
rem  Override via env vars:
rem      set BOT_MODE=docker  &  start.bat   (full container build)
rem      set BOT_MODE=dev     &  start.bat   (HMR; no docker)
rem      set BOT_TAIL=1       &  start.bat   (tail logs)
rem ---------------------------------------------------------------

call "%~dp0scripts\start.bat" %*
