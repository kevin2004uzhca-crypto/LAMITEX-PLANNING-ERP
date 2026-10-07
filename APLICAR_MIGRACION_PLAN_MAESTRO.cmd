@echo off
setlocal
title LAMITEX - APLICAR MIGRACION DEL PLAN MAESTRO
pushd "%~dp0"
echo Este paso solo AGREGA tablas nuevas en Supabase: plan maestro, politicas laborales,
echo turnos, pedidos especiales, historia de demanda y vinculos BOM - SAP.
echo No modifica productos, BOMs, arboles ni listas SAP.
echo.
echo Supabase va a mostrar las migraciones pendientes y pedira confirmar con Y.
echo.
call npx supabase db push
if errorlevel 1 (
  echo.
  echo [ERROR] No se pudo aplicar. Si pide iniciar sesion, ejecuta: npx supabase login
  echo y vuelve a abrir este archivo. Copia el mensaje de error y envialo en el chat.
)
echo.
pause
popd
endlocal
