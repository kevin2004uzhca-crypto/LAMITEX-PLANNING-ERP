@echo off
setlocal
title LAMITEX PLANNING ERP
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta disponible. Instala Node.js LTS y vuelve a abrir este archivo.
  pause
  exit /b 1
)
node "%~dp0scripts\erp-launcher.cjs"
if errorlevel 1 pause
popd
endlocal
