// input/ の PowerPoint（.pptx）から、スライドごとの見出し・本文・表・グラフの数値・SmartArt・画像・発表者ノートを取り出す。
// 外部ライブラリなし（ZIPを直接読む）。見た目（配置・色）は取り出さない：スライドは SAKUSURA 標準の12枚で作り直すため。
// 使い方: npm run extract -- "input/資料.pptx" [--out 保存先.md] [--media 画像の保存先フォルダー]（tools/extract.mjs）
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, join, posix } from 'node:path';
import { readZip, decodeXml as decode } from './lib/zip.mjs';

const SKIPPED_PLACEHOLDERS = new Set(['sldNum', 'dt', 'ftr', 'hdr']);
const TITLE_PLACEHOLDERS = new Set(['title', 'ctrTitle']);

// 関係ファイル（_rels/*.rels）：rId → 参照先のパス（ZIP内の絶対パス）と種類。
function relsOf(zip, part) {
  const path = posix.join(posix.dirname(part), '_rels', `${posix.basename(part)}.rels`);
  const rels = new Map();
  if (!zip.has(path)) return rels;
  for (const tag of zip.text(path).match(/<Relationship\b[^>]*>/g) || []) {
    const attr = name => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
    if (attr('TargetMode') === 'External') continue;
    const target = decode(attr('Target') ?? '');
    rels.set(attr('Id'), { type: attr('Type')?.split('/').pop(), path: target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join(posix.dirname(part), target)) });
  }
  return rels;
}
// 段落ごとの文字（改行 <a:br/> は空白）。lvl は箇条書きの階層。
function paragraphs(xml) {
  return (xml.match(/<a:p>[\s\S]*?<\/a:p>|<a:p [\s\S]*?<\/a:p>/g) || []).map(paragraph => ({
    level: Number(paragraph.match(/<a:pPr\b[^>]*\blvl="(\d)"/)?.[1] ?? 0),
    text: decode((paragraph.match(/<a:t>[^<]*<\/a:t>|<a:t [^>]*>[^<]*<\/a:t>|<a:br\b[^>]*\/>/g) || []).map(run => run.startsWith('<a:br') ? ' ' : run.replace(/<[^>]+>/g, '')).join('')).replace(/\s+/g, ' ').trim(),
  })).filter(item => item.text);
}
const cell = text => text.replace(/\|/g, '\\|');
const markdownTable = rows => rows.length ? [`| ${rows[0].map(cell).join(' | ')} |`, `|${rows[0].map(() => '---').join('|')}|`, ...rows.slice(1).map(row => `| ${row.map(cell).join(' | ')} |`)].join('\n') : '';

function table(xml) {
  const rows = (xml.match(/<a:tr\b[\s\S]*?<\/a:tr>/g) || []).map(row => (row.match(/<a:tc\b[\s\S]*?<\/a:tc>/g) || []).map(column => paragraphs(column).map(item => item.text).join(' ')));
  const width = Math.max(0, ...rows.map(row => row.length));
  return markdownTable(rows.map(row => [...row, ...Array(width - row.length).fill('')]));
}
// グラフ：種類・タイトルと、系列ごとの数値（PowerPointが保存している表示値）を表にする。
function chart(xml) {
  const kind = xml.match(/<c:(\w+)Chart>/)?.[1] ?? 'グラフ';
  const title = xml.match(/<c:title>[\s\S]*?<\/c:title>/)?.[0];
  const values = part => (part?.match(/<c:pt idx="\d+">\s*(?:<c:formatCode>[^<]*<\/c:formatCode>\s*)?<c:v>[^<]*<\/c:v>/g) || []).map(point => decode(point.match(/<c:v>([^<]*)<\/c:v>/)[1]));
  const series = (xml.match(/<c:ser>[\s\S]*?<\/c:ser>/g) || []).map((ser, index) => ({
    name: decode(ser.match(/<c:tx>[\s\S]*?<c:v>([^<]*)<\/c:v>/)?.[1] ?? `系列${index + 1}`),
    categories: values(ser.match(/<c:(?:cat|xVal)>[\s\S]*?<\/c:(?:cat|xVal)>/)?.[0]),
    values: values(ser.match(/<c:(?:val|yVal)>[\s\S]*?<\/c:(?:val|yVal)>/)?.[0]),
  }));
  const categories = series.find(item => item.categories.length)?.categories ?? series[0]?.values.map((_, index) => String(index + 1)) ?? [];
  const rows = [['項目', ...series.map(item => item.name)], ...categories.map((name, index) => [name, ...series.map(item => item.values[index] ?? '')])];
  return [`[グラフ：${kind}${title ? `「${paragraphs(title).map(item => item.text).join(' ')}」` : ''}]`, '', markdownTable(rows)].join('\n');
}

