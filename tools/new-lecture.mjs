import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lectureRoot, argumentValue, writeJson } from './lib/project.mjs';
import { DECK_SLIDES } from '../src/core.js';
import { createCategoryDesignStore } from './lib/category-design-store.mjs';
import { designChoices, designRecord, formatDesignChoices, LLM_DESIGN_ID } from './lib/design-choices.mjs';
import { THEME_STARTER } from './theme.mjs';

// SAKUSURA標準構成（12枚）：1 サムネイル（#演題番号）/ 2 アジェンダ / 3〜11 本編（5・9枚目は一文スライド）/ 12 Take Home Message 4つ。
const MESSAGE_AT = [4, 8];
const FLOW_AT = 5;
const block = (id, text, label) => ({ id, ...(label ? { label } : {}), text });
function slideFor(index, count, title) {
  if (index === 0) return { layout: 'title', eyebrow: 'Business Presentation', title, blocks: [block('sub', 'サブタイトル：**重要語**を1つだけ強調', '発表日・発表者')] };
  if (index === 1) return { layout: 'agenda', eyebrow: 'Agenda', title: '本日のアジェンダ', blocks: [1, 2, 3].map(n => block(`a${n}`, `章${n}の要点`, `章${n}`)).concat(block('a4', 'Take Home Message', 'まとめ')) };
  if (MESSAGE_AT.includes(index)) return { layout: 'message', eyebrow: '章の名前', title: `要所で伝えたい**一文**（${index + 1}枚目）`, blocks: [] };
  if (index === FLOW_AT) return { layout: 'flow', eyebrow: '章の名前', title: `スライド ${index + 1}：流れを**フロー図**で示す`, blocks: [1, 2, 3].map(n => block(`f${n}`, `一言の説明${n}`, `手順${n}`)) };
  if (index === count - 1) return { layout: 'takehome', eyebrow: 'まとめ', title: 'Take Home Message', blocks: [1, 2, 3, 4].map(n => block(`t${n}`, `行動につながる説明${n}`, `キーワード${n}`)) };
  return { layout: 'statement', eyebrow: '章の名前', title: `スライド ${index + 1}：**結論**を1文で`, blocks: [block('main', 'ここに根拠を記入します。**重要語**だけ濃いグレー', '要点')] };
}
try {
  const args = process.argv.slice(2);
  const name = argumentValue(args, '--name', args[0]);
  const title = argumentValue(args, '--title', '新しい講義');
  const number = argumentValue(args, '--number', '01');
  const source = argumentValue(args, '--source');
  const categoryArg = argumentValue(args, '--category');
  const motion = argumentValue(args, '--motion');
  const design = argumentValue(args, '--design');
  const rules = argumentValue(args, '--rules');
  const count = DECK_SLIDES;
  if (!/^\d{1,4}$/.test(number)) throw new Error('--number は数字の演題番号です（例: 07）');
  // カテゴリは designs/category-presets.json の一覧から ID か名前で選ぶ。一覧が空なら指定しない。
  const categories = (await createCategoryDesignStore().get()).categories;
  const chosen = categories.find(item => item.id === categoryArg || item.name === categoryArg);
  if (categories.length && !chosen) throw new Error(`--category でカテゴリを指定してください（${categories.map(item => `${item.id}=${item.name}`).join(' / ')}）`);
  if (!categories.length && categoryArg) throw new Error('カテゴリがまだありません。デザイン画面の「カテゴリごとのデザイン設定」で追加するか、--category を外してください。');
  const category = chosen?.id;
  if (motion !== undefined && motion !== 'rich') throw new Error('--motion は rich（動き多め）だけです。標準の動きでは指定しません。');
  // どのデザインで作るかは、ユーザーに確認してから --design で指定する（AGENTS.md「デザインの確認」）。
  const choices = await designChoices();
  if (!choices.some(item => item.id === design)) throw new Error(`${design ? `デザイン ${design} はありません。` : ''}どのデザインで作るかをユーザーに確認し、--design <id> で指定してください。
${formatDesignChoices(choices)}`);
  // SAKUSURAの構成ルール（12枚・一文スライド2枚・Take Home Message 4つ など）を守るかも、毎回ユーザーに確認して --rules で指定する。
  if (!['sakusura', 'free'].includes(rules)) throw new Error('SAKUSURAの構成ルールを守るかをユーザーに確認し、--rules sakusura（守る）か --rules free（枚数・構成も自由）で指定してください。');
  // CSSのデザインテンプレートは、そのCSSを講義へ写す（以後はテンプレートと独立して直せる）。
  const css = (await designRecord(design))?.css;
  const directory = lectureRoot(name);
  await mkdir(directory); // 既存講義を上書きしない。
  const slides = Array.from({ length: count }, (_, index) => {
    const slide = slideFor(index, count, title);
    return { id: String(index + 1).padStart(3, '0'), ...slide, narration: '', plannedSeconds: 600 / count, gapAfter: 0, cues: slide.blocks.map(item => ({ at: 0, target: item.id })) };
  });
  await writeJson(join(directory, 'lecture.json'), { version: 1, title, number, ...(category ? { category } : {}), ...(motion ? { motion } : {}), design, rules, ...(css ? { theme: { css } } : {}), ...(source ? { source: source.replaceAll('\\', '/') } : {}), description: '', brand: 'SAKUSURA', targetSeconds: 600, slides });
  // LLMにおまかせ・CSSテンプレートは、講義のCSSを theme.css として置く（編集後に npm run theme で取り込む）。
  if (design === LLM_DESIGN_ID || css) await writeFile(join(directory, 'theme.css'), css ?? THEME_STARTER, { flag: 'wx' });
  console.log(`作成: lectures/${name}/lecture.json（#${number} / ${chosen?.name ?? 'カテゴリなし'}${motion ? ' / 動き多め' : ''} / デザイン ${choices.find(item => item.id === design).name} / 構成ルール ${rules === 'free' ? '自由' : 'SAKUSURA'} / ${count}枚 / 予定600秒）\n${design === LLM_DESIGN_ID ? `デザインは lectures/${name}/theme.css に書き、npm run theme -- --lecture ${name} で取り込みます。\n` : ''}台本を記入し、npm run tts -- --lecture ${name} --check で対象を確認してください。`);
} catch (error) { console.error(error.code === 'EEXIST' ? '同名の講義が存在します。別名を指定してください。' : error.message); process.exitCode = 1; }
