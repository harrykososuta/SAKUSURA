import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { extractPptx } from '../tools/extract-pptx.mjs';
import { extractDocx } from '../tools/extract-docx.mjs';

// 最小限のZIPを組み立てる（テスト用）。偶数番目は無圧縮、奇数番目は圧縮して両方の読み取りを確かめる。
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  Object.entries(files).forEach(([name, content], index) => {
    const raw = Buffer.from(content), data = index % 2 ? deflateRawSync(raw) : raw, path = Buffer.from(name);
    const head = (signature, size) => { const buffer = Buffer.alloc(size); buffer.writeUInt32LE(signature, 0); return buffer; };
    const local = head(0x04034b50, 30);
    local.writeUInt16LE(index % 2 ? 8 : 0, 8); local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(path.length, 26);
    const central = head(0x02014b50, 46);
    central.writeUInt16LE(index % 2 ? 8 : 0, 10); central.writeUInt32LE(crc32(raw), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(path.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, path, data); centrals.push(central, path);
    offset += 30 + path.length + data.length;
  });
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const rels = items => `<Relationships>${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas/${type}" Target="${target}"/>`).join('')}</Relationships>`;
const text = (body, { ph, size } = {}) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody>${body.map(([value, level]) => `<a:p>${level ? `<a:pPr lvl="${level}"/>` : ''}<a:r><a:rPr lang="ja-JP"${size ? ` sz="${size}"` : ''}/><a:t>${value}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
const slide = (shapes, attrs = '') => `<p:sld${attrs}><p:cSld><p:spTree>${shapes.join('')}</p:spTree></p:cSld></p:sld>`;

test('PowerPoint：スライド順・見出し・階層・表・グラフ・SmartArt・画像・ノートを取り出し、ヘッダーとページ番号は省く', async () => {
  const header = text([['共通ヘッダー']], { size: 1200 });
  const files = {
    'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/><p:sldId id="258" r:id="rId4"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': rels([['rId2', 'slide', 'slides/slide1.xml'], ['rId3', 'slide', 'slides/slide2.xml'], ['rId4', 'slide', 'slides/slide3.xml']]),
    // 1枚目（並び順の先頭は slide2.xml）：タイトル枠・箇条書きの階層・表・ノート
    'ppt/slides/slide2.xml': slide([header, text([['動脈の構造']], { ph: 'title' }), text([['内膜', 0], ['内皮細胞 &amp; 基底膜', 1]], { ph: 'body' }), text([['1']], { ph: 'sldNum' }),
      '<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>層</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>厚さ</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody><a:p><a:r><a:t>中膜</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>1|2 mm</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>']),
    'ppt/slides/_rels/slide2.xml.rels': rels([['rId9', 'notesSlide', '../notesSlides/notesSlide1.xml']]),
    'ppt/notesSlides/notesSlide1.xml': `<p:notes><p:cSld><p:spTree>${text([['ここで内膜を説明する']], { ph: 'body' })}${text([['1']], { ph: 'sldNum' })}</p:spTree></p:cSld></p:notes>`,
    // 2枚目：タイトル枠なし（大きい文字を見出しと推定）・ページ番号・画像・グラフ・SmartArt
    'ppt/slides/slide1.xml': slide([header, text([['02']], { size: 6000 }), text([['流量は増える']], { size: 4000 }), text([['補足の文']], { size: 2000 }),
      '<p:pic><p:nvPicPr><p:cNvPr id="5" name="図" descr="血管の断面"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic>',
      '<p:graphicFrame><a:graphic><a:graphicData><c:chart xmlns:c="x" r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame>',
      '<p:graphicFrame><a:graphic><a:graphicData><dgm:relIds xmlns:dgm="x" r:dm="rId3"/></a:graphicData></a:graphic></p:graphicFrame>']),
    'ppt/slides/_rels/slide1.xml.rels': rels([['rId1', 'image', '../media/image1.png'], ['rId2', 'chart', '../charts/chart1.xml'], ['rId3', 'diagramData', '../diagrams/data1.xml']]),
    'ppt/media/image1.png': 'PNG',
    'ppt/charts/chart1.xml': '<c:chartSpace><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>流量</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:ser><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>術後</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>1週</c:v></c:pt><c:pt idx="1"><c:v>4週</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:pt idx="0"><c:v>350</c:v></c:pt><c:pt idx="1"><c:v>600</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>',
    'ppt/diagrams/data1.xml': '<dgm:dataModel><dgm:ptLst><dgm:pt><dgm:t><a:p><a:r><a:t>評価</a:t></a:r></a:p></dgm:t></dgm:pt><dgm:pt><dgm:t><a:p><a:r><a:t>作製</a:t></a:r></a:p></dgm:t></dgm:pt></dgm:ptLst></dgm:dataModel>',
    // 3枚目：非表示スライド
    'ppt/slides/slide3.xml': slide([header, text([['予備']], { ph: 'title' })], ' show="0"'),
  };
  const directory = await mkdtemp(join(tmpdir(), 'pptx-'));
  try {
    const path = join(directory, 'sample.pptx');
    await writeFile(path, zip(files));
    const result = await extractPptx(path, { media: join(directory, 'media') });
    const md = result.text;
    assert.equal(result.slides, 3);
    assert.ok(md.indexOf('スライド 1：動脈の構造') < md.indexOf('スライド 2：流量は増える（推定）'));
    assert.match(md, /- 内膜\n {2}- 内皮細胞 & 基底膜/);
    assert.match(md, /\| 層 \| 厚さ \|\n\|---\|---\|\n\| 中膜 \| 1\\\|2 mm \|/);
    assert.match(md, /### 発表者ノート\nここで内膜を説明する/);
    assert.match(md, /\[画像：image1\.png／説明「血管の断面」\]/);
    assert.match(md, /\[グラフ：bar「流量」\]\n\n\| 項目 \| 術後 \|\n\|---\|---\|\n\| 1週 \| 350 \|\n\| 4週 \| 600 \|/);
    assert.match(md, /\[図解（SmartArt）\]\n- 評価\n- 作製/);
    assert.match(md, /スライド 3：予備（非表示スライド）/);
    assert.match(md, /全スライド共通の文字.*「共通ヘッダー」/);
    assert.equal(md.match(/共通ヘッダー/g).length, 1);
    assert.doesNotMatch(md, /- 02|- 1\n/);
    assert.deepEqual(await readdir(join(directory, 'media')), ['slide02-image1.png']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('Word：見出しと箇条書きを Markdown にする（共通のZIP読み取りを使う）', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'docx-'));
  try {
    const path = join(directory, 'sample.docx');
    await writeFile(path, zip({ 'word/document.xml': '<w:document><w:body><w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>はじめに</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>要点 &lt;A&gt;</w:t></w:r></w:p></w:body></w:document>' }));
    assert.equal(await extractDocx(path), '## はじめに\n\n- 要点 <A>');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
