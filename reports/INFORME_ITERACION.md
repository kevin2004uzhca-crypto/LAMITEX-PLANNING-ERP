# Lamitex Planning ERP · informe de iteración

Fecha: 23 de septiembre de 2026.

El ERP se inicia mediante **INICIAR_ERP.cmd**, abre automáticamente el navegador y conecta con Supabase remoto. El build de producción y las pruebas críticas pasan. El caso BOM 101 se puede explorar con datos reales, separados de SAP y con trazabilidad. La asociación definitiva del piloto sigue sujeta a confirmación humana en **Importar datos**. No se ha hecho una importación masiva ni un despliegue público.

## Estado encontrado y arquitectura

La carpeta no contenía frontend ni scripts de aplicación. `package.json` solo declaraba la CLI Supabase. `npm run dev` fallaba por ausencia del script. Había Node 24.19.0, npm 11.17.0, un lockfile y una infraestructura Supabase ya vinculada. No había repositorio Git. `.env.local`, `.env.example` y la tercera migración de Storage tenían cero bytes.

La inspección remota encontró un ADMIN activo, tablas núcleo vacías, RLS habilitado y ningún bucket ni política de Storage. Se conservó el proyecto Supabase existente; no se creó otra base ni otro backend.

Se añadió Next.js App Router 16.3.6, React 19.3.0 y TypeScript al proyecto existente. Supabase SSR gestiona las cookies; cada consulta protegida verifica usuario y perfil activo. El proxy renueva la sesión con `getClaims`, y la capa de acceso verifica al usuario con `getUser`. Las consultas de servidor tienen un límite de espera de 12 segundos. PostgreSQL/RLS conserva la autoridad de permisos.

El motor de validación está separado de los componentes. React Flow y ELK dibujan el árbol arriba–abajo. La vista previa es una extracción real empaquetada, protegida por login; sus registros no se cuentan como datos persistidos. Los archivos originales se cargan a Storage mediante la aplicación. La operación cotidiana y el build no leen Excel desde rutas Windows.

## Fuentes inspeccionadas

Se inspeccionaron los siete Excel, el DOCX, el PPTX, el esquema y las políticas SQL, configuración Supabase, manifiesto y lockfile. `source-audit.json` contiene inventario, hojas, ejemplos, texto extraído y SHA-256. `source-counts.json` contiene los conteos recalculados.

| Fuente | Resultado |
|---|---:|
| Catálogo Resorpedic | 45 modelos, 239 variantes |
| Datos iniciales | 195 filas, 169 con SAP, 26 sin SAP |
| IDs históricos distintos | 185; 10 IDs reutilizados |
| Árbol oficial | 1.842 filas |
| Export SAP | 18.199 filas, incluidas 1.561 negativas |
| Piloto seleccionado | 10 nodos, 3 niveles |
| SAP directo 3C83010 | 1 cabecera, 19 registros |

La columna `bom_id` del árbol es un correlativo por fila. No identifica una cabecera común. El ID histórico 101 aparece en dos bloques: componentes 1–10 y 425–433. En datos iniciales corresponde tanto a 3C83010 como a 3C81021. Se preserva el conflicto, sin unir los bloques.

El DOCX contiene el diagrama original de Pocket Boreal Memory Foam en `word/media/image3.png`. Se inspeccionó visualmente y coincide con las diez relaciones y cantidades del caso. `word/media/image2.png` y la diapositiva 7 del PPTX confirman el catálogo de Pocket Boreal Memory Foam y sus dimensiones de 105 × 190 × 38 cm. Las imágenes originales se extrajeron sin modificarlas; el diagrama puede consultarse en Reconciliación mediante una ruta que exige sesión.

La composición comercial menciona Memory Foam, pero el árbol de ingeniería no tiene un nodo independiente con ese nombre. No se agregó un componente inventado: las representaciones comercial y de ingeniería permanecen diferenciadas y requieren revisión de cobertura por Ingeniería.

## Resultado BOM 101

```text
POCKET BOREAL MEMORY FOAM (raíz virtual, nivel 0)
├─ Panel Completo (1)
│  ├─ Capa aislante (2)
│  ├─ Panel (1)
│  │  ├─ Resortes Pocket Coil (1)
│  │  ├─ Foam Encased (2)
│  │  └─ Foam Encased Head (2)
│  ├─ Flexi Fit Foam (2)
│  └─ Latex F + Convoluted Foam + Latex F (2)
├─ Falda (1)
└─ Forro acolchado (2)
```

