import { validatePlacement } from './placement.js';
import { validateShapes } from './shapes.js';
import { ICONS, ICON_LAYOUTS } from './icons.js';
import { validCrop } from './image-data.js';
import { validateAnimation, richMotion } from './animation.js';
import { COMPOSITIONS } from './design-compositions.js';
import { hasEcgWaveform, validateWaveform } from './extension-stubs.js';
import { validateAnatomyFocus } from './extension-stubs.js';
import { validateConduction } from './extension-stubs.js';
import { validateWpwMotion } from './extension-stubs.js';
import { validateWpwTypes } from './extension-stubs.js';
import { validateWpwOrigin } from './extension-stubs.js';
import { validateLgl } from './extension-stubs.js';
import { validateAvDelay } from './extension-stubs.js';
import { validateHdCircuit } from './hd-circuit-motion.js';
import { validateEcgVector } from './extension-stubs.js';
import { validateEcgLeads } from './extension-stubs.js';
import { validateSqliteDiagram } from './extension-stubs.js';
import { validateEcgMeasure } from './extension-stubs.js';
import { validateEcgAxis } from './extension-stubs.js';
import { validateEcgTransition } from './extension-stubs.js';
import { validateBundleBlock } from './extension-stubs.js';
import { validateFascicular } from './extension-stubs.js';
import { validateVentricularHypertrophy } from './extension-stubs.js';
import { validateLvhDetail } from './extension-stubs.js';
import { validateLvhCriteria } from './extension-stubs.js';
import { validateHcm } from './extension-stubs.js';
import { validateTrifascicular } from './extension-stubs.js';
import { validateRvh } from './extension-stubs.js';
import { validateBvh } from './extension-stubs.js';
import { validateAcs } from './extension-stubs.js';
import { validateDocument } from './document-layout.js';
import { validateHemodialysis } from './extension-stubs.js';

// Browser / Node 共通。秒数はすべてスライド内の音声再生位置です。
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const cueState = (cues, time) => new Set(cues.filter(cue => cue.at <= time).map(cue => cue.target));
export const formatTime = seconds => {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};
export const LAYOUTS = ['title', 'agenda', 'statement', 'flow', 'figure', 'steps', 'compare', 'table', 'chat', 'bars', 'code', 'timeline', 'cycle', 'stack', 'message', 'takehome', 'document'];
// 動きのある図解（src/motion.js）。ブロック数の範囲と、各ブロックに必要な項目。
// code：コードが打ち込まれ、command を実行して output を表示する（パネル1〜3枚を横に並べる）。
// timeline：年表。軸が伸び、出来事の点が順に現れる（label＝年、text＝出来事）。
// cycle：輪の図（イベントループなど）。光の点が輪を回る。slide.center は輪の中央の言葉。
// stack：層の図（構成図）。row（1＝いちばん下）が同じブロックは横に並ぶ。
export const DIAGRAM_BLOCKS = { code: [1, 3], timeline: [3, 7], cycle: [3, 6], stack: [2, 8] };
export const CODE_LINES = 12;
// 動き多め（AI Topic など）は1枚の情報量を増やせる（本文6つ・表6行・フロー図5つまで）。それ以外は従来どおり。
export const isDense = (lecture, slide) => richMotion(lecture, slide);
// 表（table）：見出し行 columns（2〜4列）と、行＝ブロック（label＝1列目、text＝2列目、cells＝3列目以降）。行は5つまで。
export const TABLE_COLUMNS = [2, 4];
export const TABLE_ROWS = 5;
// チャット（chat）：吹き出し2〜4つ。role は user（質問）/ ai（答え）。AIの答えは1文字ずつ表示する（src/motion.js）。
export const CHAT_BLOCKS = [2, 4];
// 棒グラフ（bars）：label（項目名）と value（数値）の行が2〜6つ。棒が伸び、数字がカウントアップする。資料にある数値だけを使う。
export const BAR_BLOCKS = [2, 6];
// 本文の下に置くまとめの一文（slide.note）。cue の target は "note"。
export const NOTE_LAYOUTS = ['statement', 'flow', 'figure', 'steps', 'compare', 'table', 'chat', 'bars', 'timeline', 'cycle', 'stack'];
// 動画のカテゴリ（シリーズ）。骨格・文字色は共通で、線と図形の色（primary：左端の帯・見出しの線 / accent：細線・矢印・印 /
// soft：サムネイルの円・カテゴリ表示 / marker：一文スライドの下線）だけを切り替える。fill は画像の淡い塗り。
export const CATEGORIES = {};
// 組み込みにないカテゴリ（designs/category-presets.json で利用者が追加したもの）とカテゴリなしの講義は、この配色で表示する。
export const DEFAULT_CATEGORY = { name: '', colors: { primary: '#1e2a47', accent: '#d27d2d', soft: '#c9d4ee', marker: '#dbe3f4' }, fill: '#B9C7E8' };
export const COLOR_KEYS = Object.keys(DEFAULT_CATEGORY.colors);
// カテゴリIDの形式。どのカテゴリがあるかは designs/category-presets.json が決める。
export const validCategoryId = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
export const categoryOf = lecture => Object.hasOwn(CATEGORIES, lecture?.category ?? '') ? CATEGORIES[lecture.category] : null;
// 挿入元の見た目はスライドごとに保存する。空のCSSも「標準の見た目を保持」の指定になる。
export const appearanceOf = (lecture, slide) => slide?.appearance ?? { css: lecture?.theme?.css ?? '', category: lecture?.category ?? null, ...(lecture?.motion ? { motion: lecture.motion } : {}) };
export function withInsertedAppearance(slide, source, keepSource) {
  const copy = structuredClone(slide);
  if (keepSource) copy.appearance = structuredClone(appearanceOf(source, slide));
  else delete copy.appearance;
  return copy;
}
// 画像を置けるレイアウト。画像はCodexが生成し lectures/<slug>/images/ に保存する。
export const IMAGE_LAYOUTS = ['title', 'statement', 'figure'];
export const imageFileOf = slide => slide.image ? (slide.image.file || `${slide.id}.png`) : null;
// フロー図の段階ごとの絵。キーは "<スライドID>:<ブロックID>"、ファイル名の既定は <スライドID>-<ブロックID>.png。
// 一文スライドの人物紹介（people）の似顔絵も同じ扱い。kind は step（段階の絵）/ person（似顔絵）。
export const blockImagesOf = slide => [...(slide.blocks ?? []).map(block => [block, 'step']), ...(slide.people ?? []).map(person => [person, 'person'])].filter(([item]) => item?.image).map(([block, kind]) => ({ key: `${slide.id}:${block.id}`, block, kind, image: block.image, file: block.image.file || `${slide.id}-${block.id}.png` }));
// 一文スライドの右側に並べる人物紹介の上限。
// スライドを別のIDで挿入・複製するときの写し。画像の既定ファイル名（<ID>.png・<ID>-<ブロックID>.png）を新しいIDに合わせる。
const renamed = (image, base) => {
  const extension = (image.file ?? '').match(/\.(png|jpg|webp)$/)?.[1] ?? 'png';
  const { file, ...rest } = image;
  return extension === 'png' ? rest : { ...rest, file: `${base}.${extension}` };
};
export function withSlideId(slide, id) {
  const copy = structuredClone(slide);
  copy.id = id;
  if (copy.image) copy.image = renamed(copy.image, id);
  for (const item of [...(copy.blocks ?? []), ...(copy.people ?? [])]) if (item?.image) item.image = renamed(item.image, `${id}-${item.id}`);
  return copy;
}
// 元のスライド（from）のファイルを、挿入したスライド（to）のどのファイルへ写すか。講義フォルダーからの相対パスの組。
export function slideFilePairs(from, to) {
  const pairs = [['audio', `${from.id}.wav`, `${to.id}.wav`], ['audio', `${from.id}.json`, `${to.id}.json`]];
  const [source, target] = [imageFileOf(from), imageFileOf(to)];
  const labels = file => file.replace(/\.(png|jpg|webp)$/, '.labels.json');
  if (source && target) pairs.push(['images', source, target], ['images', labels(source), labels(target)]);
  const blocks = new Map(blockImagesOf(from).map(item => [`${item.kind}:${item.block.id}`, item.file]));
  for (const item of blockImagesOf(to)) if (blocks.has(`${item.kind}:${item.block.id}`)) pairs.push(['images', blocks.get(`${item.kind}:${item.block.id}`), item.file]);
  return pairs.map(([folder, a, b]) => [`${folder}/${a}`, `${folder}/${b}`]);
}

