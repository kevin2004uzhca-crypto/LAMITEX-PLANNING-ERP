@echo off
setlocal
title DETENER LAMITEX PLANNING ERP
pushd "%~dp0"
node "%~dp0scripts\erp-launcher.cjs" --stop
if errorlevel 1 pause
popd
endlocal
