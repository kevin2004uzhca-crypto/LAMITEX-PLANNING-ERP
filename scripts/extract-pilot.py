"""Build a traceable, review-only case from original sources; never persist to DB."""
from pathlib import Path
import json, hashlib, re, sys
from collections import Counter
import openpyxl
sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parents[1]
def read(name, sheet=None):
    book = openpyxl.load_workbook(root/name, read_only=True, data_only=True)
    ws = book[sheet] if sheet else book.worksheets[0]
    rows = [(i, list(row)) for i, row in enumerate(ws.iter_rows(values_only=True), 1) if any(v is not None for v in row)]
    title = ws.title
    book.close()
    return title, rows
tree_file = 'Arbol_estructura_lamitex.xlsx'
sheet, rows = read(tree_file)
nodes = []
for row, vals in rows[1:]:
    source_id, component, mattress, name, parent, level, quantity, lt = vals
    if mattress == 101:
        nodes.append(dict(id=component,bom='pilot-101-components-1-10',name=name,parent=None if parent in (None,'NULL','') else int(parent),declaredLevel=level,quantity=quantity,unit=None,leadTime=lt,sourceFile=tree_file,sourceSheet=sheet,sourceRow=row,sequence=row,sourceRecordId=source_id))
assert len(nodes) == 10
catalog_file = 'Base_de_datos_modelos_Resorpedic_2025.xlsx'
cat_sheet, cat_rows = read(catalog_file)
catalog = [dict(name=v[0],measure=v[1],width=v[2],length=v[3],height=v[4],sourceFile=catalog_file,sourceSheet=cat_sheet,sourceRow=r) for r,v in cat_rows[1:] if v[0]=='POCKET BOREAL MEMORY FOAM' and v[2:5]==[105,190,38]]
initial_file = 'Datos_iniciales_lamitex.xlsx'
init_sheet, init_rows = read(initial_file)
candidates = [dict(legacyId=v[0],sap=v[1],name=v[2],sourceFile=initial_file,sourceSheet=init_sheet,sourceRow=r) for r,v in init_rows[1:] if v[0]==101]
sap_file = 'EXPORT_ListasMateriales3001_3034.xlsx'
sap_sheet, sap_rows = read(sap_file)
headers = {}
for row, v in sap_rows[1:]:
    if v[2] != '3C83010': continue
    key = (v[0],v[2],v[1])
    if key not in headers: headers[key] = dict(center=v[0],material=v[2],alternative=v[1],baseQuantity=v[4],baseUnit=v[5],description=v[3],items=[])
    h = headers[key]
    assert h['baseQuantity']==v[4] and h['baseUnit']==v[5], 'Conflicting base quantity/unit'
    h['items'].append(dict(position=v[6],code=v[7],quantity=v[8],unit=v[9],componentAlternative=v[10],name=v[11],sourceFile=sap_file,sourceSheet=sap_sheet,sourceRow=row,unitUsage=v[8]/v[4] if isinstance(v[8],(int,float)) and isinstance(v[4],(int,float)) and v[4]>0 else None))
data = dict(status='PENDING_REVIEW',title='POCKET BOREAL MEMORY FOAM',sap='3C83010',dimensions='105 × 190 × 38 cm',legacyId=101,nodes=nodes,catalog=catalog,candidates=candidates,sapHeaders=list(headers.values()),sources=[dict(file=f,sha256=hashlib.sha256((root/f).read_bytes()).hexdigest()) for f in [tree_file,catalog_file,initial_file,sap_file]],notes=[
    f'La fuente actual contiene {len(candidates)} candidato(s) para colchon_id 101. Se conservan todos los nodos de ese ID sin filtrar componentes.',
    'Datos actualizados desde los Excel corregidos. La consulta de fuentes y el registro en la base son estados independientes.',
    'La fuente conserva el nombre Latex F + Convoluted Foam + Latex F para el componente 7.',
    'El Excel estructural no declara unidad de cantidad ni unidad temporal del lead time. No se suponen unidades.',
    'La columna bom_id del archivo estructural identifica filas, no cabeceras de BOM.',
    'En SAP se conservan por posición ambas columnas LMat alternativa: la segunda se registra como alternativa de componente, sin elegirla automáticamente.'
])
out=root/'src'/'data'; out.mkdir(parents=True,exist_ok=True)
(out/'pilot.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
counts=Counter(v[0] for _,v in init_rows[1:])
stats=dict(catalog_models=len(set(v[0] for _,v in cat_rows[1:])),catalog_variants=len(cat_rows)-1,initial_rows=len(init_rows)-1,sap_codes=sum(bool(v[1]) for _,v in init_rows[1:]),missing_sap=sum(not v[1] for _,v in init_rows[1:]),unique_legacy_ids=len(counts),repeated_legacy_ids={str(k):v for k,v in counts.items() if v>1},engineering_rows=len(rows)-1,sap_rows=len(sap_rows)-1,sap_negative_rows=sum(isinstance(v[8],(int,float)) and v[8]<0 for _,v in sap_rows[1:]),pilot_nodes=len(nodes),pilot_sap_headers=len(headers),pilot_sap_items=sum(len(h['items']) for h in headers.values()))
(root/'reports'/'source-counts.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(stats,ensure_ascii=False,indent=2))
print(json.dumps(list(headers.values()),ensure_ascii=False,indent=2)[:2600])
