# Actualización de fuentes corregidas · 23 de septiembre de 2026

Se volvieron a leer los Excel guardados por el usuario, sin modificar los originales. La extracción anterior se conserva en `reports/history-before-correction`. Las huellas y las incidencias actuales están en `corrected-source-validation.json`.

## Consulta operativa

En **Listas / Requerimiento** (`/material-lists`) están disponibles las 2.482 listas SAP, separadas por material padre, centro y alternativa, con las 18.199 posiciones originales y 1.306 códigos de componente. La búsqueda muestra 30 listas por página. Cada posición conserva cantidad, unidad, signo, alternativa de componente y fila fuente. Los enlaces de subensambles permiten buscar sus propias listas sin seleccionar alternativas automáticamente.

La cantidad a producir permite calcular el requerimiento directo: cantidad de componente / cantidad base × producción. No es todavía MRP neto ni explosión multinivel: no descuenta inventarios, no decide compras, no convierte unidades ni calcula fechas. Los 1.561 valores negativos originales se mantienen señalados.

Las listas completas se consultan desde una extracción versionada dentro de la aplicación, protegida por login. No se afirma que las 18.199 posiciones estén importadas en las tablas operativas de Supabase. El registro operativo sigue limitado al piloto revisado.

## Validación

- Ingeniería: 1.842 nodos, 188 grupos heredados.
- Datos iniciales: 195 registros; 188 IDs distintos. ID 101 ya tiene un único candidato: 3C83010, Pocket Boreal.
- Persisten siete IDs repetidos: 201, 202, 203, 301, 302, 303 y 401.
- El grupo 904 contiene relaciones cíclicas; filas afectadas 419–425 del árbol. No se corrigen padres por inferencia.
- Árbol y Componentes_arbol coinciden en identidad y nombre de los componentes.
- El árbol original sigue sin declarar unidades de cantidad ni de lead time.
- SAP: ninguna cabecera con base inconsistente o cantidad base inválida en esta extracción.

## Comprobaciones realizadas

- `npm run check`: TypeScript y 10 pruebas satisfactorias.
- `npm run build`: satisfactorio, incluida la nueva ruta dinámica protegida.
- Navegador con sesión ADMIN: búsqueda de 3C83010, selección de centro 3001 / alternativa 1, visualización de sus 19 posiciones y cálculo para 10 unidades.
- Resultado comprobado: 8T10459 = 67,5 M2; 9P1230P = −1,68 KG, sin cambiar signos.
- Sin sesión, `/material-lists` devuelve redirección 307 al login.
- Lanzador: detecta y reutiliza la instancia existente en localhost:3000. `INICIAR_ERP.cmd` conserva la apertura automática del navegador.

La migración adicional `20260923192500_correct_pilot_identity_validation.sql` evita registrar un conflicto inexistente del ID 101 cuando las fuentes corregidas solo contienen un candidato. No altera migraciones anteriores ni políticas RLS.

## Registro del piloto

Las tres fuentes modificadas del piloto se archivaron mediante la sesión ADMIN, verificando SHA-256; el catálogo sin cambios reutiliza su archivo previamente verificado. La importación transaccional finalizó y abrió `/products/2`: Pocket Boreal 3C83010, asociación CONFIRMED, versión 1 DRAFT, centro 3001 / alternativa 1 / base 2 UN. Se preservan 10 nodos de ingeniería y 19 posiciones SAP. Las unidades de ingeniería continúan pendientes de revisión.
