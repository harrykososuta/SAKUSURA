import { loadLectureOptions } from './lecture-picker.js';
import { initLectureBrowser } from './lecture-browser.js';
import { initInsertBrowser } from './insert-browser.js';
import { renderSlide, renderShapes } from './slide-view.js';
import { applyPlacement } from './placement.js';
import { cueState, formatTime, plainText, validateLecture, validateDeckStructure, withSlideId, withInsertedAppearance, imageFileOf, blockImagesOf } from './core.js';
import { SHAPE_KINDS, SHAPE_COLORS, SHAPES_MAX, newShape, shapeName } from './shapes.js';
import { readSettings } from './settings.js';
import { standardDesign } from './design-theme.js';
import { initEditorHistory } from './editor-history.js';
import { initEditorImages } from './editor-images.js';
import { restoreLectureVersion } from './history-data.js';
import { initEditorAnimation } from './editor-animation.js';
import { applyMotion } from './motion.js';
import { documentCueTargets } from './document-layout.js';
import { withoutSlideElement } from './editor-elements.js';

const $ = id => document.getElementById(id);
const stage = $('stage');
// ヘッダーの「スライド」：押すとライブラリと同じ構成のエクスプローラーが開き、選んだスライドを従来の選択欄に渡す。
const lectureBrowser = initLectureBrowser({ select: $('lecture-select') });
$('snap').checked = readSettings().snap;
const labels = { title: 'サムネイル', agenda: 'アジェンダ', statement: '要点', flow: 'フロー図', figure: '図と要点', steps: '段階', compare: '比較', table: '表', chat: 'チャット', bars: '棒グラフ', code: 'コード', timeline: '年表', cycle: '輪の図', stack: '層の図', message: '一文', takehome: 'Take Home Message', document: '自由レイアウト' };
let lecture, payload, revision, saved = '', name = '', index = 0, selected = '', scale = 1;
let undoStack = [], redoStack = [], inputGroup = null, saving = false, loading = false, loadingId = 0, gesture = null, inline = null;
let pendingLecture = null, time = 0;
// スライド一覧の複数選択（Ctrl・Shift＋クリック）と、挿入・貼り付けしたスライドの元。
// imports：新しいスライドID → { lecture: 元の講義, slide: 元のスライド }。保存時にサーバーが画像・音声を新しいIDへ写す。
// importImages：保存前の表示用。元の講義の画像をそのまま見せる。
let picked = new Set(), anchor = null, clipboard = null, imports = new Map(), importImages = {};
// 履歴の復元を取り消すときは、未保存の挿入元も一緒に戻す。
const restoredAssetStates = new Map();
const rememberAssetState = key => {
  restoredAssetStates.set(key, { imports: new Map(imports), images: { ...importImages } });
  if (restoredAssetStates.size > 200) restoredAssetStates.delete(restoredAssetStates.keys().next().value);
};
const imageCache = new Map();
function rememberImages(deckName, manifest) {
  for (const entry of Object.values(manifest ?? {})) if (entry.file) imageCache.set(`${deckName}/${entry.file}`, entry);
}
const images = () => {
  const result = { ...importImages, ...payload.images };
  for (const s of lecture.slides) {
    for (const [key, file] of [[s.id, imageFileOf(s)], ...blockImagesOf(s).map(item => [item.key, item.file])]) {
      if (!file) continue;
      const cached = imageCache.get(`${name}/${file}`);
      if (cached) result[key] = cached;
      else if (!imports.has(s.id) && result[key]?.file !== file) result[key] = { file, ready: false };
    }
  }
  return result;
};
let imageEditor, animationEditor, silentMotion = null;
let ttsPreparing = false, activeJob = null, approvedTts = null, jobTimer = null;
const media = new Audio();
media.preload = 'metadata';
const serialize = () => JSON.stringify(lecture);
const dirty = () => !!lecture && serialize() !== saved;
const slide = () => lecture.slides[index];
const shapeAt = key => slide().shapes?.find(s => `shape:${s.id}` === key);
const elementName = key => key === 'title' ? '見出し' : key === 'note' ? 'まとめの一文' : key === 'image' ? '画像' : shapeAt(key) ? `追加 · ${shapeName(shapeAt(key))}` : `本文 ${Math.max(0, slide().blocks.findIndex(b => `block:${b.id}` === key)) + 1}`;
const selectedElement = () => [...stage.querySelectorAll('[data-element]')].find(el => el.dataset.element === selected);
const currentBlock = () => slide().blocks.find(b => `block:${b.id}` === selected);
// 追加した図形・文字は絶対座標（x・y・幅・高さ）を図形自身に持つ。それ以外は placement（標準配置からの移動量）。
const currentShape = () => shapeAt(selected);
function showError(message = '') { $('editor-error').textContent = message; $('editor-error').hidden = !message; }
function history(before) { if (before === serialize()) return; undoStack.push(before); if (undoStack.length > 100) undoStack.shift(); redoStack = []; }
function mutate(fn, group = null) {
  if (!lecture || loading) return;
  const before = serialize(); fn();
  if (before === serialize()) return;
  if (!group || group !== inputGroup) history(before);
  inputGroup = group;
  showError(); renderCanvas(); renderList(index); updateState();
}
function updateState(message) {
  const changed = dirty();
  $('save').disabled = !lecture || !changed || saving || loading || ttsPreparing || activeJob?.state === 'running';
  $('undo').disabled = !undoStack.length || saving || loading;
  $('redo').disabled = !redoStack.length || saving || loading;
  syncElementDelete();
  $('save-status').textContent = message ?? (saving ? '保存しています…' : changed ? '未保存の変更あり' : '保存済み');
  $('save-status').dataset.dirty = String(changed);
  $('lecture-select').disabled = loading || saving || ttsPreparing || activeJob?.state === 'running';
  lectureBrowser.sync();
  $('tts-prepare').disabled = !lecture || loading || saving || ttsPreparing || activeJob?.state === 'running';
  $('tts-scope').disabled = $('tts-prepare').disabled;
  $('slide-insert').disabled = !lecture || loading || saving;
  $('version-history') && ($('version-history').disabled = !lecture || loading || saving || ttsPreparing || activeJob?.state === 'running');
  imageEditor?.sync();
  document.title = `${changed ? '● ' : ''}${lecture?.title ?? 'スライド編集'} | SAKUSURA`;
  updateAudio();
}
// 表示倍率。null は「画面に合わせる」。
const ZOOM_STEPS = [.25, .33, .5, .67, .75, .9, 1, 1.25, 1.5, 2];
let zoom = null;
function fitScale() {
  const area = $('canvas-area'), style = getComputedStyle(area);
  const outer = element => { if (!element.offsetParent) return 0; const s = getComputedStyle(element); return element.offsetHeight + parseFloat(s.marginTop) + parseFloat(s.marginBottom); };
  const width = area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const height = area.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - outer(document.querySelector('.canvas-caption')) - outer(document.querySelector('.canvas-help')) - 4;
  return Math.max(.08, Math.min(width / 1920, height / 1080, 1));
}
function resize() {
  scale = zoom ?? fitScale();
  $('stage-shell').style.width = `${1920 * scale}px`;
  $('stage-shell').style.height = `${1080 * scale}px`;
  stage.style.transform = `scale(${scale})`;
  $('zoom-label').textContent = `${Math.round(scale * 100)}%`;
  $('fit').setAttribute('aria-pressed', String(zoom === null));
  updateSelectionBox();
}
function setZoom(value) { zoom = value === null ? null : Math.max(.1, Math.min(2, value)); resize(); }
new ResizeObserver(resize).observe($('canvas-area'));
$('fit').addEventListener('click', () => setZoom(null));
$('zoom-in').addEventListener('click', () => setZoom(ZOOM_STEPS.find(step => step > scale + .005) ?? 2));
$('zoom-out').addEventListener('click', () => setZoom([...ZOOM_STEPS].reverse().find(step => step < scale - .005) ?? .1));
$('canvas-area').addEventListener('wheel', event => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); setZoom(scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1)); }, { passive: false });

// ナレーション欄の開閉は講義データに含めず、このブラウザの表示設定として保存する。
const audioKey = 'sakusura-editor-audio-collapsed';
function setAudioCollapsed(collapsed, remember = true) {
  $('audio-body').hidden = collapsed; $('audio-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('audio-toggle').firstElementChild.textContent = collapsed ? '原稿を開く' : '原稿をたたむ';
  if (remember) try { localStorage.setItem(audioKey, collapsed ? '1' : ''); } catch {}
}
$('audio-toggle').addEventListener('click', () => setAudioCollapsed(!$('audio-body').hidden));
try { if (localStorage.getItem(audioKey) === '1') setAudioCollapsed(true, false); } catch { /* 保存不可でも開閉は可能。 */ }

// 左（スライド一覧）と右（編集パネル／AIアシスタント）の幅。講義データに含めず、このブラウザの表示設定として保存する。
// sign：つまみを右へ動かしたときに広がるなら 1（左の一覧）、狭まるなら -1（右のパネル）。
const workspace = document.querySelector('.editor-workspace');
function resizablePanel({ separator, panel, key, variable, min, max, sign }) {
  let preferred = null, drag = null;
  try { const value = Number(localStorage.getItem(key)); if (value >= min && value <= 2000) preferred = value; } catch { /* 保存不可でも調整は可能。 */ }
  const width = () => panel.getBoundingClientRect().width, limit = () => Math.max(min, max());
  const clamp = value => Math.round(Math.max(min, Math.min(limit(), value)));
  function sync() {
    if (preferred === null) workspace.style.removeProperty(variable);
    else workspace.style.setProperty(variable, `${clamp(preferred)}px`);
    separator.setAttribute('aria-valuenow', Math.round(width())); separator.setAttribute('aria-valuemax', Math.round(limit()));
  }
  const remember = () => { try { if (preferred === null) localStorage.removeItem(key); else localStorage.setItem(key, preferred); } catch {} };
  function end(cancel = false) {
    if (!drag) return;
    const previous = drag; drag = null;
    if (cancel) preferred = previous.previous;
    if (separator.hasPointerCapture(previous.id)) separator.releasePointerCapture(previous.id);
    separator.classList.remove('is-resizing'); document.body.classList.remove('resizing-sidebar'); sync(); remember();
  }
  separator.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); document.activeElement?.blur();
    drag = { id: event.pointerId, x: event.clientX, width: width(), previous: preferred };
    separator.setPointerCapture(event.pointerId); separator.classList.add('is-resizing'); document.body.classList.add('resizing-sidebar');
  });
  separator.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    preferred = clamp(drag.width + sign * (event.clientX - drag.x)); sync();
  });
  separator.addEventListener('pointerup', () => end()); separator.addEventListener('pointercancel', () => end(true));
  separator.addEventListener('lostpointercapture', () => end());
  separator.addEventListener('dblclick', () => { preferred = null; sync(); remember(); });
  separator.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    preferred = event.key === 'Home' ? min : event.key === 'End' ? limit() : clamp(width() + sign * (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 32 : 16));
    sync(); remember();
  });
  sync();
  return { sync };
}
const slidesPanel = resizablePanel({ separator: $('slides-resizer'), panel: document.querySelector('.slides-sidebar'), key: 'sakusura-editor-slides-width', variable: '--slides-width', min: 140, sign: 1,
  max: () => Math.min(480, workspace.clientWidth - document.querySelector('.properties-sidebar').getBoundingClientRect().width - 316) });
