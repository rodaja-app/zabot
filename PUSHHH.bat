@echo off
cd /d "%~dp0"
git add .
git commit -m "build: bump version 1.0.0+28"
git push
echo.
echo Pronto! Deploy automatico no Railway iniciado.
pause
