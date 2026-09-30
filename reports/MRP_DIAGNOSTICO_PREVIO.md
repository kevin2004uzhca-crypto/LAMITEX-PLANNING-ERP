# Diagnóstico previo · fase BOM SAP / MRP bruto

Control leído de PostgreSQL antes de modificar esta fase: 162 modelos, 162 SKU, 162 BOM de ingeniería, 1.553 nodos, 1 cabecera SAP, 19 posiciones SAP, 19 materiales y 0 familias.

Huellas de preservación (JSON de filas completas ordenadas por id):

- product_models: `dfb66b93b39411a807abab99af28dd56`
- engineering_boms: `2c7cec1ef953a5b6def78099763061ff`
- engineering_bom_nodes: `aa20746a57e78a4b28b3aff0ddceeae4`

Las tablas existentes son reutilizables. El código de los diseños importados está mayoritariamente en product_models.reference_code; product_skus.sap_material_code está vacío excepto el piloto. Se vincularán exclusivamente códigos exactos presentes como material padre SAP, sin inferencias de nombres y sin crear productos.

La consulta /material-lists todavía utiliza JSON extraído del Excel; pasará a consultar PostgreSQL. El Excel SAP actual está inicialmente bloqueado por Excel/otro proceso, por lo que se solicitó guardarlo y cerrarlo. No se usará silenciosamente la extracción antigua para una nueva carga.

Ampliaciones previstas: metadatos opcionales de materiales, unidades, versiones y trazabilidad de importaciones SAP, relación por código, ejecuciones MRP con entrada y resultado persistidos. Endpoints: importación SAP, maestro/catálogos, vínculos y cálculo MRP. Frontend: importador SAP, administración de materiales y pestañas MRP. Se mantienen el explorador y el editor de ingeniería.

Pruebas: normalización por base, cinco productos, consolidación código+unidad, materiales diferentes de igual familia/descripción, múltiples grapas/pegamentos, alternativas separadas, negativos señalados, productos sin vínculo, idempotencia de importación, roles/RLS y comparación de huellas al finalizar.
