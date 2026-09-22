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
pause
