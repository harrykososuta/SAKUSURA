// 講義ごとのCSS（LLMにおまかせのデザイン）：lectures/<slug>/theme.css を検査して lecture.json の theme.css に取り込む。
// npm run theme -- --lecture <slug>（--check で取り込まずに検査だけ、--clear で取り外して標準の見た目に戻す）
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lectureRoot, loadLecture, argumentValue, writeJson } from './lib/project.mjs';
import { validateThemeCss } from '../src/core.js';

// 「LLMにおまかせ」で作った講義に置く書き始めのCSS。使えるクラス名とルールをコメントで示す。
export const THEME_STARTER = `/* この講義だけのデザイン（LLMにおまかせ）。編集したら npm run theme -- --lecture <講義名> で取り込みます。
   ルール：セレクターはすべて #stage から始める（スライドの外を変えない）。@import・外部の url() は使えない（url は data: のみ）。
   スライドは 1920×1080px。中身の構造（レイアウトの種類）は共通で、見た目だけをここで変えます。
   主なクラス：
     #stage                 スライド全体（背景 --paper、線と図形の色 --primary / --accent / --soft / --marker）
     #stage .slide-header   右上のブランド名（#brand）と見出し上の補足文（#eyebrow）
     #stage .slide-footer   左下の表題（#lecture-title）と右下のページ番号（#slide-number）
     #stage #slide-content  本文の入れ物。レイアウトごとに .layout-title / .layout-agenda / .layout-statement / .layout-flow /
                            .layout-figure / .layout-steps / .layout-compare / .layout-table / .layout-chat / .layout-bars /
                            .layout-code / .layout-timeline / .layout-cycle / .layout-stack / .layout-message / .layout-takehome
     #stage h1 .heading-text  見出し（.section-number は通し番号）　#stage .deck-number  サムネイルの #番号
     #stage .blocks > .reveal  本文の各項目（.block-label 小見出し / .block-text 本文 / .block-detail 補足 / .block-index 番号）
     #stage .slide-note     まとめの一文　#stage .slide-image  画像　#stage strong  **強調** した語
   カテゴリの色（--primary など）はスライドの要素に直接書かれているので、変える場合は !important を付けます。
   要点の表示（.reveal の opacity・transition）とアニメーションの仕組みは変えないでください。 */
#stage {
}
`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const name = argumentValue(process.argv, '--lecture', 'demo');
    const lecture = await loadLecture(name);
    if (process.argv.includes('--clear')) {
      delete lecture.theme; await writeJson(join(lectureRoot(name), 'lecture.json'), lecture);
      console.log(`lectures/${name}: 講義のCSSを外しました（標準の見た目に戻ります）。theme.css のファイルは残しています。`);
    } else {
      const css = (await readFile(join(lectureRoot(name), 'theme.css'), 'utf8')).replace(/^﻿/, '');
      const errors = validateThemeCss(css);
      if (errors.length) throw new Error(`theme.css を取り込めません:\n${errors.map(message => `- ${message}`).join('\n')}`);
      if (process.argv.includes('--check')) console.log(`検査OK：theme.css（${css.length}文字）は取り込めます。`);
      else { lecture.theme = { css }; await writeJson(join(lectureRoot(name), 'lecture.json'), lecture); console.log(`lectures/${name}: theme.css（${css.length}文字）を取り込みました。再生画面・編集画面を開き直すと反映されます。`); }
    }
  } catch (error) { console.error(error.code === 'ENOENT' ? 'theme.css がありません。lectures/<講義名>/theme.css を作ってください。' : error.message); process.exitCode = 1; }
}
