@echo off
chcp 65001 >nul
set PORT=4173
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do taskkill /F /PID %%p >nul 2>&1
echo ETF Hub stopped ^(port %PORT% freed^).
timeout /t 1 >nul
