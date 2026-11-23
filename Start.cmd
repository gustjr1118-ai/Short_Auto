@echo off
setlocal
cd /d "%~dp0"
if exist "release\0.5.2-optimized\win-unpacked\Shorts Studio bySom.exe" (
  start "" "release\0.5.2-optimized\win-unpacked\Shorts Studio bySom.exe"
  exit /b 0
)
if exist "release\0.5.1-optimized\win-unpacked\Shorts Studio bySom.exe" (
  start "" "release\0.5.1-optimized\win-unpacked\Shorts Studio bySom.exe"
  exit /b 0
)
if exist "release\0.5.0-optimized\win-unpacked\Shorts Studio bySom.exe" (
  start "" "release\0.5.0-optimized\win-unpacked\Shorts Studio bySom.exe"
  exit /b 0
)
if exist "release\0.5.0\win-unpacked\Shorts Studio bySom.exe" (
  start "" "release\0.5.0\win-unpacked\Shorts Studio bySom.exe"
  exit /b 0
)
if exist "release\0.4.1\win-unpacked\Shorts Studio bySom.exe" (
  start "" "release\0.4.1\win-unpacked\Shorts Studio bySom.exe"
  exit /b 0
)
if exist "release\0.4.0\win-unpacked\Shorts Studio bySom.exe" (
  start "" "release\0.4.0\win-unpacked\Shorts Studio bySom.exe"
  exit /b 0
)
if exist "release\0.3.2\win-unpacked\Shorts Studio bySom.exe" (
  start "" "release\0.3.2\win-unpacked\Shorts Studio bySom.exe"
  exit /b 0
)
if exist "release\0.3.1\win-unpacked\Shorts Studio bySom.exe" (
  start "" "release\0.3.1\win-unpacked\Shorts Studio bySom.exe"
  exit /b 0
)
if exist "release\0.3.0\win-unpacked\Shorts Studio bySom.exe" (
  start "" "release\0.3.0\win-unpacked\Shorts Studio bySom.exe"
  exit /b 0
)
if exist "release\0.2.0\win-unpacked\Shorts Studio bySom.exe" (
  start "" "release\0.2.0\win-unpacked\Shorts Studio bySom.exe"
  exit /b 0
)
if exist "release\win-unpacked\Shorts Studio bySom.exe" (
  start "" "release\win-unpacked\Shorts Studio bySom.exe"
  exit /b 0
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 LTS is required for source execution.
  pause
  exit /b 1
)
node scripts\start.cjs
if errorlevel 1 pause