Los paréntesis indican cantidades originales, no unidades asumidas. Lead times: 0,3 para componentes 1–7 y 0,25 para 8–10. La fuente no declara unidad temporal ni unidad de cantidad. Se muestran como pendientes. El nombre completo del componente 7 se conserva aunque el prompt lo abreviaba.

Validaciones: padres existentes dentro del BOM, ausencia de ciclos/autorreferencias/duplicados, alcance desde raíces, niveles declarados/calculados, cantidades positivas y lead time no negativo. Resultado: cero errores estructurales y diez advertencias por unidades no declaradas. Prueba adicional de profundidad: 200 niveles, sin límite fijo de tres niveles.

Verificación en navegador: búsqueda de Resortes Pocket Coil, selección, ruta Panel Completo → Panel → Resortes Pocket Coil, nivel 3 y fuente Hoja1/fila 9. Se comprobaron contraer/expandir, controles de zoom/ajuste y vistas de escritorio y móvil. El minimapa se oculta en móvil para no cubrir nodos.

## SKU, SAP y materiales

El candidato del piloto es SAP **3C83010**, 105 × 190 × 38, frente al candidato conflictivo **3C81021** de Infinitus. La evidencia documental respalda Pocket Boreal. La confirmación humana se registra al importar desde una sesión ADMIN o ENGINEERING; no se atribuye una revisión humana a una decisión automática.

SAP conserva centro 3001, alternativa 1, base 2 UN y los 19 registros de las filas 13130–13148 de la hoja Data. El usuario selecciona explícitamente centro y alternativa. Se conservan consumibles y unidades. Ejemplos comprobados: 13,5 M2 ÷ 2 = 6,75 M2 por unidad de producto; desperdicio −0,336 KG ÷ 2 = −0,168 KG. No se invierte el signo ni se convierten unidades.

Las dos columnas homónimas `LMat alternativa` se leen por posición. La segunda se conserva en el snapshot de fuente como alternativa del componente; no se utiliza automáticamente para resolver una explosión multinivel. El archivo completo queda archivado, pero no se importan sus 18.199 registros a las tablas empresariales.

La persistencia utiliza la precisión del esquema existente: cantidades numeric(18,6) y consumos normalizados numeric(18,8). Los valores originales de Excel se conservan en los archivos archivados y en la extracción de evidencia. `PENDING_REVIEW` representa una unidad desconocida y no puede utilizarse como unidad física en futuros cálculos.

## Persistencia y seguridad

Migración añadida y aplicada después de dry-run:

`20260923083935_prepare_pilot_import_and_private_storage.sql`

Crea cuatro buckets privados (`product-images`, `imports`, `reports`, `documents`), lectura para perfiles activos y archivo para ADMIN/ENGINEERING. No añade políticas de sobrescritura o borrado de originales. Habilita uso de secuencias existentes para la persistencia bajo RLS y añade `import_pilot_101(jsonb)` con SECURITY INVOKER.

La función verifica rol, confirmación, fuentes archivadas, IDs, estructura y cantidades. Guarda el caso en una sola transacción, conserva incidencias de unidad, deja el BOM en DRAFT y evita duplicados mediante bloqueo transaccional. Rechaza sobrescribir un SKU existente. Las tres migraciones baseline permanecen intactas, incluida la de Storage vacía.

Las cuatro fuentes originales del piloto se archivaron desde la interfaz autenticada, con verificación SHA-256. No se realizó la persistencia empresarial definitiva porque la confirmación de asociación sigue pendiente. Los ensayos de persistencia se ejecutaron en una transacción con ROLLBACK: no dejaron modelos, SKU, BOM, materiales ni cambios de roles de prueba. Las secuencias de IDs pueden haber avanzado, comportamiento normal de PostgreSQL.

Pruebas de RLS en transacción aislada: ADMIN importa; ENGINEERING puede actualizar; VIEWER puede consultar pero no insertar, actualizar ni ejecutar la importación; anon no puede consultar productos. La sesión real del usuario ADMIN también se verificó en el navegador. La página Estado del sistema confirmó Auth, consultas PostgreSQL y acceso a los cuatro buckets.

No se guardó service_role en el frontend ni en `.env.local`. Las variables cliente proceden del proyecto existente. `.gitignore` excluye entornos, dependencias, builds, estado/logs del launcher y temporales Supabase. La carpeta aún no es un repositorio Git; por tanto no hay commit ni push.

## Arranque y producción