const sidePanel = resizablePanel({ separator: $('props-resizer'), panel: document.querySelector('.properties-sidebar'), key: 'sakusura-editor-right-width', variable: '--props-width', min: 260, sign: -1,
  max: () => Math.min(720, workspace.clientWidth - document.querySelector('.slides-sidebar').getBoundingClientRect().width - 376) });
window.addEventListener('resize', () => { slidesPanel.sync(); sidePanel.sync(); });

function resizeThumbnails() {
  for (const mini of document.querySelectorAll('.slide-mini')) {
    const surface = mini.shadowRoot?.getElementById('stage');
    if (surface) surface.style.transform = `scale(${mini.clientWidth / 1920})`;
  }
}
new ResizeObserver(resizeThumbnails).observe(document.querySelector('.slides-sidebar'));
// Shadow DOMで各サムネイルのIDとCSSを隔離し、再生画面と同じスライドを縮小表示。
function miniSlide(deck, i, deckImages) {
  const mini = document.createElement('div'); mini.className = 'slide-mini'; mini.setAttribute('aria-hidden', 'true');
  const shadow = mini.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<link rel="stylesheet" href="/src/style.css"><section id="stage"><div class="slide-header"><span id="eyebrow"></span><strong id="brand"></strong></div><div id="slide-content"></div><footer class="slide-footer"><span id="lecture-title"></span><span id="slide-number"></span></footer></section>';
  const thumbnail = shadow.getElementById('stage');
  const draw = () => { renderSlide(thumbnail, deck, i, deckImages); thumbnail.querySelectorAll('[data-block]').forEach(e => e.classList.add('visible')); resizeThumbnails(); };
  draw(); shadow.querySelector('link').addEventListener('load', draw, { once: true });
  return mini;
}
function renderList(onlyIndex) {
  const deck = lecture, deckImages = images();
  if (onlyIndex === undefined) $('slide-list').replaceChildren();
  lecture.slides.forEach((item, i) => {
    if (onlyIndex !== undefined && i !== onlyIndex) return;
    const button = document.createElement('button'); button.className = 'slide-item'; button.dataset.index = i; button.draggable = true;
    button.classList.toggle('is-picked', picked.has(item.id) && picked.size > 1);
    button.setAttribute('aria-current', String(i === index)); button.setAttribute('aria-label', `${i + 1}枚目 ${plainText(item.title)}`);
    const footer = document.createElement('div'); footer.className = 'slide-item-footer';
    const number = document.createElement('strong'); number.textContent = String(i + 1).padStart(2, '0');
    const layout = document.createElement('span'); layout.textContent = labels[item.layout]; footer.append(number, layout); button.append(miniSlide(deck, i, deckImages), footer);
    button.addEventListener('click', event => pickSlide(i, event));
    button.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); if (!picked.has(item.id)) pickSlide(i, {}); openSlideMenu(event.clientX, event.clientY, i + 1); });
    button.addEventListener('dragstart', event => startSlideDrag(event, item.id));
    if (onlyIndex !== undefined && $('slide-list').children[i]) $('slide-list').children[i].replaceWith(button);
    else $('slide-list').append(button);
  });
  resizeThumbnails();
  $('slide-count').textContent = `${lecture.slides.length}枚`;
}
function renderCanvas() {
  if (!lecture) return;
  renderSlide(stage, lecture, index, images());
  markTexts();
  updateVisibility(); updateSelectionBox();
  $('slide-label').textContent = `スライド ${String(index + 1).padStart(2, '0')} / ${lecture.slides.length}`;
  $('layout-label').textContent = labels[slide().layout]; $('canvas-title').textContent = plainText(slide().title);
  // 画像の読み込み後、実寸に合わせて選択枠も更新する。
  for (const img of stage.querySelectorAll('img')) img.addEventListener('load', updateSelectionBox, { once: true });
}
// スライド上の文字に、直す先のデータ（data-edit）を付ける。ダブルクリックでその文字を直接編集できる。
// slide.<項目> はこのスライド、lecture.<項目> は講義全体（全スライド共通）、block:/person:/shape:<id>.<項目> は各要素。末尾の数字は配列の何番目か。
// 自動で入る文字（番号・左下の表題・カテゴリ名）は data-auto に、直し方の案内を付ける（AUTO_TEXTS の番号）。
const AUTO_TEXTS = [
  ['#lecture-title', '左下の表題は、1枚目の見出しから自動で入ります。1枚目の見出しを直すと、全スライドの表題が変わります。', { label: '1枚目の見出しを直す', run: () => { navigate(0); stage.querySelector('.heading-text')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); } }],
  ['#slide-number', 'ページ番号は、スライドの順番から自動で振られます。'],
  ['.section-number', '見出しの通し番号は、本編のスライドの順番から自動で振られます。'],
  ['.block-index', '項目の番号（01, 02 …）は、項目の並び順から自動で振られます。'],
  ['.category-tag', 'カテゴリ名は、講義全体の設定の「カテゴリ」で切り替えます。', { label: 'カテゴリを選ぶ', run: () => { $('category-select').scrollIntoView({ block: 'center' }); $('category-select').focus(); } }]];
