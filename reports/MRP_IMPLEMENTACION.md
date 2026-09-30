# Implementación de BOM SAP, maestro de materiales y MRP bruto

Fecha de verificación: 28 de septiembre de 2026.

## Datos actualizados y conservación

Se importó desde el ERP, con la sesión ADMIN existente, `EXPORT_ListasMateriales3001_3034.xlsx` (hoja Data), SHA-256 `b3edd0fc89e897faff4d9e8cf4c5976a3987f3de9551ed44e35f4ddd61f636d3`. Importación completada: ID 15.

- 2.482 listas activas: 2.481 nuevas y 1 existente reutilizada.
- 18.199 posiciones originales; 1.306 códigos de material.
- 160 relaciones nuevas producto/SAP por coincidencia exacta con su código de referencia; relación ya existente conservada.
- 162 modelos, 162 SKU, 162 BOM de ingeniería y 1.553 nodos conservados. Ningún árbol fue reimportado.
- Cantidades originales, signos, posiciones, alternativas de componente y filas guardadas; respaldo completo del Excel en Storage privado. Las cantidades numéricas operativas respetan la precisión del esquema existente; raw_source conserva los valores fuente.

Las huellas completas de filas, antes y después, coincidieron:

| Tabla | MD5 de filas ordenadas por ID |
|---|---|
| product_models | dfb66b93b39411a807abab99af28dd56 |
| engineering_boms | 2c7cec1ef953a5b6def78099763061ff |
| engineering_bom_nodes | aa20746a57e78a4b28b3aff0ddceeae4 |

Los códigos `2T20450` y `2T20451` también aparecen con espacios no separables finales en 13 filas. Sus versiones se conservaron exactamente; no se fusionaron con los códigos sin espacios porque tienen bases diferentes.

## Funcionalidades disponibles

- `/material-lists`: consulta PostgreSQL, búsqueda, centros/alternativas, datos originales, origen y requerimiento directo.
- `/material-lists/import`: validación previa y carga transaccional, respaldo por SHA-256, reuso de listas idénticas e historial de versiones modificadas.
- `/material-lists/links`: relación explícita entre productos existentes y códigos SAP, con historial y comprobación de cambios concurrentes.
- `/materials`: maestro por código, filtros, conteo global de modelos consumidores (9A10185: 96 modelos en el catálogo verificado).
- `/materials/[id]`: clasificación editable, UUID, unidades, conversión confirmada, empaque, make/buy, lead time, stock de seguridad, estado y notas; utilización paginada y lista de modelos consumidores.
- `/materials/catalogs`: familias/subfamilias y definición/confirmación de unidades.
- `/mrp`: plan manual, selección explícita de alternativa por producto, requerimientos, compartidos, validaciones, trazabilidad y ejecuciones persistidas.
- `/material-lists/validation`: controles globales del catálogo.

Todas las cantidades positivas válidas participan, independientemente de familia o clasificación. Códigos distintos se mantienen separados; el mismo código con unidades distintas también. Los negativos nunca compensan los positivos ni generan compras negativas.

## Pruebas realizadas

1. **TypeScript y suite completa:** 28 pruebas aprobadas, incluidas las anteriores de ingeniería.
2. **Un producto real:** 3C83010, centro 3001, alternativa 1, base 2 UN, plan 5 UN. Material 9A10185: 1,941 / 2 × 5 = **4,8525 KG**. 19 filas visibles, 18 necesidades positivas; negativo separado de -0,84 KG. Ejecución `a097fcc1-59c9-43af-b802-ce58a95248de`.
3. **Cinco productos reales:** 3C83010 (5), 3C83001 (2), 3C83002 (3), 3C83003 (4), 3C83004 (5). 19 UN programadas, 29 materiales con requerimiento positivo y 19 códigos compartidos. Pegamento 9A10185 consolidado **21,525 KG**, con cinco aportes visibles. Ejecución `b396dc9d-c819-48d0-ab86-77cb6fe203b4`.
4. **Casos unitarios obligatorios:** 3 grapas y 2 adhesivos independientes; descripciones similares con códigos distintos; familia común sin fusión; consolidación por código/unidad; cantidad base mayor que 1; negativos separados; SAP faltante; alternativas explícitas; falta de maestro/cantidad; factor confirmado 25 M/ROLLO para 37 M = 1,48 rollos, sugerencia 2.
5. **Base de datos:** `reports/mrp-db-check.sql` pasó; misma huella no duplica, BOM idéntico se reutiliza, permisos de los cinco roles, usuarios inactivos y anónimos bloqueados. Cambios de prueba revertidos con ROLLBACK.
6. **UI:** importación completa desde sesión autenticada, cálculo directo, cálculo de uno/cinco productos, reapertura de ejecución, filtro sin cambio del total, desglose por modelo y guardado del maestro con sus valores existentes.
7. **Autenticación:** rutas MRP, materiales y listas SAP responden con redirección al login sin sesión; health responde 200.
8. **Arranque:** INICIAR_ERP.cmd ejecutado satisfactoriamente, servidor activo en localhost:3000 y apertura automática del navegador.
9. **Producción:** npm run build satisfactorio en dos ejecuciones consecutivas tras corregir la limpieza. Se corrigió la limpieza de la salida generada en OneDrive mediante prebuild, acotado exclusivamente a `.next`; `.next-dev` se conserva.

![MRP de cinco modelos](MRP_resultado.png)

## Datos pendientes de clasificación

- 1.306 materiales sin familia y clasificación MRP. No bloquea los consumos válidos.
- 1.561 posiciones negativas requieren clasificación de negocio.
- 13 códigos de unidad observados, incluidas unidades base, pendientes de confirmar su definición. No se inventaron conversiones.
- 1L11203 usa MLL y UN; 8E11851 usa CM y UN. Sus totales permanecen separados.
- Cero bases inválidas, cero posiciones incompletas y cero conflictos de descripción por código en el catálogo activo importado.
- El modelo QA previo sin SAP se conserva; no se relaciona por nombre ni se elimina.

## Límites de esta fase

MRP bruto **directo** de la alternativa seleccionada. No hay selección automática de alternativas de subensambles, pronóstico, MPS, inventario ficticio, MRP neto, sustituciones inferidas ni órdenes de compra. Las ejecuciones conservan su resultado histórico aunque cambie posteriormente la clasificación del maestro.

No se desplegó un hosting HTTPS. La compilación y el login están preparados para esa publicación posterior; configuración de proveedor/dominio queda fuera de esta fase.

El importador utiliza un timeout de 90 segundos únicamente en su función de PostgreSQL; las consultas normales conservan su límite. Referencia técnica del ajuste: [Supabase — Timeouts](https://supabase.com/docs/guides/database/postgres/timeouts).

