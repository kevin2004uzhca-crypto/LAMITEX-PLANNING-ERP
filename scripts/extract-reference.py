"""Extract the two original reference images without modifying them."""
from pathlib import Path
from zipfile import ZipFile
import hashlib, json, base64
root = Path(__file__).resolve().parents[1]
source = root / 'BOM - LAMITEX CATALOGO.docx'
with ZipFile(source) as archive:
    images = {kind:base64.b64encode(archive.read(name)).decode('ascii') for kind,name in [('catalog','word/media/image2.png'),('diagram','word/media/image3.png')]}
result = {'source':source.name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'images':images}
(root/'src/data/pilot-reference.json').write_text(json.dumps(result),encoding='utf-8')
print('Original catalog and BOM diagram extracted; no image or source edits.')
