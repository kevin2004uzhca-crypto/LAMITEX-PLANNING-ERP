# Diagnóstico inicial · 23 septiembre 2026

La carpeta contiene infraestructura Supabase y fuentes empresariales; no contiene frontend, rutas, componentes ni tests. No es un repositorio Git. `npm run dev` falla con Missing script. Se ampliará el proyecto actual sin crear otra aplicación o backend.

- Node 24.19.0 y npm 11.17.0 disponibles. package-lock.json existente, CLI Supabase 2.117.0 instalada.
- `.env.local` y `.env.example` existen pero tienen cero bytes. No había configuración de cliente.
- Baseline de esquema y Auth/RLS presente. La migración de Storage tiene cero bytes; no se editará. Su existencia no demuestra que Storage esté configurado remotamente.
- FK compuesta de nodos `(engineering_bom_id, parent_legacy_component_id)` ya impide cruces entre BOM. Existen índices y restricciones para cantidades, niveles y lead time. No se duplicarán tablas.
- Fuentes originales inventariadas y con SHA-256 en source-audit.json; ninguna se modifica.
- Árbol oficial: 1.842 filas. El campo `bom_id` es correlativo por fila, no identifica una cabecera común. `colchon_id=101` contiene dos bloques: componentes 1–10 y 425–433.
- Datos iniciales: el ID 101 corresponde a dos SAP diferentes (3C83010 y 3C81021). No es una clave de producto. El piloto 1–10 se identifica por el caso de aceptación solicitado, dejando su asociación para confirmación humana.
- El componente 7 se llama realmente «Latex F + Convoluted Foam + Latex F». Se conserva, sin truncarlo al nombre abreviado del prompt.
- El árbol original no informa unidad de cantidad ni unidad temporal del lead time. No se supondrán UN ni días en datos fuente.
- Catálogo: 239 variantes, 45 modelos esperados a recontar. SAP: 18.199 filas, con dos columnas homónimas `LMat alternativa`; se leerán por posición y se verificarán antes de mapear.

Arquitectura de esta iteración: Next.js App Router + React + TypeScript, Supabase Auth con cookies y RLS, React Flow + ELK. Servicios de lectura independientes del motor de validación. Configuración de producción por variables de entorno, sin leer Excel locales durante el uso web. Ninguna importación masiva ni MRP definitivo.
