"""Export source PDF artwork and editable text anchors without applying a slide template."""
import sys
import json
import math
import re
from pathlib import Path
import xml.etree.ElementTree as ET

try:
    import fitz
except ImportError:
    print('PDF_ENGINE_MISSING', file=sys.stderr)
    sys.exit(2)

source, destination = map(Path, sys.argv[1:3])
destination.mkdir(parents=True, exist_ok=True)
document = fitz.open(source)
if document.is_encrypted or not 1 <= len(document) <= 60:
    raise ValueError('PDF_PAGE_COUNT')
svg_ns = 'http://www.w3.org/2000/svg'
ET.register_namespace('', svg_ns)
ET.register_namespace('xlink', 'http://www.w3.org/1999/xlink')
manifest = {'version': 1, 'pages': [], 'fonts': []}
font_names = {}
for page in document:
    for xref, ext, kind, base, resource, *rest in page.get_fonts(full=True):
        if xref in font_names:
            continue
        name, extension, font_type, data = document.extract_font(xref)
        if extension not in ('ttf', 'otf', 'woff') or not data:
            continue
        asset = f'font-{xref}.{extension}'
        (destination / asset).write_bytes(data)
        family = f'pdf-font-{xref}'
        clean = re.sub(r'^[A-Z]{6}\+', '', base)
        font_names[xref] = {'name': clean, 'family': family, 'file': asset}
        manifest['fonts'].append(font_names[xref])

for index, page in enumerate(document):
    tree = ET.fromstring(page.get_svg_image(text_as_path=True))
    parents = {child: parent for parent in tree.iter() for child in parent}
    spans, anchors = [], []
    for block in page.get_text('rawdict')['blocks']:
        for line in block.get('lines', []):
            for span in line['spans']:
                chars = span.get('chars', [])
                text = ''.join(char['c'] for char in chars)
                if not text.strip():
                    continue
                bbox = span['bbox']
                identity = f'text-{len(spans) + 1:04}'
                family = next((font['family'] for font in font_names.values() if font['name'] == span['font']), '')
                spans.append({'id': identity, 'text': text, 'x': bbox[0], 'y': bbox[1], 'width': bbox[2] - bbox[0], 'height': bbox[3] - bbox[1], 'fontSize': span['size'], 'fontFamily': family, 'fontName': span['font'], 'color': f"#{span['color']:06x}", 'bold': bool(span['flags'] & 16), 'editable': False})
                for char in chars:
                    anchors.append((char['origin'][0], char['origin'][1], len(spans) - 1))
    matched = 0
    for element in list(tree.iter(f'{{{svg_ns}}}use')):
        if 'data-text' not in element.attrib:
            continue
        matrix = re.fullmatch(r'matrix\(([^)]+)\)', element.get('transform', ''))
        if not matrix or not anchors:
            continue
        values = [float(value) for value in re.split(r'[,\s]+', matrix[1])]
        if len(values) != 6:
            continue
        x, y = values[4:]
        nearest = min(anchors, key=lambda anchor: (anchor[0] - x) ** 2 + (anchor[1] - y) ** 2)
        if math.hypot(nearest[0] - x, nearest[1] - y) > 1.5:
            continue
        span = spans[nearest[2]]
        element.set('data-text-id', span['id'])
        span['editable'] = True
        matched += 1
    file = f'page-{index + 1:03}.svg'
    (destination / file).write_text(ET.tostring(tree, encoding='unicode'), encoding='utf-8')
    manifest['pages'].append({'page': index + 1, 'width': page.rect.width, 'height': page.rect.height, 'file': file, 'texts': spans, 'editableGlyphs': matched})

(destination / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(json.dumps({'pages': len(manifest['pages']), 'fonts': len(manifest['fonts'])}))