function markTexts() {
  const mark = (node, path) => { if (node) node.dataset.edit = path; };
  mark(stage.querySelector('.heading-text'), 'slide.title'); mark($('eyebrow'), 'slide.eyebrow'); mark($('brand'), 'lecture.brand');
  mark(stage.querySelector('.deck-number'), 'lecture.number'); mark(stage.querySelector('.slide-note'), 'slide.note'); mark(stage.querySelector('.cycle-center'), 'slide.center');
  stage.querySelectorAll('.table-column').forEach((node, i) => mark(node, `slide.columns.${i}`));
  for (const block of stage.querySelectorAll('[data-element^="block:"]')) {
    const key = block.dataset.element;
    for (const [selector, field] of [['.block-label', 'label'], ['.block-detail', 'detail'], ['.bar-number', 'value'], ['.bar-unit', 'unit'], ['.code-body', 'code'], ['.term-command', 'command'], ['.term-output', 'output']]) block.querySelectorAll(selector).forEach(node => mark(node, `${key}.${field}`));
    // 表は2列目が text、3列目以降が cells。
    block.querySelectorAll('.block-text').forEach((node, i) => mark(node, slide().layout === 'table' && i > 0 ? `${key}.cells.${i - 1}` : `${key}.text`));
  }
  stage.querySelectorAll('.person').forEach((row, i) => { const id = slide().people[i].id; mark(row.querySelector('.person-name'), `person:${id}.name`); mark(row.querySelector('.block-text'), `person:${id}.text`); });
  for (const node of stage.querySelectorAll('.shape-text')) mark(node, `${node.dataset.element}.text`);
  AUTO_TEXTS.forEach(([selector], i) => { for (const node of stage.querySelectorAll(selector)) node.dataset.auto = i; });
}
// 自動で入る文字の案内（吹き出し）。文字のすぐ上（上に余白がなければ下）に出し、外側のクリック・Esc・8秒で閉じる。
let tipTimer = null, tipAction = null;
function showTip(anchor, [, message, action]) {
  const tip = $('canvas-tip'), r = anchor.getBoundingClientRect(), base = $('stage-shell').getBoundingClientRect();
  $('canvas-tip-text').textContent = message;
  tipAction = action?.run ?? null; $('canvas-tip-action').hidden = !action; $('canvas-tip-action').textContent = action?.label ?? '';
  tip.hidden = false;
  const left = Math.max(8, Math.min(base.width - tip.offsetWidth - 8, r.left - base.left + r.width / 2 - tip.offsetWidth / 2));
  const below = r.top - base.top < tip.offsetHeight + 16;
  tip.dataset.side = below ? 'below' : 'above';
  tip.style.left = `${left}px`; tip.style.top = `${below ? r.bottom - base.top + 12 : r.top - base.top - tip.offsetHeight - 12}px`;
  tip.style.setProperty('--arrow', `${Math.max(16, Math.min(tip.offsetWidth - 16, r.left - base.left + r.width / 2 - left))}px`);
  restartTip();
}
function restartTip() { clearTimeout(tipTimer); tipTimer = setTimeout(hideTip, 8000); }
function hideTip() { clearTimeout(tipTimer); $('canvas-tip').hidden = true; tipAction = null; }
$('canvas-tip').addEventListener('pointerenter', () => clearTimeout(tipTimer));
$('canvas-tip').addEventListener('pointerleave', restartTip);
$('canvas-tip-close').addEventListener('click', hideTip);
$('canvas-tip-action').addEventListener('click', () => { const run = tipAction; hideTip(); run?.(); });
document.addEventListener('pointerdown', event => { if (!$('canvas-tip').hidden && !$('canvas-tip').contains(event.target)) hideTip(); }, true);
// data-edit の道筋から、書き換える入れ物（owner）と項目名（key）を返す。
function editTarget(path) {
  const [scope, field, item] = path.split('.');
  let owner = scope === 'slide' ? slide() : scope === 'lecture' ? lecture : null;
  if (!owner) { const [kind, id] = scope.split(':'); owner = (kind === 'block' ? slide().blocks : kind === 'person' ? slide().people : slide().shapes)?.find(entry => entry.id === id); }
  if (!owner) return null;
  return item === undefined ? { owner, key: field, field } : { owner: owner[field], key: Number(item), field };
}
// 1行で入力する項目（Enterで確定）と、空欄にしたら項目ごと消す任意の項目。
const SINGLE_LINE = new Set(['eyebrow', 'brand', 'number', 'center', 'columns', 'value', 'unit', 'name', 'command']);
const OPTIONAL = new Set(['eyebrow', 'brand', 'detail', 'unit']);
function parseText(field, value) {
  if (field === 'number') { const digits = value.trim().replace(/^#/, ''); if (!/^\d{1,4}$/.test(digits)) throw new Error('演題番号は4桁までの数字で入力してください。'); return String(Number(digits)); }
  if (field === 'value') { const number = Number(value.trim().replaceAll(',', '')); if (value.trim() === '' || !Number.isFinite(number) || number < 0) throw new Error('棒グラフの数値は0以上の数字で入力してください。'); return number; }
  return SINGLE_LINE.has(field) ? value.replace(/\s*\n\s*/g, ' ').trim() : value;
}
function updateVisibility() {
  if (!lecture) return;
  const visible = cueState(slide().cues, time);
  for (const el of stage.querySelectorAll('[data-block]')) el.classList.toggle('visible', !$('cue-preview').checked || visible.has(el.dataset.block));
  if ($('cue-preview').checked) applyMotion(stage, lecture, slide(), time, duration(), { frames: true });
}
function select(key, focus = false) {
  selected = key; inputGroup = null; renderProperties(); updateSelectionBox();
  syncElementDelete();
  if (focus) $('stage-shell').focus({ preventScroll: true });
}
function updateSelectionBox() {
  const el = selectedElement();
  $('selection-box').hidden = !el || !!inline;
  if (!el) return;
  const r = el.getBoundingClientRect(), base = $('stage-shell').getBoundingClientRect();
  Object.assign($('selection-box').style, { left: `${r.left - base.left}px`, top: `${r.top - base.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  $('selection-caption').textContent = elementName(selected);
}
function textField(label, value, key, owner) {
  const field = document.createElement('label'); field.className = 'field'; field.textContent = label;
  const input = document.createElement('textarea'); input.rows = key === 'text' || key === 'title' ? 3 : 2; input.value = value ?? ''; input.dataset.field = key;
  input.addEventListener('input', () => mutate(() => { owner()[key] = input.value; }, input));
  field.append(input); $('text-fields').append(field);
}
function renderProperties() {
  syncElementDelete();
  animationEditor?.sync();
  $('category-select').replaceChildren();
  // カテゴリは designs/category-presets.json の一覧。一覧から消したカテゴリも、講義に残っていればIDのまま表示する。
  const known = categoryChoices.some(item => item.id === lecture.category);
  for (const [value, text] of [['', '未指定'], ...categoryChoices.map(item => [item.id, item.name]), ...(lecture.category && !known ? [[lecture.category, lecture.category]] : [])]) {
    const option = document.createElement('option'); option.value = value; option.textContent = text; $('category-select').append(option);
  }
  $('category-select').value = lecture.category ?? '';
  $('motion-select').value = lecture.motion ?? '';
  if (document.activeElement !== $('number-input')) $('number-input').value = lecture.number ?? '';
  $('element-select').replaceChildren();
  const options = [['', '文字・画像を選択'], ['title', '見出し'], ...slide().blocks.map((b, i) => [`block:${b.id}`, `本文 ${i + 1} · ${plainText(b.label || b.text).slice(0, 12)}`]), ...(slide().note ? [['note', 'まとめの一文']] : []), ...(slide().image ? [['image', '画像']] : []), ...(slide().shapes ?? []).map(s => [`shape:${s.id}`, `追加 · ${shapeName(s)}`])];
  for (const [key, label] of options) { const option = document.createElement('option'); option.value = key; option.textContent = label; $('element-select').append(option); }
  $('element-select').value = selected;
  $('properties-empty').hidden = !!selected; $('element-properties').hidden = !selected; $('text-fields').replaceChildren();
  if (!selected) return;
  const shape = currentShape();
  $('shape-fields').hidden = !shape; $('reset-position').hidden = !!shape;
  if (shape) renderShapeFields(shape);
  if (selected === 'title') textField('見出し', slide().title, 'title', slide);
  else if (selected === 'note') textField('まとめの一文', slide().note, 'note', slide);
  else if (shape) { if (shape.kind === 'text') textField('文字', shape.text, 'text', currentShape); }
  else if (selected === 'image') {
    textField('画像の説明', slide().image.alt, 'alt', () => slide().image);
    const edit = document.createElement('button'); edit.type = 'button'; edit.id = 'image-replace'; edit.textContent = '画像を差し替え・トリミング'; edit.addEventListener('click', () => imageEditor.open()); $('text-fields').append(edit);
  } else {
    const block = currentBlock();
    if (slide().layout === 'document' && block.image) {
      textField('画像の説明',block.image.alt,'alt',()=>currentBlock().image);
      const edit=document.createElement('button');edit.type='button';edit.id='image-replace';edit.textContent='画像を差し替え・トリミング';edit.addEventListener('click',()=>imageEditor.open());$('text-fields').append(edit);
    } else {
      if(slide().layout!=='document')textField('小見出し', block.label, 'label', currentBlock);
      textField('本文', block.text, 'text', currentBlock);
      if(slide().layout!=='document')textField('補足説明', block.detail, 'detail', currentBlock);
    }
    if (slide().layout === 'code') for (const [key, label] of [['code', 'コード'], ['command', 'コマンド'], ['output', '実行結果']]) textField(label, block[key], key, currentBlock);
    for (const [i, value] of (block.cells ?? []).entries()) textField(`表の ${i + 3} 列目`, value, i, () => currentBlock().cells);
  }
  $('height-field').hidden = selected !== 'image' && !SHAPE_KINDS[shape?.kind]?.height && !(slide().layout==='document'&&currentBlock()?.image);
  $('position-x-label').textContent = shape ? '左端からの位置（px）' : '左右の移動（px）';
  $('position-y-label').textContent = shape ? '上端からの位置（px）' : '上下の移動（px）';
  $('geometry-note').textContent = shape ? 'スライド左上からの位置' : '元の位置からの移動量';
  $('cue-field').hidden = !selected.startsWith('block:') && !shape && selected !== 'note';
  if (!$('cue-field').hidden) {
    const cue = slide().cues.find(c => c.target === cueTarget());
    // 追加した図形・文字は表示タイミングが任意。未設定ならスライドの最初から表示し、最終チェックで知らせる。
    $('cue-at').value = cue?.at ?? (shape ? '' : 0); $('cue-at').max = duration(); $('cue-at').placeholder = shape ? '未設定' : '';
    $('cue-state').hidden = !shape || !!cue; $('cue-clear').hidden = !shape || !cue;
  }
  updateGeometryInputs();
}
function renderShapeFields(shape) {
  const kind = SHAPE_KINDS[shape.kind];
  $('shape-color').replaceChildren(...kind.colors.map(color => { const option = document.createElement('option'); option.value = color; option.textContent = SHAPE_COLORS[color]; return option; }));
  $('shape-color').value = shape.color;
  $('shape-size-field').hidden = shape.kind !== 'text'; $('shape-size').value = String(shape.size ?? 28);
  $('shape-angle-field').hidden = !kind.angle; $('shape-angle').value = shape.angle ?? 0;
}
const cueTarget = () => selected === 'note' ? 'note' : currentBlock()?.id ?? currentShape()?.id;
function geometry() { const shape = currentShape(); return shape ? { x: shape.x, y: shape.y, width: shape.width, height: shape.height } : slide().placement?.[selected] ?? {}; }
function updateGeometryInputs() {
  const p = geometry();
  $('position-x').value = p.x ?? 0; $('position-y').value = p.y ?? 0;
  $('element-width').value = p.width ?? ''; $('element-height').value = p.height ?? '';
}
// keepPicked：Ctrl・Shift＋クリックで複数のスライドを選んでいるときは、選択を保ったまま表示だけを切り替える。
function navigate(i, keepPicked = false) {
  if (!lecture || loading || gesture) return;
  stopSilentMotion();
  document.activeElement?.blur(); media.pause(); time = 0; index = i; selected = ''; inputGroup = null; hideTip();
  if (!keepPicked) { picked = new Set([slide().id]); anchor = slide().id; }
  $('narration-input').value = slide().ttsText ?? slide().narration; $('eyebrow-input').value = slide().eyebrow ?? '';
  $('display-narration-input').value = slide().narration; $('display-narration-details').open = false;
  $('display-narration-details').hidden = slide().ttsText === undefined;
  $('planned-seconds').value = slide().plannedSeconds; $('gap-after').value = slide().gapAfter;
  refreshMedia(); renderList(); renderCanvas(); renderProperties(); updateState(); syncTemplateItem();
  $('slide-list').querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
}

// keep：同じ講義を読み込み直すとき（AI・別の画面での変更の反映）は、表示中のスライドと選択を保つ。
async function load(nameToLoad, { keep = false, message } = {}) {
  const position = keep && nameToLoad === name && lecture ? { index, selected } : null;
  const op = ++loadingId; loading = true; clearTimeout(jobTimer); activeJob = null; if (!position) $('tts-progress').textContent = ''; updateState(); showError(); media.pause();
  try {
    const response = await fetch(`/api/lecture?name=${encodeURIComponent(nameToLoad)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('講義を読み込めません。起動ターミナルと講義データを確認してください。');
    const data = await response.json(); if (op !== loadingId) return;
    payload = data; lecture = structuredClone(data.lecture); revision = data.revision; name = nameToLoad; saved = serialize();
    imageCache.clear(); rememberImages(name, data.images);
    imports = new Map(); importImages = {}; closeSlideMenu();
    restoredAssetStates.clear();
    undoStack = []; redoStack = []; inputGroup = null; loading = false; $('external-change').hidden = true;
    $('lecture-select').value = name; $('player-link').href = `/?lecture=${encodeURIComponent(name)}`;
    $('library-link').href = `/library?lecture=${encodeURIComponent(name)}`;
    const url = new URL(location.href); url.searchParams.set('lecture', name); historyReplace(url);
    navigate(position ? Math.min(position.index, lecture.slides.length - 1) : 0);
    if (position?.selected && stage.querySelector(`[data-element="${CSS.escape(position.selected)}"]`)) select(position.selected);
    resize(); void resumeTts(name);
    if (!position) watchLecture();
  } catch (error) { showError(error.message); }
  finally {
    if (op === loadingId) {
      loading = false; if (name) $('lecture-select').value = name; updateState(message);
      if (message) setTimeout(() => { if (!saving && !loading) updateState(); }, 4000);
    }
  }
}
// AIエージェントや別の画面で lecture.json が変わったら知らせを受け、未保存の変更がなければ自動で読み込み直す。
let lectureEvents = null, externalTimer = null;
function watchLecture() {
  lectureEvents?.close(); clearTimeout(externalTimer);
  lectureEvents = new EventSource(`/api/lecture/events?name=${encodeURIComponent(name)}`);
  lectureEvents.addEventListener('change', event => { try { externalChange(JSON.parse(event.data).revision); } catch { /* 形式違いは無視 */ } });
}
function externalChange(next) {
  clearTimeout(externalTimer);
  if (!lecture || next === revision) return;
  // 自分の保存・読み込み・ドラッグ・文字の直接編集・音声生成のあいだは、終わってから比べ直す。
  if (saving || loading || gesture || inline || ttsPreparing || activeJob?.state === 'running' || document.querySelector('#history-dialog[open],#image-dialog[open],#insert-dialog[open]')) { externalTimer = setTimeout(() => externalChange(next), 500); return; }
  if (dirty()) { $('external-change').hidden = false; return; }
  void load(name, { keep: true, message: 'AI・別の画面での変更を反映しました' });
}
$('external-reload').addEventListener('click', () => { $('external-change').hidden = true; void load(name, { keep: true, message: '最新の内容を読み込みました' }); });
$('external-dismiss').addEventListener('click', () => { $('external-change').hidden = true; });
function historyReplace(url) { window.history.replaceState(null, '', url); }

async function save() {
  document.activeElement?.blur();
  if (saving || !lecture || loading || activeJob?.state === 'running') return false;
  if (!dirty()) return true;
  const problems = [...validateLecture(lecture), ...validateDeckStructure(lecture)];
  for (const s of lecture.slides) {
    const d = slideAudioReady(s) ? payload.audio[s.id].duration : s.plannedSeconds;
    if (s.cues.some(c => c.at >= d)) problems.push(`${s.id}: 表示タイミングが音声または予定尺を超えています。`);
  }
  if (problems.length) { showError(problems.join('\n')); return false; }
  const captured = serialize(); saving = true; updateState(); showError();
  let message, sending = [];
  try {
    // 挿入・貼り付けしたスライドのうち、まだ講義にあるものだけ画像・音声の写しを頼む。
    const ids = new Set(lecture.slides.map(s => s.id));
    sending = [...imports].filter(([id]) => ids.has(id)).map(([id, from]) => ({ id, from }));
    const response = await fetch(`/api/lecture?name=${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Studio-Editor': '1' }, body: JSON.stringify({ lecture: JSON.parse(captured), revision, imports: sending }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '保存できませんでした。');
    revision = result.revision; saved = captured;
    for (const item of sending) {
      imports.delete(item.id);
      for (const assets of restoredAssetStates.values()) assets.imports.delete(item.id);
    }
    if (result.copied) message = `保存しました（挿入したスライドの画像・音声を ${result.copied}件コピー）`;
    // 編集を続けていても保存した版だけを音声の基準にする。
    for (const s of JSON.parse(captured).slides) {
      const previous = payload.lecture.slides.find(item => item.id === s.id);
      if (!previous || (previous.ttsText ?? previous.narration) !== (s.ttsText ?? s.narration) || previous.style !== s.style) payload.audio[s.id] = { ready: false };
    }
    payload.lecture = JSON.parse(captured);
    try {
      const fresh = await fetch(`/api/lecture?name=${encodeURIComponent(name)}`, { cache: 'no-store' });
      if (fresh.ok) {
        const data = await fresh.json();
        if (data.revision === revision) { payload.audio = data.audio; payload.images = data.images; rememberImages(name, data.images); }
      }
    } catch { /* 保存済み。次の読み込みで音声状態を再確認する。 */ }
    if (serialize() === captured) { renderCanvas(); renderList(); refreshMedia(); }
    return true;
  } catch (error) { showError(error.message); return false; }
  finally {
    saving = false; updateState(message);
    if (message) setTimeout(() => { if (!saving && !loading) updateState(); }, 5000);
  }
}
$('save').addEventListener('click', save);
$('element-select').addEventListener('change', e => select(e.target.value));
$('category-select').addEventListener('change', e => {
  mutate(() => { if (e.target.value) lecture.category = e.target.value; else delete lecture.category; });
  renderList();
});
// 動き多め：線が引かれる・横から入る動きを全スライドにつけ、1枚の情報量を増やせる。
$('motion-select').addEventListener('change', e => {
  mutate(() => { if (e.target.value) lecture.motion = e.target.value; else delete lecture.motion; });
  renderList();
});
let categoryChoices = [];
async function loadCategories() {
  try { const response = await fetch('/api/category-designs', { cache: 'no-store' }); if (response.ok) categoryChoices = (await response.json()).categories; } catch { /* 読めないときは「未指定」と講義のカテゴリだけを出す。 */ }
}
// 演題番号：サムネイルの #番号。数字だけを受け付け、空欄のあいだは元の番号のまま。
$('number-input').addEventListener('input', e => {
  const value = e.target.value.trim();
  if (!/^\d{1,4}$/.test(value)) return;
  mutate(() => { lecture.number = String(Number(value)); }, e.target);
  renderList();
});
document.addEventListener('focusout', () => { inputGroup = null; });

function undo(redo = false) {
  document.activeElement?.blur(); if (saving || loading || gesture) return;
  const from = redo ? redoStack : undoStack, to = redo ? undoStack : redoStack;
  if (!from.length) return;
  to.push(serialize()); lecture = JSON.parse(from.pop()); inputGroup = null;
  const assets = restoredAssetStates.get(serialize());
  if (assets) { imports = new Map(assets.imports); importImages = { ...assets.images }; }
  const oldSelected = selected; navigate(Math.min(index, lecture.slides.length - 1));
  if (oldSelected === 'title' || oldSelected === 'image' && slide().image || slide().blocks.some(b => `block:${b.id}` === oldSelected) || shapeAt(oldSelected)) select(oldSelected);
}
$('undo').addEventListener('click', () => undo()); $('redo').addEventListener('click', () => undo(true));
function setPlacement(key, value) { const s = slide(); s.placement ??= {}; s.placement[selected] ??= {}; if (value === undefined) delete s.placement[selected][key]; else s.placement[selected][key] = value; }
// 位置・大きさの入力範囲。追加した図形はスライドの内側に収まる範囲だけ。
function geometryRange(key) {
  const shape = currentShape();
  if (!shape) return { x: [-1920, 1920], y: [-1080, 1080], width: [slide().layout==='document'?4:64, 1920], height: [slide().layout==='document'?4:64, 1080] }[key];
  const kind = SHAPE_KINDS[shape.kind];
  return { x: [0, 1920 - shape.width], y: [0, 1080 - (shape.height ?? 0)], width: [kind.width[0], 1920 - shape.x], height: [kind.height?.[0] ?? 0, 1080 - shape.y] }[key];
}
const fitRange = (key, value) => { const [min, max] = geometryRange(key); return Math.max(min, Math.min(max, Math.round(value))); };
function setGeometry(key, value) { const shape = currentShape(); if (shape) shape[key] = value; else setPlacement(key, value); }
// ドラッグ中は描き直さず、位置と大きさだけを反映する（追加した図形は層ごと描き直す）。
function applyGeometry() { if (currentShape()) { renderShapes(stage, slide()); updateVisibility(); } else applyPlacement(stage, slide()); }
for (const [id, key] of [['position-x', 'x'], ['position-y', 'y'], ['element-width', 'width'], ['element-height', 'height']]) {
  $(id).addEventListener('change', e => {
    const value = e.target.value === '' && ['width', 'height'].includes(key) && !currentShape() ? undefined : Number(e.target.value);
    const [min, max] = geometryRange(key);
    if (value !== undefined && (e.target.value === '' || !Number.isFinite(value) || value < min || value > max)) { showError(`${min}〜${max}の範囲で入力してください。`); updateGeometryInputs(); return; }
    mutate(() => setGeometry(key, value)); updateGeometryInputs();
  });
}
$('reset-position').addEventListener('click', () => { mutate(() => { if (slide().placement) delete slide().placement[selected]; }); updateGeometryInputs(); });
$('reset-slide').addEventListener('click', () => { mutate(() => { delete slide().placement; }); updateGeometryInputs(); });
for (const button of document.querySelectorAll('[data-align]')) button.addEventListener('click', () => {
  const el = selectedElement(); if (!el) return;
  const r = el.getBoundingClientRect(), base = stage.getBoundingClientRect();
  const left = (r.left - base.left) / scale, width = r.width / scale;
  const target = button.dataset.align === 'left' ? 184 : button.dataset.align === 'right' ? 1780 - width : 184 + (1596 - width) / 2;
  const x = fitRange('x', (geometry().x ?? 0) + target - left);
  mutate(() => setGeometry('x', x)); updateGeometryInputs();
});
$('narration-input').addEventListener('input', e => mutate(() => {
  // メインの欄は必ず実際の発話原稿を編集する。読み補助原稿が優先される場合も同じ操作。
  if (slide().ttsText !== undefined) slide().ttsText = e.target.value;
  else slide().narration = e.target.value;
}, e.target));
$('display-narration-input').addEventListener('input', e => mutate(() => { slide().narration = e.target.value; }, e.target));
$('eyebrow-input').addEventListener('input', e => mutate(() => { slide().eyebrow = e.target.value; }, e.target));
for (const [id, key, min] of [['planned-seconds', 'plannedSeconds', .1], ['gap-after', 'gapAfter', 0]]) $(id).addEventListener('change', e => {
  const value = Number(e.target.value);
  if (!Number.isFinite(value) || value < min) { e.target.value = slide()[key]; return; }
  mutate(() => { slide()[key] = value; });
});

// 移動量は画面倍率を除いて保存。表示アニメーションのtransformとは独立させる。
stage.addEventListener('pointerdown', event => {
  if (event.button !== 0 || inline || loading || !lecture) return;
  const element = event.target.closest('[data-element]');
  if (!element) { select(''); return; }
  document.activeElement?.blur(); select(element.dataset.element, true); startGesture(event, false);
});
// 画像はブラウザ標準のドラッグ（画像を持ち出す動作）が始まると pointercancel で移動が取り消されるため、止める。
stage.addEventListener('dragstart', event => event.preventDefault());
$('resize-handle').addEventListener('pointerdown', event => { if (event.button === 0) { event.preventDefault(); startGesture(event, true); } });
function startGesture(event, resizing) {
  const el = selectedElement(); if (!el) return;
  const r = el.getBoundingClientRect();
  const base = stage.getBoundingClientRect();
  gesture = { before: serialize(), startX: event.clientX, startY: event.clientY, resizing, moved: false, pointer: event.pointerId, capture: event.currentTarget, p: { ...geometry() }, width: r.width / scale, height: r.height / scale, left: (r.left - base.left) / scale, top: (r.top - base.top) / scale };
}
document.addEventListener('pointermove', event => {
  if (!gesture || gesture.pointer !== event.pointerId) return;
  const dx = (event.clientX - gesture.startX) / scale, dy = (event.clientY - gesture.startY) / scale;
  if (!gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 3) return;
  if (!gesture.moved) gesture.capture.setPointerCapture(event.pointerId);
  gesture.moved = true;
  const snap = n => $('snap').checked ? Math.round(n / 8) * 8 : Math.round(n);
  const shape = currentShape();
  if (gesture.resizing) {
    // 追加した図形は図形自身の幅・高さ（回転した矢印でも長さ）を基準にする。
    setGeometry('width', fitRange('width', snap((shape ? gesture.p.width : gesture.width) + dx)));
    if (selected === 'image' || SHAPE_KINDS[shape?.kind]?.height) setGeometry('height', fitRange('height', snap((shape ? gesture.p.height : gesture.height) + dy)));
  } else {
    const x = Math.max(80 - gesture.left, Math.min(1840 - gesture.left - gesture.width, snap(dx)));
    const y = Math.max(110 - gesture.top, Math.min(960 - gesture.top - gesture.height, snap(dy)));
    setGeometry('x', fitRange('x', (gesture.p.x ?? 0) + x));
    setGeometry('y', fitRange('y', (gesture.p.y ?? 0) + y));
  }
  applyGeometry(); updateSelectionBox(); updateGeometryInputs(); updateState();
});
function finishGesture(cancel = false) {
  if (!gesture) return;
  const g = gesture; gesture = null;
  if (g.capture.hasPointerCapture(g.pointer)) g.capture.releasePointerCapture(g.pointer);
  if (!g.moved) { updateSelectionBox(); return; }
  if (cancel) lecture = JSON.parse(g.before); else if (g.moved) history(g.before);
  renderCanvas(); updateGeometryInputs(); updateState(); inputGroup = null;
}
document.addEventListener('pointerup', () => finishGesture()); document.addEventListener('pointercancel', () => finishGesture(true));
// ダブルクリックでは元の **強調** 記法を含む文章を直接編集する。見出し・本文に加え、ヘッダー・演題番号・表の見出し・人物紹介なども対象。
stage.addEventListener('dblclick', event => {
  if (inline || loading || !lecture) return;
  const auto = event.target.closest('[data-auto]');
  if (auto && !event.target.closest('[data-edit]')) { finishGesture(); showTip(auto, AUTO_TEXTS[auto.dataset.auto]); return; }
  const text = event.target.closest('[data-edit]'); if (!text) return;
  const path = text.dataset.edit, element = text.closest('[data-element]');
  finishGesture(); select(element?.dataset.element ?? '');
  // 選び直しで描き直されることがあるため、新しいDOMから同じ文字を取り直す。
  const target = stage.querySelector(`[data-edit="${CSS.escape(path)}"]`), edit = editTarget(path);
  if (!target || !edit) return;
  const { owner, key, field } = edit, single = SINGLE_LINE.has(field);
  const original = String(owner[key] ?? (field === 'brand' ? 'SAKUSURA' : ''));
  target.textContent = original; target.contentEditable = 'plaintext-only';
  inline = { target, cancel: false }; updateSelectionBox(); target.focus();
  const range = document.createRange(); range.selectNodeContents(target); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  // 1行の項目はEnter、複数行の項目はCtrl+Enterで確定する（日本語入力の変換中は除く）。
  const confirm = key => { if (key.key === 'Enter' && !key.isComposing && (single || key.ctrlKey || key.metaKey)) { key.preventDefault(); target.blur(); } };
  target.addEventListener('keydown', confirm);
  target.addEventListener('blur', () => {
    // ヘッダーの文字（ブランド名・補足文）は描き直しで作り直されないため、編集状態を外しておく。
    target.removeEventListener('keydown', confirm); target.removeAttribute('contenteditable');
    const state = inline; if (!state) return;
    const typed = target.innerText.replace(/\r\n/g, '\n'); inline = null;
    let value;
    try { value = state.cancel ? original : parseText(field, typed); } catch (error) { renderCanvas(); showError(error.message); renderProperties(); updateState(); return; }
    if (!state.cancel && String(value) !== original) mutate(() => { if (OPTIONAL.has(field) && value === '') delete owner[key]; else owner[key] = value; });
    else renderCanvas();
    if (field === 'eyebrow') $('eyebrow-input').value = slide().eyebrow ?? '';
    // 講義全体の項目（ブランド名・演題番号）と1枚目の見出し（左下の表題）は、全スライドのサムネイルに出る。
    if (path.startsWith('lecture.') || (index === 0 && field === 'title')) renderList();
    renderProperties(); updateState();
  }, { once: true });
});

function duration() { return lecture && slideAudioReady(slide()) ? payload.audio[slide().id].duration : lecture ? slide().plannedSeconds : 1; }
function audioReady() {
  if (!lecture) return false;
  return slideAudioReady(slide());
}
function slideAudioReady(s) {
  const original = payload.lecture.slides.find(item => item.id === s.id);
  return original && (original.ttsText ?? original.narration) === (s.ttsText ?? s.narration) && original.style === s.style && !!payload.audio[s.id]?.ready;
}
function refreshMedia() {
  media.pause();
  if (audioReady()) media.src = payload.audio[slide().id].url; else media.removeAttribute('src');
  media.load(); updateAudio();
}
function updateAudio() {
  if (!lecture) return;
  const ready = audioReady();
  time = Math.min(time, duration());
  if (!ready && !media.paused) media.pause();
  $('audio-play').disabled = !ready;
  $('audio-play').textContent = media.paused ? '▶ 試聴' : 'Ⅱ 停止';
  $('audio-status').textContent = ready ? '音声は最新です' : imports.has(slide().id) ? '保存すると、元のスライドの音声をコピーします' : '音声の生成・更新が必要です';
  $('audio-seek').max = duration(); $('audio-seek').value = Math.min(time, duration());
  $('audio-time').textContent = `${formatTime(time)} / ${formatTime(duration())}`;
}
$('audio-play').addEventListener('click', async () => {
  stopSilentMotion();
  if (!audioReady()) return;
  if (!media.paused) media.pause();
  else { try { if (!media.src) media.src = payload.audio[slide().id].url; await media.play(); } catch { showError('音声を再生できません。音声ファイルと再生画面を確認してください。'); } }
  updateAudio();
});
$('audio-seek').addEventListener('input', e => { stopSilentMotion(); time = Number(e.target.value); if (audioReady() && media.readyState > 0) media.currentTime = time; updateVisibility(); updateAudio(); });
$('cue-preview').addEventListener('change', () => { stopSilentMotion(); renderCanvas(); updateSelectionBox(); });
media.addEventListener('ended', updateAudio); media.addEventListener('error', () => { if (media.getAttribute('src')) showError('音声ファイルを読み込めません。'); });
function stopSilentMotion() { silentMotion = null; if ($('animation-preview')) $('animation-preview').textContent = '無音で動きを確認'; }
function frame(now) {
  if (silentMotion && lecture) {
    time = Math.min(duration(), (now - silentMotion.start) / 1000); updateAudio(); updateVisibility(); updateSelectionBox();
    if (time >= duration()) stopSilentMotion();
  } else if (!media.paused && lecture) { time = media.currentTime; updateAudio(); updateVisibility(); }
  requestAnimationFrame(frame);
} requestAnimationFrame(frame);
document.addEventListener('visibilitychange', () => { if (document.hidden) { media.pause(); updateAudio(); } });
function setCue(value) {
  const target = cueTarget(); if (!target) return;
  if (!Number.isFinite(value) || value < 0 || value >= duration()) { showError(`表示タイミングは0秒以上、${duration().toFixed(1)}秒未満です。`); renderProperties(); return; }
  mutate(() => {
    for(const member of documentCueTargets(slide(),target)){
      const cue = slide().cues.find(c => c.target === member);
      if (cue) cue.at = value; else slide().cues.push({ at: value, target:member });
    }
    slide().cues.sort((a, b) => a.at - b.at);
  });
  renderProperties();
}
// 追加した図形・文字のタイミングを外し、スライドの最初から表示する状態に戻す。
function clearCue() { const target = currentShape()?.id; if (!target) return; mutate(() => { slide().cues = slide().cues.filter(c => c.target !== target); }); renderProperties(); }
$('cue-at').addEventListener('change', e => { if (e.target.value === '' && currentShape()) clearCue(); else setCue(Number(e.target.value)); });
$('cue-now').addEventListener('click', () => setCue(Math.round(time * 10) / 10)); $('cue-clear').addEventListener('click', clearCue);

// 図形・文字の追加と削除。id は本文・人物と重ならない shape-<番号>。
function addShape(kind) {
  if (!lecture || loading || inline) return;
  const shapes = slide().shapes ?? [];
  if (shapes.length >= SHAPES_MAX) { showError(`追加できる図形・文字は1枚に${SHAPES_MAX}個までです。`); return; }
  const used = new Set([...shapes.map(s => s.id), ...slide().blocks.map(b => b.id), ...(slide().people ?? []).map(p => p.id), 'note']);
  let number = 1; while (used.has(`shape-${number}`)) number++;
  const shape = newShape(kind, `shape-${number}`);
  // 続けて足したときに同じ位置へ重ならないよう、少しずつずらす。
  shape.x += (shapes.length % 5) * 32; shape.y += (shapes.length % 5) * 32;
  mutate(() => { slide().shapes = [...shapes, shape]; });
  select(`shape:${shape.id}`, true);
}
function syncElementDelete() {
  const button = $('element-delete');
  const supported = selected && selected !== 'title';
  button.disabled = !lecture || !supported || loading || saving || !!inline || !!gesture || ttsPreparing || activeJob?.state === 'running';
  button.title = selected === 'title' ? '見出しはスライドの識別に必要です。文字を編集できます。' : '選択した本文・画像・図形を削除（Delete / Backspace）';
}
function removeSelectedElement() {
  if (!lecture || !selected || loading || saving || inline || gesture || ttsPreparing || activeJob?.state === 'running') return;
  if (selected === 'title') { showError('見出しはスライドの識別に必要です。文字を編集できます。'); return; }
  try {
    const replacement = withoutSlideElement(slide(), selected);
    if (!replacement) return;
    const slides = lecture.slides.map((s, i) => i === index ? replacement : s);
    const errors = validateLecture({ ...lecture, slides });
    if (errors.length) { showError(`このレイアウトで必要な要素のため削除できません。${errors[0]}`); return; }
    const label = elementName(selected);
    // Clear selection before drawing, so property fields never reference a removed block.
    selected = '';
    mutate(() => { lecture.slides[index] = replacement; lecture.slidesEdited = true; });
    select('', true);
    updateState(`${label}を削除しました。「元に戻す」で戻せます。`);
  } catch (error) { showError(error.message); }
}
for (const button of document.querySelectorAll('[data-add-shape]')) button.addEventListener('click', () => addShape(button.dataset.addShape));
$('shape-delete').addEventListener('click', removeSelectedElement);
$('element-delete').addEventListener('click', removeSelectedElement);
$('shape-color').addEventListener('change', e => mutate(() => { currentShape().color = e.target.value; }));
$('shape-size').addEventListener('change', e => mutate(() => { currentShape().size = Number(e.target.value); }));
$('shape-angle').addEventListener('change', e => {
  const value = Number(e.target.value);
  if (e.target.value === '' || !Number.isFinite(value) || value < -180 || value > 180) { showError('角度は−180〜180の範囲で入力してください。'); renderProperties(); return; }
  mutate(() => { currentShape().angle = Math.round(value); });
});

// ===== スライドの挿入・コピー・貼り付け・並べ替え・削除（PowerPointのスライド一覧と同じ操作） =====
// 枚数・並びのルール（12枚など）は生成時のもの。ここで並びを変えた講義には slidesEdited を付け、検査を外す。
const slideIndexOf = id => lecture.slides.findIndex(s => s.id === id);
const pickedIndices = () => { const list = lecture.slides.flatMap((s, i) => picked.has(s.id) ? [i] : []); return list.length ? list : [index]; };
const focusList = () => $('slide-list').querySelector('[aria-current="true"]')?.focus({ preventScroll: true });
function pickSlide(i, event) {
  const id = lecture.slides[i].id;
  if (event.shiftKey && anchor && slideIndexOf(anchor) >= 0) {
    const [a, b] = [slideIndexOf(anchor), i].sort((x, y) => x - y);
    picked = new Set(lecture.slides.slice(a, b + 1).map(s => s.id)); navigate(i, true);
  } else if (event.ctrlKey || event.metaKey) {
    if (picked.has(id) && picked.size > 1) picked.delete(id); else picked.add(id);
    anchor = id; navigate(picked.has(id) ? i : slideIndexOf([...picked][0]), true);
  } else navigate(i);
  focusList();
}
// 写し：今の内容と、画像・音声を写す元（保存済みのスライドなら保存した版、挿入したスライドならその元）。
function snapshotOf(deckName, deck, deckImages, i, saved) {
  const s = deck.slides[i];
  const savedSlide = saved?.slides.find(item => item.id === s.id);
  const origin = deckName === name && imports.has(s.id) ? imports.get(s.id) : savedSlide ? { lecture: deckName, slide: structuredClone(savedSlide) } : null;
  const own = Object.fromEntries(Object.entries(deckImages).filter(([key]) => key === s.id || key.startsWith(`${s.id}:`)));
  return { slide: structuredClone(s), origin, images: own };
}
const currentSnapshot = i => snapshotOf(name, lecture, images(), i, payload.lecture);
function freeId(used) {
  let n = Math.max(0, ...[...used].filter(id => /^\d+$/.test(id)).map(Number)) + 1;
  while (used.has(String(n).padStart(3, '0'))) n++;
  return String(n).padStart(3, '0');
}
// 一覧の並びを変える操作の共通部分。元に戻す履歴に積み、指定のスライドを表示・選択する。
function restructure(fn, nextIndex, pick) {
  if (!lecture || loading || saving || inline || gesture) return false;
  const before = serialize(); fn();
  if (before === serialize()) return false;
  lecture.slidesEdited = true;
  history(before); inputGroup = null; showError();
  navigate(Math.max(0, Math.min(nextIndex, lecture.slides.length - 1)));
  if (pick?.length) { picked = new Set(pick); anchor = pick[0]; renderList(); }
  focusList();
  return true;
}
function insertItems(items, at) {
  if (!items.length) return;
  const used = new Set([...lecture.slides, ...payload.lecture.slides].map(s => s.id)), added = [];
  for (const item of items) {
    const id = freeId(used); used.add(id);
    added.push(withSlideId(item.slide, id));
    if (item.origin) imports.set(id, item.origin);
    for (const [key, entry] of Object.entries(item.images)) importImages[key.replace(/^[^:]+/, id)] = entry;
  }
  if (restructure(() => { lecture.slides.splice(at, 0, ...added); }, at, added.map(s => s.id))) updateState(`${added.length}枚を挿入しました。保存すると画像・音声もコピーします`);
}
function copySlides() {
  clipboard = { from: name, items: pickedIndices().map(currentSnapshot) };
  updateState(`${clipboard.items.length}枚をコピーしました。別の講義にも貼り付けられます`);
}
function deleteSlides() {
  const list = pickedIndices();
  if (list.length >= lecture.slides.length) { showError('すべてのスライドは削除できません。1枚以上残してください。'); return false; }
  const ids = new Set(list.map(i => lecture.slides[i].id));
  return restructure(() => { lecture.slides = lecture.slides.filter(s => !ids.has(s.id)); }, list[0]);
}
function cutSlides() { copySlides(); if (deleteSlides()) updateState(`${clipboard.items.length}枚を切り取りました。貼り付ける位置を選んで Ctrl+V`); }
function pasteSlides(at = pickedIndices().at(-1) + 1) {
  if (!clipboard?.items.length) { showError('貼り付けるスライドがありません。一覧でスライドを選んで Ctrl+C でコピーしてください。'); return; }
  insertItems(clipboard.items, at);
}
function duplicateSlides() { const list = pickedIndices(); insertItems(list.map(currentSnapshot), list.at(-1) + 1); }
// to：移動先（今の並びで、何枚目の前に入れるか。末尾は枚数）。選んだスライドは並び順を保ってまとめて動かす。
function moveSlides(to) {
  const list = pickedIndices(), ids = list.map(i => lecture.slides[i].id), moving = new Set(ids);
  const before = lecture.slides.slice(0, to).filter(s => !moving.has(s.id)).length;
  restructure(() => {
    const rest = lecture.slides.filter(s => !moving.has(s.id));
    rest.splice(before, 0, ...list.map(i => lecture.slides[i]));
    lecture.slides = rest;
  }, before, ids);
}
function moveBy(step) { const list = pickedIndices(); if (step < 0 && list[0] > 0) moveSlides(list[0] - 1); else if (step > 0 && list.at(-1) < lecture.slides.length - 1) moveSlides(list.at(-1) + 2); }
$('slide-list').addEventListener('keydown', event => {
  if (!lecture || event.target.closest('.slide-item') === null) return;
  const mod = event.ctrlKey || event.metaKey;
  const commands = { KeyC: copySlides, KeyX: cutSlides, KeyV: () => pasteSlides(), KeyD: duplicateSlides };
  if (mod && commands[event.code]) commands[event.code]();
  else if (['Delete', 'Backspace'].includes(event.key)) deleteSlides();
  else if (mod && ['ArrowUp', 'ArrowDown'].includes(event.key)) moveBy(event.key === 'ArrowUp' ? -1 : 1);
  else if (['ArrowUp', 'ArrowDown'].includes(event.key)) { const next = index + (event.key === 'ArrowUp' ? -1 : 1); if (next < 0 || next >= lecture.slides.length) return; pickSlide(next, { shiftKey: event.shiftKey }); }
  else return;
  event.preventDefault(); event.stopPropagation();
});
// ドラッグで並べ替え。差し込む位置に線を出す。
let dragIds = null;
function startSlideDrag(event, id) {
  if (loading || saving || inline) { event.preventDefault(); return; }
  if (!picked.has(id)) { picked = new Set([id]); anchor = id; for (const node of $('slide-list').children) node.classList.remove('is-picked'); }
  dragIds = [...picked]; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', dragIds.join(','));
  closeSlideMenu();
}
function dropIndex(event) {
  const items = [...$('slide-list').children];
  const found = items.findIndex(node => { const r = node.getBoundingClientRect(); return event.clientY < r.top + r.height / 2; });
  return found < 0 ? items.length : found;
}
function showDrop(at) {
  const items = [...$('slide-list').children];
  items.forEach((node, i) => { node.classList.toggle('drop-before', i === at); node.classList.toggle('drop-after', at === items.length && i === items.length - 1); });
}
$('slide-list').addEventListener('dragover', event => { if (!dragIds) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; showDrop(dropIndex(event)); });
$('slide-list').addEventListener('dragleave', event => { if (!$('slide-list').contains(event.relatedTarget)) showDrop(-1); });
$('slide-list').addEventListener('drop', event => { if (!dragIds) return; event.preventDefault(); const at = dropIndex(event); showDrop(-1); picked = new Set(dragIds); dragIds = null; moveSlides(at); });
document.addEventListener('dragend', () => { if (dragIds) { dragIds = null; showDrop(-1); } });
// 右クリックメニュー。at：挿入・貼り付けの位置（何枚目の前か）。一覧の空いた所では末尾。
let menuAt = 0;
function openSlideMenu(x, y, at) {
  if (!lecture || loading) return;
  menuAt = at;
  const menu = $('slide-menu'), onSlide = at <= lecture.slides.length && picked.size > 0;
  for (const button of menu.querySelectorAll('[data-slide-action]')) {
    const action = button.dataset.slideAction;
    button.disabled = saving || (action === 'paste' && !clipboard?.items.length) || (action !== 'insert' && action !== 'paste' && !onSlide)
      || (action === 'delete' && pickedIndices().length >= lecture.slides.length)
      || (action === 'up' && pickedIndices()[0] === 0) || (action === 'down' && pickedIndices().at(-1) === lecture.slides.length - 1);
  }
  menu.querySelector('[data-slide-action="paste"] span').textContent = clipboard?.items.length ? `貼り付け（${clipboard.items.length}枚）` : '貼り付け';
  menu.hidden = false;
  menu.style.left = `${Math.min(x, innerWidth - menu.offsetWidth - 8)}px`; menu.style.top = `${Math.min(y, innerHeight - menu.offsetHeight - 8)}px`;
  menu.querySelector('button:not(:disabled)')?.focus();
}
function closeSlideMenu() { $('slide-menu').hidden = true; }
$('slide-list').addEventListener('contextmenu', event => { if (event.target.closest('.slide-item') || !lecture) return; event.preventDefault(); openSlideMenu(event.clientX, event.clientY, lecture.slides.length); });
$('slide-menu').addEventListener('click', event => {
  const action = event.target.closest('[data-slide-action]')?.dataset.slideAction; if (!action) return;
  closeSlideMenu();
  ({ insert: () => openInsert(menuAt), cut: cutSlides, copy: copySlides, paste: () => pasteSlides(menuAt), duplicate: duplicateSlides, up: () => moveBy(-1), down: () => moveBy(1), delete: deleteSlides })[action]();
});
$('slide-menu').addEventListener('keydown', event => {
  const items = [...$('slide-menu').querySelectorAll('button:not(:disabled)')], at = items.indexOf(document.activeElement);
  if (event.key === 'Escape') { closeSlideMenu(); focusList(); }
  else if (['ArrowDown', 'ArrowUp'].includes(event.key)) items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  else return;
  event.preventDefault(); event.stopPropagation();
});
document.addEventListener('pointerdown', event => { if (!$('slide-menu').hidden && !$('slide-menu').contains(event.target)) closeSlideMenu(); }, true);
window.addEventListener('blur', closeSlideMenu); $('slide-list').addEventListener('scroll', closeSlideMenu);

// 「スライドを挿入」：どの講義の・どのページを・どこに入れるかを選ぶ。
let insertSource = null, insertChosen = new Set(), insertAnchor = null, insertLoading = 0, lastInsertSource = '';
const insertBrowser = initInsertBrowser({ select: $('insert-source'), currentName: () => name });
function pagesText(set) {
  const list = [...set].sort((a, b) => a - b), parts = [];
  for (let i = 0; i < list.length; i++) { const start = list[i]; while (list[i + 1] === list[i] + 1) i++; parts.push(start === list[i] ? `${start + 1}` : `${start + 1}-${list[i] + 1}`); }
  return parts.join(', ');
}
function parsePages(text, count) {
  const set = new Set();
  for (const part of text.split(/[,、，\s]+/).filter(Boolean)) {
    const match = part.match(/^(\d+)(?:[-‐–〜~](\d+))?$/); if (!match) return null;
    const [a, b] = [Number(match[1]), Number(match[2] ?? match[1])].sort((x, y) => x - y);
    if (a < 1 || b > count) return null;
    for (let n = a; n <= b; n++) set.add(n - 1);
  }
  return set;
}
function syncInsertChoice(fromInput = false) {
  for (const card of $('insert-grid').querySelectorAll('.insert-card')) card.setAttribute('aria-selected', String(insertChosen.has(Number(card.dataset.index))));
  if (!fromInput) { $('insert-pages').value = pagesText(insertChosen); $('insert-pages').setAttribute('aria-invalid', 'false'); $('insert-page-error').hidden = true; }
  $('insert-count').textContent = insertSource ? `${insertSource.lecture.slides.length}枚中 ${insertChosen.size}枚を選択` : '';
  $('insert-confirm').disabled = !insertSource || !insertChosen.size || $('insert-pages').getAttribute('aria-invalid') === 'true';
  for (const id of ['insert-pages', 'insert-all', 'insert-none']) $(id).disabled = !insertSource;
  $('insert-confirm').textContent = insertChosen.size ? `${insertChosen.size}枚を挿入` : '挿入する';
}
function fillInsertPositions(at) {
  const select = $('insert-position'); select.replaceChildren();
  const option = (value, text) => { const node = document.createElement('option'); node.value = value; node.textContent = text; select.append(node); };
  option(0, '先頭（1枚目の前）');
  lecture.slides.forEach((s, i) => option(i + 1, `${i + 1}枚目の後ろ — ${plainText(s.title).slice(0, 24)}`));
  select.value = String(Math.max(0, Math.min(at, lecture.slides.length)));
}
function insertPreviewDeck() {
  return { ...insertSource.lecture, theme: lecture.theme, category: lecture.category, motion: lecture.motion, brand: lecture.brand, number: lecture.number,
    slides: insertSource.lecture.slides.map(s => withInsertedAppearance(s, insertSource.lecture, $('insert-design-source').checked)) };
}
function refreshInsertPreview() {
  if (!insertSource) return;
  const deck = insertPreviewDeck();
  for (const card of $('insert-grid').querySelectorAll('.insert-card')) card.querySelector('.slide-mini').replaceWith(miniSlide(deck, Number(card.dataset.index), insertSource.images));
  resizeThumbnails();
}
async function loadInsertSource(sourceName) {
  const op = ++insertLoading; insertSource = null; insertChosen = new Set(); insertAnchor = null;
  $('insert-grid').replaceChildren(); syncInsertChoice();
  $('insert-grid').setAttribute('aria-busy', 'true');
  $('insert-source-title').textContent = $('insert-source').selectedOptions[0]?.textContent ?? 'スライド';
  $('insert-count').textContent = '読み込み中…';
  const status = document.createElement('p'); status.className = 'browser-empty'; status.textContent = 'スライドを読み込み中…'; $('insert-grid').append(status);
  insertBrowser.sync();
  try {
    if (sourceName === name) insertSource = { name, lecture, images: images(), saved: payload.lecture };
    else {
      const response = await fetch(`/api/lecture?name=${encodeURIComponent(sourceName)}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '講義を読み込めません。');
      if (op !== insertLoading) return;
      insertSource = { name: sourceName, lecture: data.lecture, images: data.images, saved: data.lecture };
    }
    lastInsertSource = sourceName;
    $('insert-grid').replaceChildren();
    $('insert-source-title').textContent = insertSource.lecture.title;
    const previewDeck = insertPreviewDeck();
    insertSource.lecture.slides.forEach((s, i) => {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'insert-card'; card.dataset.index = i; card.setAttribute('role', 'option');
      card.setAttribute('aria-label', `${i + 1}枚目 ${plainText(s.title)}`);
      const caption = document.createElement('span'); caption.className = 'insert-caption';
      const number = document.createElement('strong'); number.textContent = String(i + 1).padStart(2, '0');
      const title = document.createElement('span'); title.textContent = `${labels[s.layout]} · ${plainText(s.title)}`;
      caption.append(number, title); card.append(miniSlide(previewDeck, i, insertSource.images), caption);
      card.addEventListener('click', event => {
        if (event.detail > 1) return;
        if (event.shiftKey && insertAnchor !== null) { const [a, b] = [insertAnchor, i].sort((x, y) => x - y); for (let n = a; n <= b; n++) insertChosen.add(n); }
        else { if (insertChosen.has(i)) insertChosen.delete(i); else insertChosen.add(i); insertAnchor = i; }
        syncInsertChoice();
      });
      $('insert-grid').append(card);
    });
    syncInsertChoice(); resizeThumbnails();
  } catch (error) {
    if (op === insertLoading) {
      insertSource = null; syncInsertChoice(); $('insert-count').textContent = '読み込み失敗';
      const message = document.createElement('p'); message.className = 'browser-empty'; message.textContent = error.message;
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'もう一度読み込む'; retry.addEventListener('click', () => loadInsertSource(sourceName));
      message.append(document.createElement('br'), retry); $('insert-grid').replaceChildren(message);
    }
  } finally { if (op === insertLoading) $('insert-grid').setAttribute('aria-busy', 'false'); }
}
async function openInsert(at = index + 1) {
  if (!lecture || loading || saving || inline) return;
  closeSlideMenu(); fillInsertPositions(at);
  $('insert-design-source').checked = true;
  try { await loadLectureOptions($('insert-source')); } catch { /* 一覧を読めない場合も、この講義から選べる。 */ }
  if (![...$('insert-source').options].some(o => o.value === name)) { const own = document.createElement('option'); own.value = name; own.textContent = lecture.title; $('insert-source').prepend(own); }
  for (const option of $('insert-source').options) option.textContent = option.textContent.replace(/（編集中）$/, '') + (option.value === name ? '（編集中）' : '');
  $('insert-source').value = [...$('insert-source').options].some(o => o.value === lastInsertSource) ? lastInsertSource : name;
  $('insert-dialog').showModal();
  await Promise.all([insertBrowser.open(), loadInsertSource($('insert-source').value)]);
  if ($('insert-dialog').open) $('insert-search').focus();
}
function confirmInsert() {
  if (!insertSource || !insertChosen.size || $('insert-confirm').disabled) return;
  const at = Number($('insert-position').value), source = insertSource;
  const items = [...insertChosen].sort((a, b) => a - b).map(i => {
    const item = snapshotOf(source.name, source.lecture, source.images, i, source.saved);
    item.slide = withInsertedAppearance(item.slide, source.lecture, $('insert-design-source').checked);
    return item;
  });
  $('insert-dialog').close();
  insertItems(items, at);
}
$('slide-insert').addEventListener('click', () => openInsert(pickedIndices().at(-1) + 1));
$('insert-source').addEventListener('change', event => loadInsertSource(event.target.value));
for (const id of ['insert-design-destination', 'insert-design-source']) $(id).addEventListener('change', refreshInsertPreview);
$('insert-pages').addEventListener('input', event => {
  if (!insertSource) return;
  const set = parsePages(event.target.value, insertSource.lecture.slides.length);
  $('insert-pages').setAttribute('aria-invalid', String(!set));
  $('insert-page-error').hidden = !!set;
  if (set) { insertChosen = set; syncInsertChoice(true); }
  else $('insert-confirm').disabled = true;
});
$('insert-pages').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); confirmInsert(); } });
$('insert-all').addEventListener('click', () => { if (insertSource) { insertChosen = new Set(insertSource.lecture.slides.map((_, i) => i)); syncInsertChoice(); } });
$('insert-none').addEventListener('click', () => { insertChosen = new Set(); syncInsertChoice(); });
$('insert-confirm').addEventListener('click', confirmInsert);
for (const id of ['insert-cancel', 'insert-close']) $(id).addEventListener('click', () => $('insert-dialog').close());
$('insert-dialog').addEventListener('close', () => { insertLoading++; insertSource = null; insertChosen.clear(); $('insert-grid').replaceChildren(); focusList(); });
$('insert-grid').addEventListener('keydown', event => {
  const cards = [...$('insert-grid').querySelectorAll('.insert-card')], at = cards.indexOf(document.activeElement);
  if (at < 0) return;
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyA') { event.preventDefault(); $('insert-all').click(); return; }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const columns = getComputedStyle($('insert-grid')).gridTemplateColumns.split(' ').length;
  const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key] ?? 0;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : Math.max(0, Math.min(cards.length - 1, at + delta));
  cards[next]?.focus();
  if (event.shiftKey) cards[next]?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
});
new ResizeObserver(resizeThumbnails).observe($('insert-grid'));

