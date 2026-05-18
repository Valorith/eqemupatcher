@echo off
setlocal
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0NewRelease.ps1" %*
if errorlevel 1 exit /b %errorlevel%
