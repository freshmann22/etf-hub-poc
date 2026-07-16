@echo off
chcp 65001 >nul
cd /d "%~dp0"
title ETF Hub - close this window to stop
node scripts\launch.mjs
echo.
echo Server stopped. Press any key to close.
pause >nul