document.addEventListener('keydown', event => {
  if (!lecture || event.defaultPrevented || event.isComposing) return;
  if (document.querySelector('dialog[open]')) return;
  const typing = event.target.matches('input,textarea,select') || event.target.isContentEditable;
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') { event.preventDefault(); void save(); return; }
  if (event.key === 'Escape' && document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape' && !$('canvas-tip').hidden) { hideTip(); return; }
  if (event.key === 'Escape') { if (gesture) finishGesture(true); if (inline) { inline.cancel = true; inline.target.blur(); } else select(''); return; }
  if (typing) return;
  if ((event.ctrlKey || event.metaKey) && ['KeyZ', 'KeyY'].includes(event.code)) { event.preventDefault(); undo(event.shiftKey || event.code === 'KeyY'); return; }
  if (['Delete', 'Backspace'].includes(event.key) && selected) { event.preventDefault(); removeSelectedElement(); return; }
  if (selected && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) {
    event.preventDefault(); const delta = event.shiftKey ? 8 : 1;
    mutate(() => { const p = geometry(); const key = ['ArrowLeft', 'ArrowRight'].includes(event.code) ? 'x' : 'y'; const sign = ['ArrowLeft', 'ArrowUp'].includes(event.code) ? -1 : 1; setGeometry(key, fitRange(key, (p[key] ?? 0) + sign * delta)); }); updateGeometryInputs();
  }
});
window.addEventListener('beforeunload', event => { if (dirty() || activeJob?.state === 'running') { event.preventDefault(); event.returnValue = ''; } });
// ヘッダーの「︙」（その他の操作）：外側のクリック・Esc・項目を選んだときに閉じる。
const moreMenu = $('header-more');
document.addEventListener('click', event => { if (moreMenu.open && !moreMenu.contains(event.target)) moreMenu.open = false; });
moreMenu.addEventListener('keydown', event => { if (event.key === 'Escape') { moreMenu.open = false; moreMenu.querySelector('summary').focus(); } });
for (const item of moreMenu.querySelectorAll('[role=menuitem]')) item.addEventListener('click', () => { moreMenu.open = false; });
// LLMにおまかせで作ったデザイン（講義のCSS）を、デザインテンプレートとして「デザイン」画面に登録する（npm run design:save と同じ）。
function syncTemplateItem() { $('save-template').hidden = !lecture?.theme?.css; }
$('save-template').addEventListener('click', () => {
  if (!lecture?.theme?.css) return;
  $('template-name').value = ''; $('template-description').value = `講義「${plainText(lecture.title)}」で作ったデザイン`;
  $('template-status').textContent = ''; $('template-status').classList.remove('is-done'); $('template-save').disabled = false;
  $('template-dialog').showModal(); $('template-name').focus();
});
$('template-cancel').addEventListener('click', () => $('template-dialog').close());
$('template-save').addEventListener('click', async () => {
  const name = $('template-name').value.trim();
  if (!name) { $('template-status').textContent = 'テンプレート名を入力してください。'; $('template-name').focus(); return; }
  $('template-save').disabled = true; $('template-status').textContent = '';
  try {
    const response = await fetch('/api/designs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Editor': '1' }, body: JSON.stringify({ op: 'create', design: { ...standardDesign(), name, description: $('template-description').value.trim(), css: lecture.theme.css } }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'テンプレートを保存できませんでした。');
    $('template-status').classList.add('is-done'); $('template-status').textContent = `「${result.design.name}」を保存しました。「デザイン」画面の一覧に表示されます。`;
    setTimeout(() => { if ($('template-dialog').open) $('template-dialog').close(); }, 1800);
  } catch (error) { $('template-status').textContent = error.message; $('template-save').disabled = false; }
});
$('download').addEventListener('click', () => {
  if (!lecture) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(lecture, null, 2) + '\n'], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `${name}-edited.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('lecture-select').addEventListener('change', event => {
  const next = event.target.value; if (next === name) return;
  if (dirty()) { pendingLecture = next; $('lecture-select').value = name; $('leave-dialog').showModal(); }
  else void load(next);
});
$('leave-cancel').addEventListener('click', () => { pendingLecture = null; $('leave-dialog').close(); });
$('leave-discard').addEventListener('click', () => { const next = pendingLecture; pendingLecture = null; $('leave-dialog').close(); if (next) void load(next); });
$('leave-save').addEventListener('click', async () => { const next = pendingLecture; $('leave-save').disabled = true; try { if (await save()) { pendingLecture = null; $('leave-dialog').close(); if (next) await load(next); } else $('leave-dialog').close(); } finally { $('leave-save').disabled = false; } });

async function ttsRequest(path, body) {
  const response = await fetch(`/api/tts/${path}?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Editor': '1' }, body: JSON.stringify(body) });
  let result;
  try { result = await response.json(); } catch { throw new Error('音声生成の機能を読み込めません。スタジオのサーバーを再起動してください。'); }
  if (!response.ok) throw new Error(result.error || '音声生成の操作に失敗しました。');
  return result;
}
$('tts-prepare').addEventListener('click', async () => {
  if (!lecture || ttsPreparing || activeJob?.state === 'running') return;
  const slideId = slide().id, scope = $('tts-scope').value;
  ttsPreparing = true; updateState(); showError(); approvedTts = null;
  try {
    if (!await save()) return;
    if (dirty()) throw new Error('確認中に原稿が変更されました。もう一度、音声の生成内容を確認してください。');
    const plan = await ttsRequest('plan', { revision, scope, slideId });
    approvedTts = { ...plan, name };
    $('tts-plan-summary').textContent = plan.count ? `${plan.count}枚・${plan.characters.toLocaleString()}文字の音声を生成します。` : '対象の音声はすべて最新です。再生成は不要です。';
    $('tts-plan-slides').replaceChildren();
    for (const item of plan.slides) { const li = document.createElement('li'); li.textContent = `スライド ${item.page}：${item.characters.toLocaleString()}文字`; $('tts-plan-slides').append(li); }
    $('tts-plan-note').textContent = plan.empty.length ? `原稿が空欄のスライドがあります（${plan.empty.join('、')}）。入力してから再度確認してください。` : `声：${plan.voice}。確認した原稿だけを生成します。`;
    $('tts-start').disabled = !plan.count || !!plan.empty.length;
    $('tts-dialog').showModal();
  } catch (error) { showError(error.message); }
  finally { ttsPreparing = false; updateState(); }
});
$('tts-cancel').addEventListener('click', () => { approvedTts = null; $('tts-dialog').close(); });
$('tts-start').addEventListener('click', async () => {
  if (!approvedTts || approvedTts.name !== name || ttsPreparing) return;
  if (dirty() || revision !== approvedTts.revision) { $('tts-dialog').close(); showError('原稿が変更されています。もう一度、生成内容を確認してください。'); return; }
  ttsPreparing = true; $('tts-start').disabled = true; updateState(); media.pause();
  try {
    activeJob = await ttsRequest('start', { token: approvedTts.token, revision: approvedTts.revision });
    approvedTts = null; $('tts-dialog').close(); updateState();
    await trackTtsJob(activeJob);
  } catch (error) { showError(error.message); $('tts-dialog').close(); }
  finally { ttsPreparing = false; updateState(); }
});
async function resumeTts(lectureName) {
  try {
    const response = await fetch(`/api/tts/job?name=${encodeURIComponent(lectureName)}`);
    if (!response.ok) return;
    const result = await response.json();
    if (lectureName !== name || result.job?.state !== 'running') return;
    activeJob = result.job; updateState(); await trackTtsJob(activeJob);
  } catch { /* 読み込み済みの講義はそのまま編集可能。 */ }
}
async function trackTtsJob(job) {
  if (!job || job.name !== name || activeJob?.id !== job.id) return;
  activeJob = job;
  if (job.state === 'running') {
    $('tts-progress').textContent = `音声を生成中… ${job.completed} / ${job.count}枚`;
    clearTimeout(jobTimer);
    jobTimer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/tts/job?name=${encodeURIComponent(job.name)}&id=${encodeURIComponent(job.id)}`);
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!result.job) { activeJob = null; updateState(); showError('生成状況を確認できません。サーバーの状態を確認してから画面を再読み込みしてください。'); return; }
        await trackTtsJob(result.job);
      } catch {
        if (activeJob?.id !== job.id) return;
        $('tts-progress').textContent = '生成状況を確認しています…';
        jobTimer = setTimeout(() => { void trackTtsJob(job); }, 2000);
      }
    }, 1000);
    return;
  }
  $('tts-progress').textContent = job.state === 'completed' ? '音声を更新しました。試聴して確認できます。' : `${job.completed}枚生成済み。音声の生成を停止しました。`;
  try {
    const response = await fetch(`/api/lecture?name=${encodeURIComponent(name)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const data = await response.json();
    payload.lecture = data.lecture; payload.audio = data.audio; payload.images = data.images;
    time = 0; refreshMedia(); renderCanvas(); renderList();
    const warnings = [...(job.warnings ?? [])];
    if (revision !== data.revision) warnings.push('別の画面で講義が変更されています。編集データを控えてから再読み込みしてください。');
    if (job.error) warnings.unshift(job.error);
    if (warnings.length) showError(warnings.join('\n'));
  } catch { showError(job.error || '音声の状態を読み込めません。再読み込みして確認してください。'); }
  finally { activeJob = null; updateState(); }
}

window.addEventListener('focus', () => { if (!loading) { void loadLectureOptions($('lecture-select')).catch(() => {}); void lectureBrowser.refresh(); void loadCategories(); } });

const featureBusy = () => loading || saving || ttsPreparing || activeJob?.state === 'running';
animationEditor = initEditorAnimation({
  current: () => ({ slide: lecture ? slide() : null, selected }),
  change: fn => { stopSilentMotion(); mutate(fn); renderProperties(); },
  preview: () => {
    if (!lecture || featureBusy()) return;
    if (silentMotion) { stopSilentMotion(); return; }
    media.pause(); time = 0; $('cue-preview').checked = true; renderCanvas();
    silentMotion = { start: performance.now() }; $('animation-preview').textContent = '動きの確認を止める';
  },
});
imageEditor = initEditorImages({
  current: () => {const block=lecture&&slide().layout==='document'&&currentBlock()?.image?currentBlock():null;return {lecture,name,slide:lecture?slide():null,blockId:block?.id,image:block?.image,entry:lecture?images()[block?`${slide().id}:${block.id}`:slide().id]:null,busy:featureBusy()};},
  commit: (context, image, entry) => {
    if (context.name !== name || context.slideId !== slide().id || featureBusy()) throw new Error('編集するページが変わりました。開き直してください。');
    if(slide().layout==='document') {
      let id=context.blockId;
      if(id&&!slide().blocks.some(b=>b.id===id))throw new Error('編集する画像が見つかりません。');
      if(!id){let n=1;while(slide().blocks.some(b=>b.id==='image'+n))n++;id='image'+n;}
      rememberImages(name,{[`${slide().id}:${id}`]:entry});
      mutate(()=>{
        const block=slide().blocks.find(b=>b.id===id);
        if(block)block.image=image;
        else {slide().blocks.push({id,text:image.alt,image});slide().cues.push({at:0,target:id});slide().cues.sort((a,b)=>a.at-b.at);slide().document.tree.children??=[];slide().document.tree.children.push({tag:'img',class:'mascot',style:'position:absolute;left:550px;top:270px;width:180px;height:180px;object-fit:contain',image:id});}
      });select(`block:${id}`);
    }else{
      rememberImages(name, { [slide().id]: entry });
      mutate(() => { slide().image = image; }); select('image');
    }
    updateState('画像を適用しました。保存すると講義に反映されます');
  },
});
initEditorHistory({
  current: () => ({ lecture, name, index, images: lecture ? images() : {}, busy: featureBusy() }),
  miniature: miniSlide,
  restore: (snapshot, slideId) => {
    const before = serialize(), activeId = slide().id;
    rememberAssetState(before);
    lecture = restoreLectureVersion(lecture, snapshot.lecture, slideId);
    rememberImages(name, snapshot.images); history(before); inputGroup = null;
    if (slideId) imports.delete(slideId); else { imports.clear(); importImages = {}; }
    rememberAssetState(serialize());
    navigate(Math.max(0, lecture.slides.findIndex(s => s.id === activeId)));
    updateState('履歴を読み込みました。「保存する」で確定します');
  },
});

// ブラウザQA用。生成APIや秘密情報は扱わない。
window.slideEditor = { get lecture() { return lecture; }, get selected() { return selected; }, get dirty() { return dirty(); }, get index() { return index; }, navigate, select, save };
try {
  await loadCategories();
  const list = await loadLectureOptions($('lecture-select'));
  const requested = new URLSearchParams(location.search).get('lecture');
  const first = list.find(item => item.name === requested)?.name ?? list[0]?.name;
  if (!first) throw new Error('編集できる講義がありません。');
  await load(first);
} catch (error) { showError(error.message); }
