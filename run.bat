@echo off
echo =========================================
echo       Starting REVORA Infrastructure       
echo =========================================
echo.

rem Check the storage configuration (.env or environment) BEFORE starting anything. The backend refuses to
rem start without it, and the dashboard would otherwise only show "Failed to load data".
pushd "%~dp0"
python -m backend.app.preflight
if errorlevel 1 (
    echo.
    echo Nothing was started. Fix the configuration above and run run.bat again.
    popd
    pause
    exit /b 1
)
popd
echo.

echo Starting backend service (FastAPI on port 8000)...
start "REVORA Backend" /d "%~dp0" cmd /k "python -m uvicorn backend.app.main:app --port 8000"

echo Starting frontend service (Next.js on port 3000)...
start "REVORA Frontend" /d "%~dp0frontend" cmd /k "npm run dev"

echo.
echo Both services are spinning up in separate windows.
echo - Backend API will be available at: http://localhost:8000
echo - Frontend UI will be available at: http://localhost:3000
echo.
echo Warming up the landing page and dashboard route in the background so
echo they open instantly once you click through (Next.js dev mode compiles
echo each route on its first request either way - this just moves that
echo one-time cost off the critical path instead of skipping it).
start "REVORA Warmup" /min powershell -NoProfile -WindowStyle Hidden -File "%~dp0warmup.ps1"
echo.
pause