export const PEOPLE_MAX = 5;
// **重要語** を濃いグレーの太字にする記法。HTMLは解釈せず、文字列の分割だけを行う。
export const emphasisParts = value => String(value ?? '').split('**').map((text, index) => ({ text, strong: index % 2 === 1 })).filter(part => part.text);
// 改行は日本語ならそのまま詰め、英数字どうしの間だけ空白にする。
// 講義ごとのCSS（lecture.theme.css）：「LLMにおまかせ」のデザインや、CSSで保存したデザインテンプレート。
// スライドの外（編集画面・再生画面の操作部分）を変えないよう、規則のセレクターはすべて #stage から始める。
// 外部の読み込み（@import・url() の http など）とスクリプトは使えない。url() は data: だけ。
export const THEME_CSS_MAX = 60000;
const splitSelectors = prelude => {
  const parts = []; let depth = 0, current = '';
  for (const char of prelude) {
    if (char === '(' || char === '[') depth++;
    if (char === ')' || char === ']') depth--;
    if (char === ',' && depth === 0) { parts.push(current); current = ''; } else current += char;
  }
  return [...parts, current].map(part => part.trim()).filter(Boolean);
};
export function validateThemeCss(css) {
  if (typeof css !== 'string') return ['theme.css は文字列です'];
  const errors = [];
  if (css.length > THEME_CSS_MAX) errors.push(`theme.css は${THEME_CSS_MAX}文字以内です`);
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  if (/@import|<\/?style|<script|javascript:|expression\s*\(|behavior\s*:/i.test(text)) errors.push('theme.css に @import・<style>・スクリプトは使えません');
  if (/url\(\s*['"]?\s*(?!data:)/i.test(text)) errors.push('theme.css の url() は data: だけ使えます（外部やファイルは読み込めません）');
  // 波かっこの階層をたどり、規則（rule）のセレクターと @規則 を確かめる。@media などの中の規則も同じ。
  const stack = []; let prelude = '';
  for (const char of text) {
    if (char === '{') {
      const head = prelude.trim(), parent = stack.at(-1); prelude = '';
      let kind = 'inner';
      if (parent === undefined || parent === 'group') {
        if (/^@(media|supports|container)\b/i.test(head)) kind = 'group';
        else if (/^@(-webkit-)?keyframes\s/i.test(head)) kind = 'keyframes';
        else if (/^@font-face$/i.test(head)) kind = 'font-face';
        else if (head.startsWith('@')) errors.push(`theme.css の ${head.split(/[\s{]/)[0]} は使えません（@media・@supports・@container・@keyframes・@font-face だけ）`);
        else { kind = 'rule'; for (const selector of splitSelectors(head)) if (!/^#stage(?![\w-])/.test(selector)) errors.push(`theme.css のセレクター「${selector.slice(0, 40)}」は #stage から始めてください`); }
      }
      stack.push(kind);
    } else if (char === '}') {
      if (!stack.length) { errors.push('theme.css の { } の対応が取れていません'); break; }
      stack.pop(); prelude = '';
    } else if (char === ';') prelude = '';
    else prelude += char;
  }
  if (stack.length) errors.push('theme.css の { } の対応が取れていません');
  return [...new Set(errors)].slice(0, 10);
}
// スライドと同じ文書（サムネイルはShadow DOM）に <style> で入れる。検査に通らないCSSは入れない。
const themeChecks = new Map();
export function applyThemeCss(stage, css) {
  const root = stage.getRootNode(), host = root.head ?? root;
  let style = [...host.children].find(element => element.matches('style[data-lecture-theme]'));
  if (css && !themeChecks.has(css)) { if (themeChecks.size > 20) themeChecks.clear(); themeChecks.set(css, !validateThemeCss(css).length); }
  if (!css || !themeChecks.get(css)) { style?.remove(); delete stage.dataset.lectureTheme; return; }
  if (!style) { style = root.ownerDocument?.createElement('style') ?? document.createElement('style'); style.dataset.lectureTheme = ''; host.append(style); }
  if (style.textContent !== css) style.textContent = css;
  stage.dataset.lectureTheme = 'true';
}
export const plainText = value => String(value ?? '').replaceAll('**', '').replace(/([A-Za-z0-9])\s*\n\s*(?=[A-Za-z0-9])/g, '$1 ').replace(/\s*\n\s*/g, '');

// SAKUSURA標準構成（合計12枚）：1枚目サムネイル（#演題番号）/ 2枚目アジェンダ /
// 3〜11枚目 本編（うち一文だけのスライド message を必ず2枚、図解はフロー図 flow を1枚以上）/ 12枚目 Take Home Message 4つ。
// 動作確認用のデモ（"demo": true）だけ対象外。
export const DECK_SLIDES = 12;
export const MESSAGE_SLIDES = 2;
export function validateDeckStructure(lecture) {
  // デモと、構成ルールを使わない講義（rules: "free"）は対象外。
  if (lecture.demo === true || lecture.rules === 'free') return [];
  const errors = [];
  const slides = lecture.slides;
  // 枚数・並び（12枚・一文2枚・1枚目サムネイル・最終枚Take Home Messageなど）は生成時のルール。
  // 編集画面でスライドを挿入・削除・並べ替えした講義（slidesEdited）は、番号・カテゴリ・強調記法だけを確かめる。
  if (lecture.slidesEdited !== true) errors.push(...deckOrderErrors(slides));
  else if (!slides.length) errors.push('構成: スライドが1枚以上必要です');
  if (!/^\d{1,4}$/.test(String(lecture.number ?? ''))) errors.push('構成: number（演題番号・数字）が必要です。サムネイルに #番号 で表示します');
  if (lecture.category === undefined && Object.keys(CATEGORIES).length) errors.push(`構成: category（${Object.entries(CATEGORIES).map(([key, item]) => `${key}=${item.name}`).join(' / ')}）が必要です。シリーズの配色とサムネイルのカテゴリ表示に使います`);
  for (const slide of slides) {
    if (slide.layout === 'message' && slide.blocks.length) errors.push(`${slide.id}: 一文スライドは見出しの一文だけにし、blocks は空にしてください`);
    for (const value of [slide.title, slide.note, ...(slide.columns ?? []), ...slide.blocks.flatMap(block => [block.label, block.text, block.detail, ...(block.cells ?? [])])]) {
      if (typeof value === 'string' && value.split('**').length % 2 === 0) errors.push(`${slide.id}: 強調記法 ** の対応が取れていません`);
    }
  }
  return errors;
}
function deckOrderErrors(slides) {
  const errors = [];
  if (slides.length < 4) return [`構成: 合計${DECK_SLIDES}枚（サムネイル・アジェンダ・本編・Take Home Message）が必要です`];
  if (slides.length !== DECK_SLIDES) errors.push(`構成: 合計${DECK_SLIDES}枚にしてください（現在 ${slides.length}枚）`);
  const messages = slides.filter(slide => slide.layout === 'message');
  if (messages.length !== MESSAGE_SLIDES) errors.push(`構成: 一文だけのスライド（message）は${MESSAGE_SLIDES}枚です（現在 ${messages.length}枚）`);
  // 輪の図（cycle）は、最後の箱が最初の箱へ戻るフロー図として数える。
  if (!slides.some(slide => ['flow', 'cycle'].includes(slide.layout))) errors.push('構成: 図解はフロー図（layout "flow"、繰り返す流れは "cycle"）で、本編に1枚以上入れてください');
  slides.slice(2, -2).forEach((slide, index) => {
    if (slide.layout === 'message' && slides[index + 3].layout === 'message') errors.push(`構成: 一文スライドが連続しています（${index + 3}・${index + 4}枚目）。要所に分けて置きます`);
  });
  if (slides[0].layout !== 'title') errors.push('構成: 1枚目は layout "title"（サムネイル）にしてください');
  if (slides[1].layout !== 'agenda') errors.push('構成: 2枚目は layout "agenda"（アジェンダ）にしてください');
  const last = slides.at(-1);
  if (last.layout !== 'takehome') errors.push('構成: 最終枚は layout "takehome"（Take Home Message）にしてください');
  else if (last.blocks.length !== 4) errors.push(`構成: Take Home Message は4つです（現在 ${last.blocks.length}つ）`);
  slides.slice(2, -1).forEach((slide, index) => {
    if (['title', 'agenda', 'takehome'].includes(slide.layout)) errors.push(`構成: ${index + 3}枚目に ${slide.layout} は使えません（本編は statement / flow / figure / steps / compare / table / chat / bars / code / timeline / cycle / stack / message）`);
  });
  return errors;
}

export function validateLecture(lecture) {
  const errors = [];
  const text = value => typeof value === 'string' && value.trim().length > 0;
  if (!lecture || typeof lecture !== 'object') return ['講義データがありません'];
  if (lecture.version !== 1) errors.push('version は 1 を指定してください');
  if (!text(lecture.title)) errors.push('title が必要です');
  if (!Number.isFinite(lecture.targetSeconds) || lecture.targetSeconds <= 0) errors.push('targetSeconds は正の秒数です');
  if (lecture.category !== undefined && !validCategoryId(lecture.category)) errors.push(`category はカテゴリID（${[...Object.keys(CATEGORIES), 'designs/category-presets.json で追加したID'].join(' / ')}）です`);
  if (lecture.motion !== undefined && lecture.motion !== 'rich') errors.push('motion は "rich"（動き多め）だけです。標準の動きでは書きません');
  // 作成時にユーザーが選んだデザイン（標準 sakusura-standard または「デザイン」画面で保存した design-<UUID>）。
  if (lecture.design !== undefined && !/^(sakusura-standard|llm|design-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(lecture.design)) errors.push('design は sakusura-standard・llm（LLMにおまかせ）・design-<UUID> のどれかです（npm run designs で一覧）');
  if (lecture.rules !== undefined && !['sakusura', 'free'].includes(lecture.rules)) errors.push('rules は sakusura（SAKUSURAの構成ルールを守る）か free（構成も自由）です');
  if (lecture.slidesEdited !== undefined && lecture.slidesEdited !== true) errors.push('slidesEdited は true だけです（編集画面でスライドを挿入・削除・並べ替えした印。枚数・並びの検査を外す）');
  if (lecture.theme !== undefined) {
    if (!lecture.theme || typeof lecture.theme !== 'object' || Object.keys(lecture.theme).some(key => key !== 'css')) errors.push('theme は { "css": "..." } です（npm run theme で theme.css から取り込み）');
    else errors.push(...validateThemeCss(lecture.theme.css));
  }
  if (lecture.source !== undefined &&!/^input\/[^\\/]+\.(pdf|docx|pptx|html)$/i.test(lecture.source)) errors.push('source は input/ に置いたPDF・Word・PowerPoint・HTMLのパスです');
  if (!Array.isArray(lecture.slides) || !lecture.slides.length) return [...errors, 'slides が必要です'];
  const ids = new Set();
  for (const [index, slide] of lecture.slides.entries()) {
    const label = `slide ${index + 1}`;
    if (!slide || typeof slide !== 'object') { errors.push(`${label}: スライドはオブジェクトです`); continue; }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(slide.id ?? '')) errors.push(`${label}: id は英数字・_・-で指定`);
    if (ids.has(slide.id)) errors.push(`${label}: id が重複`);
    ids.add(slide.id);
    if (slide.appearance !== undefined) {
      const appearance = slide.appearance;
      if (!appearance || typeof appearance !== 'object' || Array.isArray(appearance) || Object.keys(appearance).some(key => !['css', 'category', 'motion'].includes(key))) errors.push(`${label}: appearance は { css, category, motion } です`);
      else {
        errors.push(...validateThemeCss(appearance.css).map(error => `${label}: appearance.${error}`));
        if (appearance.category !== null && !validCategoryId(appearance.category)) errors.push(`${label}: appearance.category はカテゴリIDまたは null です`);
        if (appearance.motion !== undefined && appearance.motion !== 'rich') errors.push(`${label}: appearance.motion は "rich" だけです`);
      }
    }
    errors.push(...validatePlacement(slide).map(error => `${label}: ${error}`));
    errors.push(...validateShapes(slide).map(error => `${label}: ${error}`));
    errors.push(...validateDocument(slide).map(error => `${label}: ${error}`));
    if (!text(slide.title)) errors.push(`${label}: title が必要`);
    if (typeof slide.narration !== 'string') errors.push(`${label}: narration は文字列`);
    for (const key of ['ttsText', 'style', 'eyebrow', 'imageSeries']) if (slide[key] !== undefined && typeof slide[key] !== 'string') errors.push(`${label}: ${key} は文字列`);
    if (slide.ttsVoice !== undefined && !/^voice_[a-zA-Z0-9_-]+$/.test(slide.ttsVoice)) errors.push(`${label}: ttsVoice は永続カスタムボイスID（voice_…。一覧は npm run voices）`);
    if (slide.ttsModel !== undefined && !/^gemini-[a-z0-9.-]+-tts$/.test(slide.ttsModel)) errors.push(`${label}: ttsModel は gemini-…-tts のモデル名（例: gemini-3.8-flash-tts）`);
    if (slide.transition !== undefined && (typeof slide.transition !== 'boolean' || slide.layout !== 'compare')) errors.push(`${label}: transition は compare で使う true / false`);
    if (slide.image !== undefined) {
      const image = slide.image;
      if (!image || typeof image !== 'object' || !text(image.alt) || !text(image.prompt)) errors.push(`${label}: image は alt（画像の説明）と prompt（生成指示）が必要`);
      else if (image.file !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.(png|jpg|webp)$/.test(image.file)) errors.push(`${label}: image.file は英数字の .png / .jpg / .webp`);
      if (!IMAGE_LAYOUTS.includes(slide.layout)) errors.push(`${label}: image を置けるのは ${IMAGE_LAYOUTS.join(' / ')} だけです`);
      // 解剖図などのラベル。文字は画像に描かせず、Codexが返す座標にHTMLで重ねる。
      if (image?.labels !== undefined && (!Array.isArray(image.labels) || image.labels.length > 9 || !image.labels.every(text) || new Set(image.labels).size !== image.labels.length)) errors.push(`${label}: image.labels は重複のない文字列の配列（9個まで）`);
      for (const key of ['checklist']) if (image?.[key] !== undefined && (!Array.isArray(image[key]) || !image[key].every(text))) errors.push(`${label}: image.${key} は文字列の配列`);
      // 生成済み画像の修正依頼。Codexの修正を確認したら外す。
      if (image?.revision !== undefined && !text(image.revision)) errors.push(`${label}: image.revision は修正内容の文字列`);
      if (image?.crop !== undefined && !validCrop(image.crop)) errors.push(`${label}: image.crop は画像内の x・y・width・height（0〜1）です`);
      const labelTexts = Array.isArray(image?.labels) ? image.labels : [];
      if (image?.labelPositions !== undefined && (!Array.isArray(image.labelPositions) || image.labelPositions.length !== labelTexts.length
        || new Set(image.labelPositions.map(p => p?.text)).size !== image.labelPositions.length
        || !image.labelPositions.every(p => labelTexts.includes(p?.text) && [p.x, p.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1) && ['left', 'right', 'top', 'bottom'].includes(p.side)))) errors.push(`${label}: image.labelPositions は各ラベルの text・x・y（0〜1）・side です`);
    }
    if (slide.layout === 'figure' && !slide.image && !hasEcgWaveform(slide)) errors.push(`${label}: figure には image（解剖図など）が必要です`);
    if (!Number.isFinite(slide.plannedSeconds) || slide.plannedSeconds <= 0) errors.push(`${label}: plannedSeconds は正の秒数`);
    if (!Number.isFinite(slide.gapAfter) || slide.gapAfter < 0) errors.push(`${label}: gapAfter は0以上の秒数`);
    if (!LAYOUTS.includes(slide.layout)) errors.push(`${label}: layout は ${LAYOUTS.join(' / ')}`);
    // 一文スライド（message）だけは見出しのみで、blocks を空にできる。
    if (!Array.isArray(slide.blocks) || (!slide.blocks.length && slide.layout !== 'message')) { errors.push(`${label}: blocks が必要`); continue; }
    const targets = new Set();
    errors.push(...validateAnimation(slide).map(error => `${label}: ${error}`));
    if (slide.composition !== undefined && (COMPOSITIONS[slide.composition]?.layout !== slide.layout || slide.blocks.length !== (COMPOSITIONS[slide.composition]?.count ?? {profile:4,system:7,lanes:4,journey:4,recovery:8}[slide.composition]))) errors.push(`${label}: composition の配置・レイアウト・ブロック数を確認してください`);
    errors.push(...validateWaveform(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateAnatomyFocus(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateConduction(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateWpwMotion(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateWpwTypes(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateWpwOrigin(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateLgl(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateAvDelay(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateHdCircuit(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateEcgVector(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateEcgMeasure(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateEcgAxis(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateEcgTransition(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateBundleBlock(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateFascicular(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateVentricularHypertrophy(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateLvhDetail(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateLvhCriteria(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateHcm(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateTrifascicular(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateRvh(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateBvh(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateAcs(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateHemodialysis(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateEcgLeads(slide).map(error=>`${label}: ${error}`));
    errors.push(...validateSqliteDiagram(slide).map(error=>`${label}: ${error}`));
    if (slide.layout === 'table') {
      const columns = slide.columns;
      if (!Array.isArray(columns) || columns.length < TABLE_COLUMNS[0] || columns.length > TABLE_COLUMNS[1] || !columns.every(text)) errors.push(`${label}: table の columns は ${TABLE_COLUMNS[0]}〜${TABLE_COLUMNS[1]}列の見出し文字列です`);
      else for (const block of slide.blocks) if (!text(block?.label) || (block.cells ?? []).length !== columns.length - 2 || !(block.cells ?? []).every(text)) errors.push(`${label}: table の各行は label（1列目）・text（2列目）と、cells に残り${columns.length - 2}列が必要`);
      const rows = TABLE_ROWS + (isDense(lecture, slide) ? 1 : 0);
      if (slide.blocks.length > rows) errors.push(`${label}: table の行は${rows}つまで`);
    } else if (slide.columns !== undefined || slide.blocks.some(block => block?.cells !== undefined)) errors.push(`${label}: columns・cells は表（table）だけに使えます`);
    if (slide.layout === 'chat' && (slide.blocks.length < CHAT_BLOCKS[0] || slide.blocks.length > CHAT_BLOCKS[1])) errors.push(`${label}: チャット（chat）の吹き出しは${CHAT_BLOCKS[0]}〜${CHAT_BLOCKS[1]}つ`);
    if (slide.layout === 'bars' && (slide.blocks.length < BAR_BLOCKS[0] || slide.blocks.length > BAR_BLOCKS[1])) errors.push(`${label}: 棒グラフ（bars）の行は${BAR_BLOCKS[0]}〜${BAR_BLOCKS[1]}つ`);
    const range = DIAGRAM_BLOCKS[slide.layout];
    if (range && (slide.blocks.length < range[0] || slide.blocks.length > range[1])) errors.push(`${label}: ${slide.layout} のブロックは${range[0]}〜${range[1]}つ`);
    if (slide.center !== undefined && (slide.layout !== 'cycle' || !text(slide.center) || slide.center.length > 16)) errors.push(`${label}: center は輪の図（cycle）の中央に置く16文字までの言葉`);
    if (slide.max !== undefined && (slide.layout !== 'bars' || !Number.isFinite(slide.max) || slide.max <= 0 || slide.blocks.some(block => block?.value > slide.max))) errors.push(`${label}: max は棒グラフ（bars）の目盛りの上限で、どの value 以上の数値`);
    if (slide.note !== undefined) {
      if (!text(slide.note) || slide.note.includes('\n')) errors.push(`${label}: note は改行のない一文です`);
      if (!NOTE_LAYOUTS.includes(slide.layout)) errors.push(`${label}: note を置けるのは ${NOTE_LAYOUTS.join(' / ')} だけです`);
      targets.add('note');
    }
    for (const block of slide.blocks) {
      if (!block || typeof block !== 'object') { errors.push(`${label}: block はオブジェクトです`); continue; }
      if (!text(block.id) || targets.has(block.id)) errors.push(`${label}: block.id が空欄または重複`);
      targets.add(block.id);
      if (slide.layout === 'bars') {
        if (!text(block.label) || !Number.isFinite(block.value) || block.value < 0) errors.push(`${label}: 棒グラフ（bars）の各行は label（項目名）と value（0以上の数値）が必要`);
        if (block.unit !== undefined && (typeof block.unit !== 'string' || block.unit.length > 6)) errors.push(`${label}: unit は6文字までの単位（例: %・秒・円）`);
        if (block.text !== undefined && !text(block.text)) errors.push(`${label}: 棒グラフの text（補足）は空にしません`);
      } else if (!text(block.text)) errors.push(`${label}: block.text が必要`);
      if (block.role !== undefined && (slide.layout !== 'chat' || !['user', 'ai'].includes(block.role))) errors.push(`${label}: role はチャット（chat）だけに使う user / ai です`);
      if (slide.layout === 'chat' && !['user', 'ai'].includes(block.role)) errors.push(`${label}: チャット（chat）の吹き出しは role（user＝質問 / ai＝答え）が必要`);
      for (const key of ['value', 'unit', 'highlight']) if (block[key] !== undefined && slide.layout !== 'bars') errors.push(`${label}: ${key} は棒グラフ（bars）だけに使えます`);
      if (block.highlight !== undefined && typeof block.highlight !== 'boolean') errors.push(`${label}: highlight は true / false`);
      if (slide.layout === 'code') {
        if (!text(block.label) || !text(block.code)) errors.push(`${label}: code の各パネルは label（ファイル名など）と code が必要`);
        else if (block.code.split('\n').length > CODE_LINES) errors.push(`${label}: code は${CODE_LINES}行まで`);
      }
      for (const key of ['code', 'command', 'output']) {
        if (block[key] !== undefined && slide.layout !== 'code') errors.push(`${label}: ${key} はコード（code）だけに使えます`);
        else if (block[key] !== undefined && !text(block[key])) errors.push(`${label}: ${key} は空にしません`);
      }
      if (slide.layout === 'timeline' && !text(block.label)) errors.push(`${label}: timeline の各出来事は label（年・日付）が必要`);
      if (slide.layout === 'stack' && (!Number.isInteger(block.row) || block.row < 1 || block.row > 5)) errors.push(`${label}: stack の各ブロックは row（1〜5、1がいちばん下）が必要`);
      if (block.row !== undefined && slide.layout !== 'stack') errors.push(`${label}: row は層の図（stack）だけに使えます`);
      // フロー図の各段階・比較の各列に添える小さな絵（手技の手順など）。Codexが生成する。
      if (block.image !== undefined) {
        if (!['flow', 'compare', 'table', 'document'].includes(slide.layout)) errors.push(`${label}: block.image はフロー図・比較・表・自由レイアウトで使えます`);
        if (!block.image || typeof block.image !== 'object' || !text(block.image.alt) || !text(block.image.prompt)) errors.push(`${label}: block.image は alt と prompt が必要`);
        else if (block.image.file !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.(png|jpg|webp)$/.test(block.image.file)) errors.push(`${label}: block.image.file は英数字の .png / .jpg / .webp`);
        if(block.image?.crop!==undefined&&!validCrop(block.image.crop))errors.push(`${label}: block.image.crop は画像内の x・y・width・height（0〜1）です`);
      }
      // 図解のブロックに添える線画アイコン（src/icons.js）。絵（block.image）がある段階では絵を優先する。
      if (block.icon !== undefined) {
        if (!ICON_LAYOUTS.includes(slide.layout)) errors.push(`${label}: icon を置けるのは ${ICON_LAYOUTS.join(' / ')} だけです`);
        if (typeof block.icon !== 'string' || !Object.hasOwn(ICONS, block.icon)) errors.push(`${label}: icon「${block.icon}」は src/icons.js にありません`);
      }
    }
    // 一文スライドの右側の人物紹介（似顔絵＋名前＋紹介）。cueは付けず、最初から表示する。
    const people = new Set();
    if (slide.people !== undefined) {
      if (slide.layout !== 'message') errors.push(`${label}: people は一文スライド（message）だけに使えます`);
      if (!Array.isArray(slide.people) || !slide.people.length || slide.people.length > PEOPLE_MAX) errors.push(`${label}: people は1〜${PEOPLE_MAX}人の配列です`);
      else for (const person of slide.people) {
        if (!person || typeof person !== 'object' || !text(person.name) || !text(person.text)) { errors.push(`${label}: people の各人に name と text が必要`); continue; }
        if (!text(person.id) || targets.has(person.id) || people.has(person.id)) errors.push(`${label}: people の id が空欄または重複`);
        people.add(person.id);
        if (person.image !== undefined && (!person.image || typeof person.image !== 'object' || !text(person.image.alt) || !text(person.image.prompt))) errors.push(`${label}: people の image は alt と prompt が必要`);
        else if (person.image?.file !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*.(png|jpg|webp)$/.test(person.image.file)) errors.push(`${label}: people の image.file は英数字の .png / .jpg / .webp`);
      }
    }
    // 編集画面で足した図形・文字の cue は任意（なければ最初から表示）。
    const optional = new Set(Array.isArray(slide.shapes) ? slide.shapes.map(shape => shape?.id).filter(id => typeof id === 'string') : []);
    for (const id of optional) if (targets.has(id) || people.has(id)) errors.push(`${label}: shapes の id ${id} が本文・人物の id と重複しています`);
    const cued = new Set();
    let last = -1;
    if (!Array.isArray(slide.cues)) { errors.push(`${label}: cues が必要`); continue; }
    for (const cue of slide.cues) {
      if (!cue || typeof cue !== 'object') { errors.push(`${label}: cue はオブジェクトです`); continue; }
      if (!Number.isFinite(cue.at) || cue.at < 0 || cue.at < last) errors.push(`${label}: cue.at は0以上・昇順`);
      if ((!targets.has(cue.target) && !optional.has(cue.target)) || cued.has(cue.target)) errors.push(`${label}: cue.target が不明または重複`);
      cued.add(cue.target);
      last = cue.at;
    }
    for (const target of targets) if (!cued.has(target)) errors.push(`${label}: ${target} のcueがありません`);
  }
  return errors;
}

export class LecturePlayer {
  constructor({ lecture, audio, media, preview = false, settle = (slide, at) => at, onChange = () => {}, onError = () => {} }) {
    this.lecture = lecture;
    this.audio = audio;
    this.media = media;
    this.preview = preview;
    this.onChange = onChange;
    this.onError = onError;
    // 発表用の手動送りで、cue の時刻から動き（src/motion.js）が終わる時刻まで音声なしで進める。
    this.settle = settle;
    this.settleTo = 0;
    this.index = 0;
    this.time = 0;
    this.state = 'ready';
    this.operation = 0;
    this.gapRemaining = 0;
    this.lastTick = null;
    this.endedHandler = () => { if (this.state === 'playing' && !this.preview) this.finishSlide(); };
    this.errorHandler = () => {
      if (!this.preview && ['playing', 'loading'].includes(this.state)) this.fail(new Error('音声を読み込めません。音声ファイルとHarnessの結果を確認してください。'));
    };
    media.addEventListener('ended', this.endedHandler);
    media.addEventListener('error', this.errorHandler);
    this.load(0);
  }
  get slide() { return this.lecture.slides[this.index]; }
  get duration() { return this.preview ? this.slide.plannedSeconds : (this.audio[this.slide.id]?.duration ?? this.slide.plannedSeconds); }
  get active() { return this.state === 'playing' || this.state === 'gap' || this.state === 'loading'; }
  get total() { return this.lecture.slides.reduce((sum, s, i) => sum + (this.preview ? s.plannedSeconds : (this.audio[s.id]?.duration ?? s.plannedSeconds)) + (i < this.lecture.slides.length - 1 ? s.gapAfter : 0), 0); }
  get elapsed() {
    return this.lecture.slides.slice(0, this.index).reduce((sum, s) => sum + (this.preview ? s.plannedSeconds : (this.audio[s.id]?.duration ?? s.plannedSeconds)) + s.gapAfter, 0) + this.time + (this.state === 'gap' || this.pausedGap ? this.slide.gapAfter - this.gapRemaining : 0);
  }
  notify() { this.onChange(this); }
  fail(error) {
    this.operation++;
    this.media.pause();
    this.state = 'error';
    this.notify();
    this.onError(error);
  }
  load(index) {
    this.operation++;
    this.media.pause();
    this.index = clamp(index, 0, this.lecture.slides.length - 1);
    this.time = 0;
    this.settleTo = 0;
    this.gapRemaining = 0;
    this.pausedGap = false;
    this.lastTick = null;
    this.state = 'ready';
    const item = this.audio[this.slide.id];
    if (!this.preview && item?.ready) {
      this.media.src = item.url;
      this.media.load();
    } else {
      this.media.removeAttribute('src');
      this.media.load();
    }
    this.notify();
  }
  async play() {
    if (this.active) return;
    this.settleTo = 0;
    if (this.state === 'ended') this.load(0);
    if (this.pausedGap) {
      this.pausedGap = false;
      this.lastTick = null;
      this.state = 'gap';
      this.notify();
      return;
    }
    if (!this.preview && !this.audio[this.slide.id]?.ready) {
      this.fail(new Error('音声が未生成・変更済みです。TTSを生成するか、無音リハーサルを選んでください。'));
      return;
    }
    const operation = ++this.operation;
    this.state = 'loading';
    this.notify();
    try {
      if (!this.preview) await this.media.play();
      if (operation !== this.operation) return;
      this.state = 'playing';
      this.lastTick = null;
      this.notify();
    } catch (error) { if (operation === this.operation) this.fail(new Error(`再生できません。再生ボタンから再試行してください（${error.name ?? 'AudioError'}）。`)); }
  }
  pause() {
    if (this.state === 'ended') return;
    this.operation++;
    this.media.pause();
    this.pausedGap = this.state === 'gap' || this.pausedGap;
    this.state = 'paused';
    this.lastTick = null;
    this.notify();
  }
  async jump(index) {
    const resume = this.active;
    this.load(index);
    if (resume) await this.play();
  }
  seek(value) {
    if (this.state === 'loading') this.pause();
    this.time = clamp(Number(value) || 0, 0, this.duration);
    this.settleTo = 0;
    this.pausedGap = false;
    this.gapRemaining = 0;
    this.lastTick = null;
    if (this.state === 'gap' || this.state === 'ended') this.state = 'paused';
    if (!this.preview && this.audio[this.slide.id]?.ready) {
      try { this.media.currentTime = this.time; } catch { this.fail(new Error('音声の読み込み完了後にシークしてください。')); return; }
    }
    this.notify();
  }
  // 発表用の手動送り（全画面プレゼン）。音声は流さず、押すたびに次の要点を1つ表示し、全部出ていれば次のスライドへ。
  // 要点の表示は cues の時刻で決まるので、その時刻まで表示位置を進めて止める。戻るときは1つ前の状態、なければ前のスライドの全表示へ。
  showAt(time) {
    this.operation++;
    this.media.pause();
    this.time = time;
    this.settleTo = Math.min(this.duration, this.settle(this.slide, time, this.duration));
    this.pausedGap = false;
    this.gapRemaining = 0;
    this.lastTick = null;
    this.state = 'paused';
    if (!this.preview && this.audio[this.slide.id]?.ready) { try { this.media.currentTime = Math.min(time, this.duration); } catch { /* 読み込み前は再生開始時に合わせる */ } }
    this.notify();
  }
  // 発表用：指定のスライドを、次へ送ったときと同じ最初の状態で開く（スライド一覧から選んだとき）。
  presentSlide(index) {
    this.load(index);
    this.showAt(0);
  }
  step(direction) {
    const times = slide => [...new Set(slide.cues.map(cue => cue.at))].sort((a, b) => a - b);
    const show = time => this.showAt(time);
    const current = times(this.slide);
    if (direction > 0) {
      const next = current.find(at => at > this.time);
      if (next !== undefined) show(next);
      else if (this.index < this.lecture.slides.length - 1) { this.load(this.index + 1); show(0); }
    } else {
      const shown = current.filter(at => at <= this.time);
      if (shown.length > 1) show(shown.at(-2));
      else if (shown.length === 1 && shown[0] > 0) show(0);
      else if (this.index > 0) { this.load(this.index - 1); show(times(this.slide).at(-1) ?? 0); }
    }
  }
  finishSlide() {
    this.time = this.duration;
    if (this.index === this.lecture.slides.length - 1) {
      this.media.pause();
      this.state = 'ended';
      this.notify();
    } else if (this.slide.gapAfter > 0) {
      this.state = 'gap';
      this.gapRemaining = this.slide.gapAfter;
      this.lastTick = null;
      this.notify();
    } else { void this.jump(this.index + 1); }
  }
  tick(now) {
    const delta = this.lastTick === null ? 0 : Math.max(0, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (this.state === 'gap') {
      this.gapRemaining = Math.max(0, this.gapRemaining - delta);
      if (!this.gapRemaining) void this.jump(this.index + 1);
      else this.notify();
    } else if (this.state === 'paused' && this.settleTo > this.time) {
      this.time = Math.min(this.settleTo, this.time + delta);
      this.notify();
    } else if (this.state === 'playing') {
      this.time = this.preview ? Math.min(this.duration, this.time + delta) : clamp(this.media.currentTime, 0, this.duration);
      if (this.preview && this.time >= this.duration) this.finishSlide();
      else this.notify();
    }
  }
  dispose() {
    this.pause();
    this.media.removeEventListener('ended', this.endedHandler);
    this.media.removeEventListener('error', this.errorHandler);
  }
}