export async function extractPptx(path, { media } = {}) {
  const zip = readZip(await readFile(path), 'PowerPointファイル');
  const presentation = 'ppt/presentation.xml';
  const presentationRels = relsOf(zip, presentation);
  const order = (zip.text(presentation).match(/<p:sldId\b[^>]*>/g) || []).map(tag => presentationRels.get(tag.match(/r:id="([^"]+)"/)?.[1])?.path).filter(Boolean);
  const saved = [];
  if (media) await mkdir(media, { recursive: true });
  const slides = [];
  for (const [index, part] of order.entries()) {
    const number = String(index + 1).padStart(2, '0');
    // 互換用の代替表示（mc:Fallback）は同じ内容の重複なので除く。
    const xml = zip.text(part).replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '');
    const rels = relsOf(zip, part);
    let title = '';
    // lines の要素は、文字の図形なら { text, size }（size は最大の文字サイズ・pt×100）、それ以外は Markdown の文字列。
    const lines = [];
    for (const shape of xml.match(/<p:sp[ >][\s\S]*?<\/p:sp>|<p:graphicFrame[ >][\s\S]*?<\/p:graphicFrame>|<p:pic[ >][\s\S]*?<\/p:pic>/g) || []) {
      const placeholder = shape.match(/<p:ph\b[^>]*\btype="(\w+)"/)?.[1];
      if (SKIPPED_PLACEHOLDERS.has(placeholder)) continue;
      const description = decode(shape.match(/<p:cNvPr\b[^>]*\bdescr="([^"]*)"/)?.[1] ?? '').trim();
      if (shape.startsWith('<p:pic')) {
        const target = rels.get(shape.match(/<a:blip\b[^>]*r:embed="([^"]+)"/)?.[1]);
        if (!target || !zip.has(target.path)) continue;
        const name = posix.basename(target.path);
        let line = `[画像：${name}${description ? `／説明「${description}」` : ''}]`;
        if (media) {
          const file = join(media, `slide${number}-${name}`);
          await writeFile(file, zip.read(target.path));
          saved.push(file);
          line += `（保存：${file.replaceAll('\\', '/')}）`;
        }
        lines.push(line);
      } else if (shape.includes('<a:tbl>')) lines.push(table(shape));
      else if (shape.includes('<c:chart ')) {
        const target = rels.get(shape.match(/<c:chart\b[^>]*r:id="([^"]+)"/)?.[1]);
        if (target && zip.has(target.path)) lines.push(chart(zip.text(target.path)));
      } else if (shape.includes('<dgm:relIds ')) {
        // SmartArt：図形の文字だけを、データファイルの並び順で取り出す。
        const target = rels.get(shape.match(/<dgm:relIds\b[^>]*r:dm="([^"]+)"/)?.[1]);
        if (target && zip.has(target.path)) lines.push(['[図解（SmartArt）]', ...paragraphs(zip.text(target.path)).map(item => `- ${item.text}`)].join('\n'));
      } else {
        const items = paragraphs(shape);
        if (!items.length) continue;
        if (TITLE_PLACEHOLDERS.has(placeholder) && !title) { title = items.map(item => item.text).join(' '); continue; }
        // ページ番号だけの文字（02 など）は除く。
        if (items.length === 1 && /^\d{1,3}$/.test(items[0].text) && Number(items[0].text) === index + 1) continue;
        const size = Math.max(0, ...(shape.match(/<a:rPr\b[^>]*\bsz="(\d+)"/g) || []).map(tag => Number(tag.match(/sz="(\d+)"/)[1])));
        lines.push({ text: items.map(item => placeholder === 'subTitle' ? item.text : `${'  '.repeat(item.level)}- ${item.text}`).join('\n'), plain: items.map(item => item.text).join(''), size });
      }
    }
    const notes = [...rels.values()].find(item => item.type === 'notesSlide');
    const noteText = notes && zip.has(notes.path)
      ? (zip.text(notes.path).match(/<p:sp[ >][\s\S]*?<\/p:sp>/g) || []).filter(shape => /<p:ph\b[^>]*\btype="body"/.test(shape)).flatMap(shape => paragraphs(shape).map(item => item.text))
      : [];
    slides.push({ title, lines, noteText, hidden: /<p:sld\b[^>]*\bshow="0"/.test(xml) });
  }
  // 半数以上（3枚以上）のスライドに同じ文字で出るもの（ヘッダー・ロゴ文字など）は、冒頭に1回だけ載せる。
  const counts = new Map();
  for (const slide of slides) for (const plain of new Set(slide.lines.filter(line => line.plain).map(line => line.plain))) counts.set(plain, (counts.get(plain) ?? 0) + 1);
  const common = new Set([...counts].filter(([, count]) => count >= Math.max(3, slides.length / 2)).map(([plain]) => plain));
  const sections = [`# ${basename(path)}（PowerPoint・${slides.length}枚）`];
  if (common.size) sections.push(`全スライド共通の文字（ヘッダーなど。各スライドからは省略）：${[...common].map(text => `「${text}」`).join('・')}`);
  for (const [index, slide] of slides.entries()) {
    let lines = slide.lines.filter(line => !common.has(line.plain));
    let title = slide.title, estimated = false;
    // タイトル枠を使っていないスライドは、いちばん大きい文字（数字だけ・3文字以下は除く）を見出しと推定する。
    if (!title) {
      const candidate = lines.filter(line => line.plain && line.size && line.plain.length > 3 && !/^[\d\s.#]+$/.test(line.plain)).sort((a, b) => b.size - a.size)[0];
      if (candidate) { title = candidate.plain; estimated = true; lines = lines.filter(line => line !== candidate); }
    }
    sections.push([
      `## スライド ${index + 1}：${title || '（見出しなし）'}${estimated ? '（推定）' : ''}${slide.hidden ? '（非表示スライド）' : ''}`,
      ...lines.map(line => line.text ?? line),
      ...(slide.noteText.length ? [`### 発表者ノート\n${slide.noteText.join('\n')}`] : []),
    ].join('\n\n'));
  }
  return { text: sections.join('\n\n'), slides: slides.length, media: saved };
}
