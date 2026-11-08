// 講義をPDF（16:9・1スライド1ページ・文字はテキストのまま）で exports/ に保存する（作成は tools/lib/pdf.mjs）。
// 使い方: npm run pdf -- --lecture <slug>  → exports/<slug>.pdf（上書き）
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { ROOT, argumentValue } from './lib/project.mjs';
import { exportPdf, pdfFileOf } from './lib/pdf.mjs';

try {
  const name = argumentValue(process.argv, '--lecture', 'demo');
  const started = Date.now();
  const pdf = await exportPdf(name);
  await mkdir(join(ROOT, 'exports'), { recursive: true });
  const path = join(ROOT, 'exports', pdfFileOf(name));
  await writeFile(path, pdf);
  console.log(`PDF: ${relative(ROOT, path)}（${Math.ceil(pdf.length / 1024)}KB・処理 ${Math.round((Date.now() - started) / 1000)}秒）`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
