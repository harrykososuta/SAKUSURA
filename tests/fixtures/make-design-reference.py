"""開発時に一度だけ作る、PDF読み込み検査用の自作見本。アプリの実行時には不要。"""
from pathlib import Path
import fitz

root = Path(__file__).resolve().parents[2]
output = root / 'tests' / 'fixtures' / 'design-reference.pdf'
if output.exists():
    raise SystemExit('Fixture already exists; keeping the existing PDF.')
document = fitz.open()
for index, heading in enumerate(['Design Reference', 'Make room for the message']):
    page = document.new_page(width=960, height=540)
    page.draw_rect(fitz.Rect(0, 0, 960, 540), color=None, fill=(0.988, 0.980, 0.965))
    page.draw_rect(fitz.Rect(0, 0, 28, 540), color=None, fill=(0.082, 0.306, 0.337))
    page.draw_rect(fitz.Rect(28, 0, 32, 540), color=None, fill=(0.855, 0.435, 0.329))
    page.insert_text((760, 46), 'REFERENCE', fontsize=11, fontname='hebo', color=(0.18, 0.22, 0.24))
    page.insert_text((92, 145), heading, fontsize=34 if index == 0 else 26, fontname='hebo', color=(0.18, 0.22, 0.24))
    page.draw_line((92, 180), (865, 180), color=(0.082, 0.306, 0.337), width=1.5)
    rows = ['A quiet background', 'Teal lines and coral accents', 'Clear type and generous spacing']
    for row, text in enumerate(rows):
        y = 245 + row * 65
        page.insert_text((104, y), f'{row + 1:02}', fontsize=14, fontname='hebo', color=(0.18, 0.22, 0.24))
        page.insert_text((162, y), text, fontsize=18, color=(0.40, 0.43, 0.45))
        page.draw_line((92, y + 20), (865, y + 20), color=(0.84, 0.84, 0.81), width=0.6)
    page.insert_text((92, 505), 'Design input test fixture', fontsize=11, color=(0.50, 0.52, 0.53))
    page.insert_text((840, 505), str(index + 1).zfill(2), fontsize=11, fontname='hebo', color=(0.18, 0.22, 0.24))
document.save(output, garbage=4, deflate=True)
report = root / 'reports' / 'design-pdf'
report.mkdir(parents=True, exist_ok=True)
for index, page in enumerate(document):
    page.get_pixmap(matrix=fitz.Matrix(1, 1)).save(report / f'reference-page-{index + 1}.png')
print(f'Created a {len(document)}-page PDF fixture and rendered both pages for inspection.')
