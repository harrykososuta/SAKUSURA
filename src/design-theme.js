import { CATEGORIES, DEFAULT_CATEGORY, LAYOUTS, validCategoryId, validateThemeCss, applyThemeCss } from './core.js';
import { validateDesignTexts } from './design-text.js';
import { COMPOSITIONS } from './design-compositions.js';

export const STANDARD_DESIGN_ID = 'sakusura-standard';
// 組み込みのカテゴリがない版（配布版）の標準デザインは、配色を「標準」1つだけ持つ。
export const BASE_PALETTE = 'standard';
const builtinName = id => Object.hasOwn(CATEGORIES, id) ? CATEGORIES[id].name : (id === BASE_PALETTE ? '標準' : undefined);
export { validCategoryId };
export const DESIGN_FONTS = {
  noto: { name: 'Noto Sans JP', css: "'Noto Sans JP', 'BIZ UDPGothic', 'Yu Gothic UI', 'Yu Gothic', 'Meiryo', sans-serif" },
  biz: { name: 'BIZ UDPゴシック', css: "'BIZ UDPGothic', 'Yu Gothic', 'Meiryo', sans-serif" },
  yu: { name: '游ゴシック', css: "'Yu Gothic', 'BIZ UDPGothic', 'Meiryo', sans-serif" },
  meiryo: { name: 'メイリオ', css: "'Meiryo', 'BIZ UDPGothic', sans-serif" },
};
export const DESIGN_NUMBER_FIELDS = [
  ['typography.heading', '見出し', 16, 120], ['typography.body', '本文', 12, 72],
  ['typography.title', '表紙の題名', 24, 160], ['typography.number', '演題番号', 24, 240], ['typography.message', '一文', 24, 160],
  ['spacing.left', '左の余白', 40, 400], ['spacing.right', '右の余白', 40, 400], ['spacing.top', '上の余白', 60, 300], ['spacing.bottom', '下の余白', 60, 300],
  ['layouts.flow.gap', '箱の間隔', 64, 120, 'flow'], ['layouts.flow.minHeight', '箱の最小高さ', 180, 300, 'flow'],
  ['layouts.statement.rowPadding', '行の上下余白', 16, 48, 'statement'],
  ['layouts.compare.gap', '左右の間隔', 64, 160, 'compare'],
  ['layouts.table.rowPadding', '行の上下余白', 16, 40, 'table'],
  ['layouts.figure.width', '図の幅', 640, 1000, 'figure'], ['layouts.figure.height', '図の高さ', 400, 600, 'figure'],
  ['layouts.takehome.columnGap', '列の間隔', 48, 140, 'takehome'], ['layouts.takehome.rowGap', '段の間隔', 32, 100, 'takehome'],
];
export const getDesignValue = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
export function setDesignValue(object, path, value) {
  const keys = path.split('.'), last = keys.pop();
  keys.reduce((item, key) => item[key], object)[last] = value;
}
export function standardDesign() {
  return { version: 1, name: 'SAKUSURA Standard', description: '生成りの背景、グレーの文字、罫線と余白。共通のルールを土台に、各項目の見せ方を決めています。', brand: 'SAKUSURA', settings: {
    font: 'noto', colors: { paper: '#f6f3ee', rule: '#d9d3c9', textStrong: '#333333', text: '#767676', textMeta: '#8a8a8a' },
    categories: Object.keys(CATEGORIES).length ? Object.fromEntries(Object.entries(CATEGORIES).map(([id, item]) => [id, { ...item.colors }])) : { [BASE_PALETTE]: { ...DEFAULT_CATEGORY.colors } },
    typography: { heading: 40, body: 28, title: 72, number: 150, message: 76 },
    spacing: { left: 184, right: 140, top: 140, bottom: 150 },
    layouts: { flow: { gap: 88, minHeight: 220 }, statement: { rowPadding: 36 }, compare: { gap: 120 }, table: { rowPadding: 26 }, figure: { width: 900, height: 600 }, takehome: { columnGap: 96, rowGap: 64 } },
  } };
}
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
export const designCategories = design => Object.fromEntries(Object.entries(design.settings.categories).map(([id, colors]) => [id, { name: design.categoryNames?.[id] ?? builtinName(id) ?? id, colors }]));
export function designCategoryKey(design, value) {
  return Object.hasOwn(design.settings.categories, value ?? '') ? value : Object.hasOwn(design.settings.categories, 'va') ? 'va' : Object.keys(design.settings.categories)[0];
}
export function designDeck(design) {
  if (design.pdfSource) return { targetSeconds: design.deck?.targetSeconds ?? 600, takehomeCount: design.deck?.takehomeCount ?? 4, slides: design.pdfSource.pages.map(page => ({ layout: page.layout, purpose: page.label, pdfPage: page.page })) };
  return structuredClone(design.deck ?? { targetSeconds: 600, takehomeCount: 4, slides: Array.from({ length: 12 }, (_, i) => ({ layout: i === 0 ? 'title' : i === 1 ? 'agenda' : i === 11 ? 'takehome' : [4, 8].includes(i) ? 'message' : i === 5 ? 'flow' : 'statement', purpose: '' })) });
}
export function validateDesign(design) {
  const errors = [];
  function shape(value, reference, path) {
    if (!plain(value)) { errors.push(`${path || 'デザイン'}の形式を確認してください。`); return; }
    for (const key of Object.keys(value)) if (!Object.hasOwn(reference, key) && !(path === '' && ['categoryNames', 'deck', 'aiInstructions', 'pdfSource', 'layoutTexts', 'css'].includes(key))) errors.push(`${path}${key} は対応していない設定です。`);
    for (const [key, expected] of Object.entries(reference)) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}${key} が必要です。`);
      else if (plain(expected) && !(path === 'settings.' && key === 'categories')) shape(value[key], expected, `${path}${key}.`);
    }
  }
  shape(design, standardDesign(), '');
  if (!plain(design)) return errors;
  if (design.layoutTexts !== undefined && (!plain(design.layoutTexts) || Object.entries(design.layoutTexts).some(([layout, texts]) => !LAYOUTS.includes(layout) || !validateDesignTexts(texts)))) errors.push('見本の文字の指定を確認してください。');
  const categories = design.settings?.categories;
  if (!plain(categories) || !Object.keys(categories).length || Object.keys(categories).length > 24) errors.push('カテゴリは1〜24種類で設定してください。');
  else for (const [id, colors] of Object.entries(categories)) {
    if (!validCategoryId(id)) errors.push('カテゴリIDは半角英字から始まる32文字以内の英数字・_・-です。');
    shape(colors, DEFAULT_CATEGORY.colors, `settings.categories.${id}.`);
    if (!builtinName(id) && (typeof design.categoryNames?.[id] !== 'string' || !design.categoryNames[id].trim())) errors.push('追加したカテゴリの名前を入力してください。');
  }
  if (design.categoryNames !== undefined) {
    if (!plain(design.categoryNames)) errors.push('カテゴリ名の形式を確認してください。');
    else for (const [id, name] of Object.entries(design.categoryNames)) {
      if (!Object.hasOwn(categories ?? {}, id) || typeof name !== 'string' || !name.trim() || name.length > 32 || /[\u0000-\u001f\u007f]/.test(name)) errors.push('カテゴリ名は32文字以内で入力してください。');
    }
    const names = Object.entries(categories ?? {}).map(([id]) => String(design.categoryNames[id] ?? builtinName(id) ?? id).trim().normalize('NFKC').toLocaleLowerCase('ja'));
    if (new Set(names).size !== names.length) errors.push('カテゴリ名が重複しています。別の名前を入力してください。');
  }
  // 講義から保存したCSSのデザインテンプレート（npm run design:save・編集画面の「テンプレートとして保存」）。
  if (design.css !== undefined) errors.push(...validateThemeCss(design.css));
  if (design.aiInstructions !== undefined && (typeof design.aiInstructions !== 'string' || design.aiInstructions.length > 6000)) errors.push('AIへの希望は6000文字以内で入力してください。');
  if (design.pdfSource !== undefined) {
    const source = design.pdfSource;
    if (!plain(source) || Object.keys(source).some(key => !['pdfId', 'pages'].includes(key)) || !/^pdf-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(source?.pdfId ?? '')) errors.push('PDFデザインの参照を確認してください。');
    if (!Array.isArray(source?.pages) || !source.pages.length || source.pages.length > 60) errors.push('PDFデザインのページは1〜60枚です。');
    else for (const page of source.pages) {
      if (!plain(page) || Object.keys(page).some(key => !['page', 'label', 'layout', 'edits'].includes(key)) || !Number.isInteger(page.page) || page.page < 1 || page.page > 60 || typeof page.label !== 'string' || page.label.length > 100 || !LAYOUTS.includes(page.layout) || !Array.isArray(page.edits) || page.edits.length > 1000) { errors.push('PDFページの番号・用途・文字の変更を確認してください。'); continue; }
      const ids = new Set();
      for (const edit of page.edits) {
        if (!plain(edit) || Object.keys(edit).some(key => !['id', 'text', 'x', 'y', 'width', 'fontSize', 'color', 'hidden', 'fit'].includes(key)) || !/^text-\d{4}$/.test(edit.id ?? '') || ids.has(edit.id)) { errors.push('PDFの文字の指定を確認してください。'); continue; }
        ids.add(edit.id);
        if (edit.text !== undefined && (typeof edit.text !== 'string' || edit.text.length > 6000)) errors.push('差し替える文字は6000文字以内です。');
        for (const key of ['x', 'y', 'width', 'fontSize']) if (edit[key] !== undefined && (!Number.isFinite(edit[key]) || Math.abs(edit[key]) > 16000 || (['width', 'fontSize'].includes(key) && edit[key] <= 0))) errors.push('PDFの文字位置・サイズを確認してください。');
        if (edit.color !== undefined && !/^#[a-fA-F0-9]{6}$/.test(edit.color)) errors.push('文字色は#RRGGBBで指定してください。');
        if (edit.hidden !== undefined && typeof edit.hidden !== 'boolean') errors.push('文字の表示設定を確認してください。');
        if (edit.fit !== undefined && typeof edit.fit !== 'boolean') errors.push('文字を枠に収める設定を確認してください。');
      }
    }
  }
  if (design.deck !== undefined) {
    const deck = design.deck;
    if (!plain(deck) || Object.keys(deck).some(key => !['slides', 'takehomeCount', 'targetSeconds'].includes(key))) errors.push('構成の形式を確認してください。');
    if (!Array.isArray(deck?.slides) || deck.slides.length < 1 || deck.slides.length > 60) errors.push('スライドは1〜60枚で設定してください。');
    else for (const slot of deck.slides) {
      if (!plain(slot) || Object.keys(slot).some(key => !['layout', 'purpose', 'headingSize', 'bodySize', 'texts', 'composition'].includes(key)) || !LAYOUTS.includes(slot.layout) || typeof slot.purpose !== 'string' || slot.purpose.length > 100) { errors.push('各ページのレイアウトと用途（100文字以内）を確認してください。'); continue; }
      if (slot.composition !== undefined && COMPOSITIONS[slot.composition]?.layout !== slot.layout) errors.push('図解の配置とレイアウトを確認してください。');
      if (slot.texts !== undefined && !validateDesignTexts(slot.texts)) errors.push('ページの文字の指定を確認してください。');
      for (const [key, min, max] of [['headingSize', 16, 160], ['bodySize', 12, 72]]) if (slot[key] !== undefined && (!Number.isInteger(slot[key]) || slot[key] < min || slot[key] > max)) errors.push(`ページごとの${key === 'headingSize' ? '見出し' : '本文'}は${min}〜${max}pxの整数で指定してください。`);
    }
    if (!Number.isInteger(deck?.takehomeCount) || deck.takehomeCount < 1 || deck.takehomeCount > 6) errors.push('まとめの要点数は1〜6個で設定してください。');
    if (!Number.isInteger(deck?.targetSeconds) || deck.targetSeconds < 10 || deck.targetSeconds > 7200) errors.push('予定尺は10〜7200秒で設定してください。');
  }
  if (design.version !== 1) errors.push('デザインの形式はversion 1です。');
  for (const [key, label, max, required] of [['name', 'デザイン名', 60, true], ['description', '説明', 240, false], ['brand', 'ブランド名', 32, true]]) {
    const value = design[key];
    const control = key === 'description' ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
    if (typeof value !== 'string' || (required && !value.trim()) || value.length > max || control.test(value)) errors.push(`${label}は${max}文字以内で入力してください。`);
  }
  if (!Object.hasOwn(DESIGN_FONTS, design.settings?.font ?? '')) errors.push('書体を一覧から選んでください。');
  const colors = [...Object.values(design.settings?.colors ?? {}), ...Object.values(categories ?? {}).flatMap(item => plain(item) ? Object.values(item) : [])];
  if (colors.some(value => typeof value !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(value))) errors.push('色は # と6桁の16進数で指定してください。');
  for (const [path, label, min, max] of DESIGN_NUMBER_FIELDS) {
    const value = getDesignValue(design.settings, path);
    if (!Number.isInteger(value) || value < min || value > max) errors.push(`${label}は${min}〜${max}pxの整数で入力してください。`);
  }
  return errors;
}

// カスタムデザインだけに適用。標準のスライド描画・講義データは変更しない。
export function applyDesignTheme(stage, design, category, slot = null) {
  const errors = validateDesign(design);
  if (errors.length) throw new Error(errors[0]);
  const { settings: s } = design;
  stage.dataset.customDesign = 'true';
  const vars = { paper: s.colors.paper, rule: s.colors.rule, 'text-strong': s.colors.textStrong, text: s.colors.text, 'text-meta': s.colors.textMeta, ...s.categories[category],
    heading: `${s.typography.heading}px`, body: `${s.typography.body}px`, message: `${s.typography.message}px`, left: `${s.spacing.left}px`, right: `${s.spacing.right}px`,
    'design-font': DESIGN_FONTS[s.font].css, 'design-title': `${s.typography.title}px`, 'design-number': `${s.typography.number}px`, 'design-top': `${s.spacing.top}px`, 'design-bottom': `${s.spacing.bottom}px`,
    'design-flow-gap': `${s.layouts.flow.gap}px`, 'design-flow-height': `${s.layouts.flow.minHeight}px`, 'design-statement-padding': `${s.layouts.statement.rowPadding}px`,
    'design-compare-gap': `${s.layouts.compare.gap}px`, 'design-table-padding': `${s.layouts.table.rowPadding}px`, 'design-figure-width': `${s.layouts.figure.width}px`, 'design-figure-height': `${s.layouts.figure.height}px`,
    'design-takehome-columns': `${s.layouts.takehome.columnGap}px`, 'design-takehome-rows': `${s.layouts.takehome.rowGap}px`,
  };
  for (const [name, value] of Object.entries(vars)) stage.style.setProperty(`--${name}`, value);
  for (const name of ['paper', 'rule', 'text-strong', 'text', 'text-meta', 'primary', 'accent', 'soft', 'marker']) stage.style.setProperty(`--design-${name}`, vars[name]);
  for (const name of ['heading', 'body', 'message']) stage.style.setProperty(`--design-${name}`, vars[name]);
  // CSSのテンプレートは、配色をCSS側で決める（要素に直接書いた値はCSSより強いため外す）。
  if (design.css) { for (const name of ['paper', 'rule', 'text-strong', 'text', 'text-meta']) stage.style.removeProperty(`--${name}`); applyThemeCss(stage, design.css); }
  if (slot?.headingSize) for (const key of ['heading', 'design-title', 'message', 'design-heading', 'design-message']) stage.style.setProperty(`--${key}`, `${slot.headingSize}px`);
  if (slot?.bodySize) { stage.style.setProperty('--body', `${slot.bodySize}px`); stage.style.setProperty('--design-body', `${slot.bodySize}px`); }
}

export async function readDesign(id = STANDARD_DESIGN_ID) {
  if (id === STANDARD_DESIGN_ID) return { id, design: standardDesign(), revision: null, builtin: true };
  const response = await fetch(`/api/designs?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'デザインを読み込めません。');
  return result;
}
