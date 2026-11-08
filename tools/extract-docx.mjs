// input/ の Word（.docx）から本文を見出し付きで取り出す。外部ライブラリなし（ZIPを直接読む）。
// 使い方: npm run extract -- "input/資料.docx" [--out 保存先.md]（tools/extract.mjs）
import { readFile } from 'node:fs/promises';
import { readZip, decodeXml as decode } from './lib/zip.mjs';

export async function extractDocx(path) {
  const xml = readZip(await readFile(path), 'Wordファイル').text('word/document.xml');
  const lines = [];
  for (const paragraph of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []) {
    const text = decode((paragraph.match(/<w:t[^>]*>[^<]*<\/w:t>/g) || []).map(run => run.replace(/<[^>]+>/g, '')).join('')).trim();
    if (!text) continue;
    const style = paragraph.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? '';
    // 見出しスタイル（1, 2, Heading1 …）は Markdown の見出しに、箇条書きは「- 」にする。
    const level = style.match(/^(?:Heading)?([1-3])$/i)?.[1];
    lines.push(level ? `${'#'.repeat(Number(level) + 1)} ${text}` : paragraph.includes('<w:numPr>') || /^a4$/.test(style) ? `- ${text}` : text);
  }
  return lines.join('\n\n');
}