| Verificación | Resultado |
|---|---|
| Ejecutar INICIAR_ERP.cmd con servidor cerrado | PASS: espera readiness, carga login y abre navegador |
| Ejecutarlo con el ERP activo | PASS: mismo proceso; no duplica servidor |
| Detener y reiniciar | PASS: nueva instancia, sin npm ci |
| Puerto ocupado por otro servidor | PASS: diagnóstico y ningún proceso ajeno detenido |
| Variable obligatoria ausente | PASS: error por nombre de variable, sin valores |
| Acceso anónimo a rutas ERP y evidencia | PASS: redirección al login |
| npm run check | PASS: TypeScript y 8 pruebas |
| npm run build | PASS: compilación de todas las rutas |
| npm run start en puerto de prueba 3100 | PASS: ready, login/health 200, piloto anónimo 307 |
| Supabase remoto / Docker | PASS: uso remoto; no se ejecuta Docker en el flujo diario |
| npm audit tras retirar dependencia innecesaria | 0 vulnerabilidades reportadas |

El flujo CMD se probó ejecutando el mismo archivo que Windows invoca con doble clic. No se simularon clics físicos sobre el icono del Explorador. La apertura automática se ejecutó realmente; las pruebas repetidas adicionales usaron `--no-browser` para evitar pestañas innecesarias.

`DETENER_ERP.cmd` solicita la parada al supervisor propio. El supervisor termina únicamente el árbol de su hijo Next.js aún activo. No busca ni mata todos los procesos Node. La primera instancia de prueba heredó restricciones del sandbox; se identificó y cerró exclusivamente esa instancia, y las pruebas finales se realizaron en el entorno Windows normal autorizado.

El desarrollo usa `.next-dev` y el build `.next`, para no interferir entre sí. La publicación HTTPS queda preparada para un proveedor compatible con Next.js/Node, con variables configuradas por el proveedor y el dominio autorizado en Supabase Auth. No se contrató hosting, no se vinculó una cuenta externa y no existe aún una URL pública del ERP.

## Cambios y comandos

Modificados: `package.json`, `package-lock.json`, `.env.example`; configuración inicial del `.env.local` que estaba vacío. Creados: `INICIAR_ERP.cmd`, `DETENER_ERP.cmd`, `scripts/erp-launcher.cjs`, configuración Next/TypeScript, `.gitignore`, `README.md`, `DESIGN.md`, frontend en `src/`, motor/pruebas BOM, scripts de auditoría y reportes. `AGENTS.md` y `CLAUDE.md` fueron generados por Next.js al iniciar desarrollo y se conservaron.

Dependencias nuevas fijadas en el lockfile: Next, React/React DOM, Supabase SSR/JS, React Flow, ELK, Lucide y herramientas TypeScript/tsx/tipos. Se preservó la CLI Supabase existente. ExcelJS se retiró al comprobar que esta importación por fuentes verificadas no lo utiliza; con ello se eliminaron sus avisos transitivos. No se ejecutó `npm audit fix` ni una actualización indiscriminada.

Comandos principales: auditoría Python de lectura, instalación inicial npm, `npm run check`, `npm run build`, `npm run start -- --hostname localhost --port 3100`, launcher/stop, `supabase migration new`, `supabase db push --dry-run`, `supabase db push` y consultas de auditoría/pruebas con rollback. Evidencia de arranque en `launcher-checks.json`; ensayo SQL reproducible en `db-rollback-check.sql`.

## Cierre y pendientes

- **¿La aplicación puede ejecutarse? Sí.** Un clic, apertura automática, login y consultas remotas verificados.
- **¿BOM 101 es correcto? Estructura sí; requiere revisión empresarial.** Coincide con Excel y diagrama, pero faltan unidades y la asociación al SKU necesita confirmación humana.
- **¿Está listo para importación masiva? No.** Hay IDs históricos reutilizados, unidades por revisar, cantidades negativas SAP por clasificar y relaciones/alternativas por reconciliar.
- **¿Build de producción satisfactorio? Sí.** Esto no equivale a hosting publicado.

Próximo paso concreto: en **Importar datos**, revisar y confirmar la asociación de los componentes 1–10 al SKU 3C83010. Las cuatro fuentes ya están archivadas y el botón guarda solo este caso. Después verificar su ficha persistida y resolver las unidades antes de aprobar el BOM.

Editor general, explosión SAP multinivel, cobertura completa de where-used, clasificación empresarial, importación masiva, inventario, MPS y MRP siguen fuera de esta iteración. No se declaran implementados ni se rellenan con datos ficticios. Las modificaciones de infraestructura futuras deben usar nuevas migraciones, sin alterar el baseline.
