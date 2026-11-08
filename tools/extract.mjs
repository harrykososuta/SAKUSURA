// input/ の元資料（Word / PowerPoint）から本文を取り出す。PDFはClaudeのReadで直接読む。
// 使い方: npm run extract -- "input/資料.docx" [--out 保存先.md]
//         npm run extract -- "input/資料.pptx" [--out 保存先.md] [--media 画像の保存先フォルダー]
import { writeFile } from 'node:fs/promises';
import { argumentValue } from './lib/project.mjs';
import { extractDocx } from './extract-docx.mjs';
import { extractPptx } from './extract-pptx.mjs';

try {
  const path = process.argv[2];
  const out = argumentValue(process.argv, '--out');
  const media = argumentValue(process.argv, '--media');
  let text, summary;
  if (/\.docx$/i.test(path ?? '')) { text = await extractDocx(path); summary = `${text.length}文字`; }
  else if (/\.pptx$/i.test(path ?? '')) {
    const result = await extractPptx(path, { media });
    text = result.text; summary = `${result.slides}枚・${text.length}文字${media ? `・画像${result.media.length}点を ${media} に保存` : ''}`;
  } else throw new Error('使い方: npm run extract -- "input/資料.docx|.pptx" [--out 保存先.md] [--media 画像の保存先（pptxのみ）]');
  if (out) { await writeFile(out, text, 'utf8'); console.log(`抽出: ${out}（${summary}）`); } else process.stdout.write(text + '\n');
} catch (error) { console.error(error.message); process.exitCode = 1; }
