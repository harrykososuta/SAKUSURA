// input/ に置いた元資料（PDF / Word / PowerPoint）の一覧と、どの講義の元資料になっているか（lecture.source）を表示する。
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, readJson } from './lib/project.mjs';
import { readZip } from './lib/zip.mjs';

// ページ数はPDF内の /Type /Page の数による目安。読み取りはClaudeのReadで行う。
const pageCount = buffer => (buffer.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
// PowerPointの枚数は ppt/slides/slideN.xml の数。
const slideCount = buffer => readZip(buffer).names.filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
const kindOf = (name, buffer) => /\.pdf$/i.test(name) ? `約${pageCount(buffer)}ページ` : /\.pptx$/i.test(name) ? `PowerPoint ${slideCount(buffer)}枚（npm run extract で本文・ノートを抽出）` : 'Word（npm run extract で本文を抽出）';
try {
  const files = (await readdir(join(ROOT, 'input'))).filter(name => /\.(pdf|docx|pptx)$/i.test(name));
  const sources = new Map();
  for (const entry of await readdir(join(ROOT, 'lectures'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try { const lecture = await readJson(join(ROOT, 'lectures', entry.name, 'lecture.json')); if (lecture.source) sources.set(lecture.source.replaceAll('\\', '/'), entry.name); } catch { /* 読めない講義は無視 */ }
  }
  if (!files.length) console.log('input/ に資料がありません。元資料のPDF・Word（.docx）・PowerPoint（.pptx）を input/ に置いてください。');
  for (const name of files) {
    const path = join(ROOT, 'input', name);
    const [info, buffer] = await Promise.all([stat(path), readFile(path)]);
    const used = sources.get(`input/${name}`);
    console.log(`${used ? '作成済み' : '未作成  '}  input/${name}  ${kindOf(name, buffer)} / ${info.size >= 1048576 ? `${(info.size / 1048576).toFixed(1)}MB` : `${Math.ceil(info.size / 1024)}KB`}${used ? `  → lectures/${used}` : ''}`);
  }
} catch (error) { console.error(error.code === 'ENOENT' ? 'input/ フォルダーがありません' : error.message); process.exitCode = 1; }
