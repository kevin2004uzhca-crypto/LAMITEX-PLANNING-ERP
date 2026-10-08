# LAMITEX PLANNING ERP

## Abrir el ERP

1. Doble clic en **INICIAR_ERP.cmd**.
2. El lanzador comprueba la configuración, reutiliza las dependencias y abre automáticamente el navegador.
3. Inicia sesión y utiliza el ERP. No necesitas ejecutar comandos de desarrollo.

Para detener el servidor: **DETENER_ERP.cmd**. Cerrar una pestaña no detiene el servidor. Un segundo inicio reutiliza la instancia existente. Puerto local: http://localhost:3000 (configurable con ERP_PORT). El lanzador no termina procesos ajenos.

La primera configuración requiere Node.js 22+, npm y `.env.local`, según `.env.example`, con NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Se usa Supabase remoto; no se necesita Docker para el uso diario. Nunca colocar una clave secreta/service_role en variables públicas.

## BOM SAP, materiales y MRP bruto

- **Listas / Requerimiento** consulta PostgreSQL, conserva centros y alternativas y permite revisar cantidades originales, base, consumo unitario y filas del Excel.
- **Actualizar Excel SAP** valida el archivo antes de importar. Guarda el original en Storage privado y registra SHA-256. Reimportar la misma versión no duplica registros. Una lista idéntica se reutiliza; una lista modificada conserva su versión anterior.
- **Producto ↔ código SAP** relaciona productos existentes por códigos exactos. No compara nombres ni modifica sus árboles.
- **Materiales / Where-used** permite buscar materiales, contar los modelos consumidores, consultar todas sus posiciones con paginación y editar familia, subfamilia, clasificación, make/buy, lead time, unidades y factores confirmados.
- **Familias y unidades** registra catálogos. No se asignan familias ni conversiones por inferencia.
- **MRP** recibe entre 1 y 100 productos con cantidades positivas y una selección explícita de centro/alternativa por producto. Calcula cantidad SAP ÷ base × cantidad a fabricar. Consolida exclusivamente por código + unidad.
- **Materiales compartidos** muestra los materiales presentes en varios productos del plan. Desplegar el origen muestra cada aporte, posición, cabecera y fila de origen.
- **Validaciones** separa errores y advertencias. Los consumos válidos sin familia/clasificación siguen participando. Las cantidades negativas quedan separadas y nunca compensan las positivas.
- Cada cálculo se guarda en **Ejecuciones guardadas**, con entradas, resultados y trazabilidad. Los filtros solo cambian la vista.

Los 162 modelos, 162 BOM y 1.553 nodos de ingeniería existentes se conservaron. No se volvieron a importar los árboles. La carga SAP de esta fase contiene 2.482 listas, 18.199 posiciones y 1.306 materiales. Se completaron 160 relaciones exactas y se conservó la ya existente.

ADMIN/ENGINEERING pueden importar y editar materiales/catálogos/relaciones. ADMIN/ENGINEERING/PLANNER/SUPERVISOR pueden calcular. Los usuarios activos pueden consultar. RLS sigue activo; no se usan claves privilegiadas en el navegador.

## Alcance

MRP **bruto directo** de las listas seleccionadas. Los subensambles conservan sus códigos y se consultan en su propia lista; no se elige automáticamente una alternativa inferior. Esta fase no incluye MPS, pronóstico, compras automáticas, inventario ficticio ni MRP neto. El stock de producto terminado no se interpreta como stock de materia prima. Los factores de compra se aplican únicamente cuando están confirmados para la unidad BOM correspondiente.

## Validación técnica

- `npm run check`: TypeScript y 28 pruebas.
- `npm run build`: compilación de producción. En Windows, prebuild limpia únicamente `.next` para resolver los directorios de OneDrive. Desarrollo utiliza `.next-dev` y continúa funcionando.
- `npm run start`: servidor de producción después del build.
- `reports/mrp-db-check.sql`: pruebas transaccionales de conservación, idempotencia y permisos; todas sus mutaciones se revierten.
- `reports/mrp-final-audit.sql`: consulta de conteos, huellas y RLS.
- `reports/MRP_IMPLEMENTACION.md`: resultados y operación de esta fase.

Estos comandos son para mantenimiento técnico, no para abrir el ERP cotidianamente.

## Publicación HTTPS posterior

El proyecto está preparado para un proveedor compatible con Next.js/Node.js. Ejecutar `npm ci`, aplicar las migraciones pendientes mediante el procedimiento del proyecto, `npm run build` y `npm run start` (o integración Next.js del proveedor). Configurar las variables públicas de Supabase en el entorno del servidor, nunca subir `.env.local`. Las nuevas fuentes se cargan desde el navegador; no requieren rutas Windows en el servidor.

Configurar el dominio HTTPS y redirecciones autorizadas en Supabase Auth y verificar login/RLS desde el dominio publicado. El importador masivo necesita un entorno servidor que permita archivos de hasta 30 MB y la duración de la transacción de importación (límite acotado de 90 s en PostgreSQL).

No se ha contratado ni publicado un hosting en esta fase. Un build correcto confirma compilación, no una publicación HTTPS.

Desarrollo: **DOBLE CLIC → ERP**.
Producción, tras desplegar: **LINK HTTPS → LOGIN → ERP**.

## Control de colchones con QR (empaque, bodega, etiquetas, producción y programa diario)

- Entrada: `/control`. Empacador, bodega y oficina entran directo a su módulo y no ven el resto del ERP. Los ADMIN ven todo (también desde el menú del ERP).
- Cada etiqueta tiene un código único `LMX-…`; la base de datos acepta un solo escaneo en empaque y uno en bodega (sin importar el celular o la cuenta). Bodega solo acepta etiquetas ya empacadas; el empaque valida el modelo.
- Programa diario: se trae del plan maestro guardado, se pega desde Excel o se escribe. Empaque, bodega y producción ven el avance contra el programa. "Terminar el día" avisa a producción.
- PDF de etiquetas: una por página del tamaño del sticker; "Bajar contenido (mm)" corrige el corte entre stickers de la Zebra.
- Tablas propias `lmx_qr_*` (migraciones aditivas). Cuentas: `scripts/qr-accounts.cjs` (o `INSTALAR_CONTROL_QR.cmd`).

### Publicar en Railway

1. Nuevo proyecto → Deploy from GitHub → este repositorio (rama `main`).
2. Variables: `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (las mismas de `.env.local`; nunca la clave secreta).
3. Build `npm run build`, Start `npm run start` (Railway define `PORT`). Node 22+.
4. Settings → Networking → Generate Domain. Con HTTPS la cámara del celular funciona.
