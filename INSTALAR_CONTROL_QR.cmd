@echo off
setlocal
title LAMITEX - INSTALAR CONTROL DE COLCHONES (QR)
pushd "%~dp0"
echo Paso 1 de 2: crear las tablas nuevas lmx_qr_ en Supabase.
echo Solo AGREGA tablas nuevas (etiquetas, escaneos y accesos). No modifica productos,
echo inventario, plan maestro ni ninguna tabla existente.
echo Supabase va a mostrar la migracion pendiente y pedira confirmar con Y.
echo.
call npx supabase db push
if errorlevel 1 (
  echo.
  echo [ERROR] No se pudo aplicar. Si pide iniciar sesion, ejecuta: npx supabase login
  echo y vuelve a abrir este archivo. Copia el mensaje de error y envialo en el chat.
  goto fin
)
echo.
echo Paso 2 de 2: crear las 4 cuentas (empaque, bodega, produccion y tutor).
node "%~dp0scripts\qr-accounts.cjs"
:fin
echo.
pause
popd
endlocal
