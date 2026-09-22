@echo off
echo =========================================
echo       Starting REVORA Infrastructure       
echo =========================================
echo.

echo Starting backend service (FastAPI on port 8000)...
start "REVORA Backend" cmd /k "python -m uvicorn backend.app.main:app --port 8000"

echo Starting frontend service (Next.js on port 3000)...
start "REVORA Frontend" cmd /k "cd frontend && npm run dev"

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
