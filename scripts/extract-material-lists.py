"""Read corrected originals without saving workbooks; preserve every SAP position."""
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib, json, math, sys
import openpyxl
sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parents[1]
files = ['Arbol_estructura_lamitex.xlsx', 'Componentes_arbol_lamitex.xlsx', 'Datos_iniciales_lamitex.xlsx', 'EXPORT_ListasMateriales3001_3034.xlsx']
sources = []
def read(name):
    path = root/name
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    rows = [(i, list(r)) for i,r in enumerate(ws.values,1) if any(v is not None for v in r)]
    sources.append(dict(file=name, sha256=digest, sheet=ws.title, rows=len(rows)-1))
    wb.close()
    assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, 'Source changed while reading'
    return rows[1:]
tree, components, initial, sap = [read(f) for f in files]
legacy = defaultdict(list)
for row,v in initial:
    legacy[v[0]].append(dict(sap=v[1], name=v[2], row=row))
issues = []
for key, values in legacy.items():
    if len(values)>1: issues.append(dict(code='DUPLICATE_LEGACY', source=files[2], row=values[0]['row'], message=f'ID {key}: '+', '.join(str(v['sap']) for v in values)))
by_bom = defaultdict(list)
for row,v in tree: by_bom[v[2]].append((row,v))
component_map = {(v[1],v[0]):v for _,v in components}
for bom, rows in by_bom.items():
    ids = Counter(v[1] for _,v in rows)
    nodes = {v[1]:v for _,v in rows}
    for row,v in rows:
        problem = []
        if ids[v[1]]>1: problem.append('componente repetido')
        parent = v[4] if v[4] not in (None,'NULL','') else None
        if parent is not None and parent not in nodes: problem.append('padre fuera del BOM')
        if parent is None and v[5]!=1: problem.append('nivel raíz incorrecto')
        if parent in nodes and v[5]!=nodes[parent][5]+1: problem.append('nivel no coincide con padre')
        seen = {v[1]}; cursor = parent
        while cursor in nodes:
            if cursor in seen: problem.append('ciclo'); break
            seen.add(cursor); cursor=nodes[cursor][4]
        if not isinstance(v[6],(int,float)) or v[6]<=0: problem.append('cantidad inválida')
        ref=component_map.get((bom,v[1]))
        if not ref or ref[2]!=v[3]: problem.append('no coincide con Componentes_arbol')
        if problem: issues.append(dict(code='ENGINEERING',source=files[0],row=row,message=f'ID {bom}, componente {v[1]}: '+', '.join(problem)))
headers={}
for row,v in sap:
    key=json.dumps([str(v[0]),str(v[2]),str(v[1])],separators=(',',':'))
    h=headers.setdefault(key,dict(key=key,center=str(v[0]),material=str(v[2]),alternative=str(v[1]),description=v[3],baseQuantity=v[4],baseUnit=v[5],items=[],issues=[]))
    if h['baseQuantity']!=v[4] or h['baseUnit']!=v[5]: h['issues'].append(f'Fila {row}: base inconsistente')
    if not isinstance(v[4],(int,float)) or not math.isfinite(v[4]) or v[4]<=0: h['issues'].append(f'Fila {row}: cantidad base inválida')
    if not isinstance(v[8],(int,float)) or not math.isfinite(v[8]) or not v[9] or not v[7]: h['issues'].append(f'Fila {row}: componente, cantidad o unidad inválidos')
    h['items'].append(dict(position=v[6],code=v[7],quantity=v[8],unit=v[9],componentAlternative=v[10],name=v[11],sourceRow=row))
for h in headers.values():
    for message in h['issues']: issues.append(dict(code='SAP',source=files[3],row=0,message=message))
data=dict(extractedAt=datetime.now(timezone.utc).isoformat(),sources=sources,headers=list(headers.values()),issues=issues,stats=dict(engineeringRows=len(tree),engineeringGroups=len(by_bom),initialRows=len(initial),duplicateLegacyIds=sum(len(v)>1 for v in legacy.values()),sapRows=len(sap),sapHeaders=len(headers),materials=len(set(v[7] for _,v in sap)),negativeRows=sum(v[8]<0 for _,v in sap)))
(root/'src/data/material-lists.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
(root/'reports/corrected-source-validation.json').write_text(json.dumps({k:v for k,v in data.items() if k!='headers'},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(data['stats'],ensure_ascii=False)); print('Validation issues:',len(issues))
