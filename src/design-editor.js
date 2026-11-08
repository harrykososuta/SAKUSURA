import { DESIGN_SAMPLES, validDesignCategory, validDesignLayout } from './design-catalog.js';
import { DESIGN_FONTS, DESIGN_NUMBER_FIELDS, STANDARD_DESIGN_ID, readDesign, validateDesign, getDesignValue, setDesignValue, designCategories, designCategoryKey, designDeck } from './design-theme.js';
import { createPdfReference } from './design-pdf.js';
import { createDesignImport } from './design-import.js';
import { createPresetControls, createAiCustomization } from './design-customize.js';
import { createPdfPageEditor } from './pdf-design.js';
import { createDesignWorkspace } from './design-workspace.js';
import { wireDesignMotionControls } from './design-motion-controls.js';

const $ = id => document.getElementById(id), params = new URLSearchParams(location.search);
const editing = location.pathname === '/design/edit';
// 新規追加はPDFから。複製と既存のAI調整依頼だけ、明示されたデザインを開く。
const pdfImportMode = !editing && (params.get('source') === 'pdf' || (!params.has('base') && !params.has('aiTask')));
const pdfPresetReady = !pdfImportMode;
if (pdfImportMode) document.body.classList.add('pdf-import-mode');
let pdfImport;
let presetControls, aiCustomize, pdfPageEditor, aiLocked = false, previewSlot = null;
let draft, entry, dirty = false, saving = false, category = validDesignCategory(params.get('category')), layout = validDesignLayout(params.get('layout'));
let queued = false;
let initialName = '';
let studioWorkspace;
const frame = $('theme-preview-frame');
wireDesignMotionControls(frame);
const error = message => { $('editor-error').textContent = message; $('editor-error').hidden = !message; };
const pdfReference = createPdfReference({
  canPreviewSlide: () => pdfPresetReady,
  onChange(metadata) {
    if (!editing && metadata && draft?.name === initialName) { draft.name = metadata.name.replace(/\.pdf$/i, '').slice(0, 60); $('design-name').value = draft.name; }
    change();
    pdfImport?.updateButton();
  },
  onBusy() { if (pdfImport) pdfImport.updateButton(); else if (draft) $('save-design').disabled = aiLocked || saving || pdfReference.busy || !!validateDesign(draft).length; aiCustomize?.update(); },
});

function numberField([path, label, min, max]) {
  const wrapper = document.createElement('label'); wrapper.append(label);
  const input = document.createElement('input'); input.type = 'number'; input.min = min; input.max = max; input.step = '1'; input.required = true;
  input.dataset.path = path; input.value = getDesignValue(draft.settings, path); input.setAttribute('aria-label', label);
  const hint = document.createElement('small'); hint.textContent = `${min}〜${max}px`;
  wrapper.append(input, hint); return wrapper;
}
function colorField(path, label) {
  const row = document.createElement('div'); row.className = 'theme-color-row';
  const name = document.createElement('span'); name.textContent = label; row.append(name);
  for (const type of ['color', 'text']) {
    const input = document.createElement('input'); input.type = type; input.value = getDesignValue(draft.settings, path); input.dataset.colorPath = path;
    input.setAttribute('aria-label', `${label}${type === 'text' ? 'のカラーコード' : 'の色'}`);
    if (type === 'text') { input.maxLength = 7; input.pattern = '#[a-fA-F0-9]{6}'; input.required = true; input.spellcheck = false; }
    row.append(input);
  }
  return row;
}
function categoryFields() {
  $('category-color-heading').textContent = `${designCategories(draft)[category].name}の線と図形`;
  $('category-color-fields').replaceChildren(...[['primary', '主色'], ['accent', '差し色'], ['soft', '淡い色'], ['marker', 'マーカー']].map(([key, name]) => colorField(`categories.${category}.${key}`, name)));
}
function syncCategories() {
  category = designCategoryKey(draft, category);
  $('preview-category').replaceChildren(...Object.entries(designCategories(draft)).map(([id, item]) => { const node = document.createElement('option'); node.value = id; node.textContent = item.name; return node; }));
  $('preview-category').value = category; categoryFields(); presetControls?.refreshCategories();
}
function selectCategory(value, open = true) {
  category = designCategoryKey(draft, value); syncCategories();
  const url = new URL(location.href); url.searchParams.set('category', category); history.replaceState(null, '', url);
  if (open) openPreview();
}
function previewSlotAt(index) {
  studioWorkspace?.clearSelection();
  previewSlot = index; layout = designDeck(draft).slides[index].layout;
  if (draft.pdfSource) $('pdf-native-preview-page').value = index;
  $('preview-layout').value = layout; layoutFields(); openPreview();
}
function configurePdfPreview() {
  if (!draft.pdfSource) return;
  document.body.classList.add('pdf-source-editor'); $('pdf-native-preview-control').hidden = false;
  $('pdf-native-preview-page').replaceChildren(...draft.pdfSource.pages.map((page, index) => { const option = document.createElement('option'); option.value = index; option.textContent = `${index + 1}. ${page.label}`; return option; }));
  previewSlot ??= 0; layout = draft.pdfSource.pages[previewSlot]?.layout ?? draft.pdfSource.pages[0].layout;
  $('pdf-native-preview-page').value = previewSlot;
  $('remove-reference').hidden = true; $('reference-pdf-input').closest('label').hidden = true;
  $('pdf-reference-section').querySelector('h2').textContent = 'デザインの原本PDF';
  $('reference-upload-hint').textContent = 'このPDFの配置と図版を保持しています。別のPDFを使う場合は「PDFから追加」で作成できます。';
  if (!pdfImportMode) $('editor-lead').textContent = '元PDFの文字・位置・サイズと、ページの並びを調整できます。';
  document.querySelector('.theme-preview-note').textContent = '元PDFのページを原本のデザインで表示します。カテゴリによって色や配置は変わりません。';
}
$('pdf-native-preview-page').addEventListener('change', event => { const index = Number(event.target.value); if (pdfPageEditor) pdfPageEditor.select(index); else previewSlotAt(index); });
function layoutFields() {
  const sample = DESIGN_SAMPLES.find(item => item.layout === layout);
  $('layout-settings-heading').textContent = `${sample.name}の設定`;
  const fields = DESIGN_NUMBER_FIELDS.filter(item => item[4] === layout);
  $('layout-setting-fields').replaceChildren(...fields.map(numberField));
  $('layout-setting-note').textContent = fields.length ? 'このレイアウトだけに反映される設定です。' : '文字の大きさと余白は、上の共通設定で調整できます。';
}
function refreshPreview() {
  if (!pdfPresetReady || !draft || validateDesign(draft).length) return;
  frame.contentWindow?.postMessage({ type: 'sakusura:design-draft', design: structuredClone(draft) }, location.origin);
}
function change() {
  dirty = true;
  const errors = validateDesign(draft);
  error(errors[0] || '');
  $('save-design').disabled = aiLocked || saving || pdfReference.busy || !!errors.length;
  pdfImport?.updateButton();
  aiCustomize?.update();
  if (!pdfImportMode) $('draft-state').textContent = '未保存';
  if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; refreshPreview(); if (!validateDesign(draft).length) studioWorkspace?.syncPages(); }); }
}
function openPreview() {
  if (!pdfPresetReady) {
    frame.removeAttribute('src');
    document.body.dataset.previewReady = 'true';
    return;
  }
  document.body.dataset.previewReady = 'false';
  frame.style.visibility = 'hidden';
  $('preview-state').textContent = '見本を更新しています…';
  frame.src = `/design/preview?category=${category}&layout=${layout}${previewSlot !== null ? `&slot=${previewSlot}` : ''}`;
}

window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.category !== category || event.data?.layout !== layout) return;
  if (event.data.type === 'sakusura:design-ready') refreshPreview();
  if (event.data.type === 'sakusura:design-updated') {
    frame.style.visibility = 'visible';
    $('preview-state').textContent = `${designCategories(draft)[category].name} / ${DESIGN_SAMPLES.find(item => item.layout === layout).name}`;
    document.body.dataset.previewReady = 'true';
    studioWorkspace?.syncPages();
    studioWorkspace?.connectPreview().catch(failure => error(failure.message));
    if (draft.pdfSource) {
      const replacements = [...frame.contentDocument.querySelectorAll('.pdf-text-replacement')];
      $('pdf-fit-status').textContent = replacements.some(node => node.dataset.fitError === 'true') ? '枠に収まらない文字があります。文章を短くするか、幅・サイズを調整してください。' : replacements.some(node => node.dataset.fitSize) ? '変更した文字は元の枠に収まるサイズで表示しています。' : '';
    }
  }
});
$('theme-form').addEventListener('input', event => {
  const input = event.target;
  if (input.dataset.meta) draft[input.dataset.meta] = input.value;
  else if (input.dataset.path) setDesignValue(draft.settings, input.dataset.path, input.value === '' ? NaN : Number(input.value));
  else if (input.dataset.colorPath) {
    setDesignValue(draft.settings, input.dataset.colorPath, input.value);
    if (/^#[a-fA-F0-9]{6}$/.test(input.value)) for (const pair of $('theme-form').querySelectorAll('[data-color-path]')) if (pair !== input && pair.dataset.colorPath === input.dataset.colorPath) pair.value = input.value;
  } else if (input.dataset.setting === 'font') draft.settings.font = input.value;
  else return;
  change();
});
$('preview-category').addEventListener('change', event => selectCategory(event.target.value));
$('preview-layout').addEventListener('change', event => { previewSlot = null; studioWorkspace?.clearSelection(); layout = validDesignLayout(event.target.value); layoutFields(); openPreview(); });
$('theme-form').addEventListener('submit', async event => {
  event.preventDefault(); if (pdfImportMode || aiLocked || !draft || saving || pdfReference.busy) return;
  const errors = validateDesign(draft);
  if (errors.length) { error(errors[0]); return; }
  if (!$('theme-form').reportValidity()) return;
  saving = true; $('save-design').disabled = true; $('theme-fields').disabled = true; $('draft-state').textContent = '保存中…'; error('');
  try {
    const body = { op: editing ? 'update' : 'create', design: structuredClone(draft), referencePdfId: pdfReference.id, ...(editing ? { id: entry.id, revision: entry.revision } : {}) };
    const response = await fetch('/api/designs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Editor': '1' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '保存できません。もう一度お試しください。');
    dirty = false;
    location.assign(`/design/detail?theme=${encodeURIComponent(result.id)}&category=${category}&layout=${layout}${previewSlot !== null ? `&slot=${previewSlot}` : ''}`);
  } catch (failure) { error(failure.message); $('draft-state').textContent = '未保存'; saving = false; $('theme-fields').disabled = false; $('save-design').disabled = false; }
});
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });

async function load() {
  entry = await readDesign(pdfImportMode ? STANDARD_DESIGN_ID : (editing ? params.get('theme') : params.get('base')) || STANDARD_DESIGN_ID);
  if (editing && entry.builtin) throw new Error('標準デザインは、詳細画面の「複製して編集」から複製してください。');
  draft = structuredClone(entry.design);
  await pdfReference.restore(entry.referencePdfId);
  if (pdfImportMode) {
    draft.name = '新しいプリセット'; draft.brand = 'SLIDES'; draft.description = '';
  } else if (!editing) {
    const response = await fetch('/api/designs?includeTrash=1', { cache: 'no-store' }), result = await response.json();
    if (!response.ok) throw new Error(result.error || 'デザイン一覧を読み込めません。');
    const baseName = `${draft.name.slice(0, 46)} のコピー`;
    draft.name = baseName;
    for (let i = 2; result.designs.some(item => item.design.name === draft.name); i++) draft.name = `${baseName} (${i})`;
  } else {
    $('editor-title').textContent = 'デザインを編集'; $('save-design').textContent = '変更を保存';
    $('editor-lead').textContent = '見本を確認しながら、色・文字・余白を調整できます。';
    $('editor-cancel').href = `/design/detail?theme=${encodeURIComponent(entry.id)}`;
    document.title = `デザインを編集 | ${draft.name} | SAKUSURA`;
  }
  let resumed = null;
  if (!pdfImportMode && params.has('aiTask')) {
    const response = await fetch(`/api/design-imports?id=${encodeURIComponent(params.get('aiTask'))}`, { cache: 'no-store' });
    resumed = await response.json();
    if (!response.ok) throw new Error(resumed.error || '依頼を再開できません。');
    if (resumed.kind !== 'customize' || validateDesign(resumed.snapshot).length) throw new Error('調整依頼の保存情報を確認してください。');
    if (resumed.status === 'complete') { location.replace(`/design/edit?theme=${encodeURIComponent(resumed.entry.id)}&category=${encodeURIComponent(params.get('category') || 'standard')}`); return; }
    draft = structuredClone(resumed.snapshot);
    await pdfReference.restore(resumed.referencePdfId);
  }
  if (pdfImportMode) {
    $('editor-title').textContent = 'PDFからデザインを追加';
    $('editor-lead').textContent = 'PDFを追加すると、そのページの文字・位置・サイズを編集できます。';
    document.title = 'PDFからデザインを追加 | SAKUSURA';
  }
  initialName = draft.name;
  $('base-design-name').textContent = entry.design.name;
  $('design-name').value = draft.name; $('design-description').value = draft.description; $('design-brand').value = draft.brand;
  for (const [value, font] of Object.entries(DESIGN_FONTS)) { const option = document.createElement('option'); option.value = value; option.textContent = font.name; $('design-font').append(option); }
  $('design-font').value = draft.settings.font;
  $('common-color-fields').replaceChildren(...[['paper', '背景'], ['textStrong', '見出し・重要語'], ['text', '本文'], ['textMeta', '補足'], ['rule', '罫線']].map(([key, name]) => colorField(`colors.${key}`, name)));
  $('typography-fields').replaceChildren(...DESIGN_NUMBER_FIELDS.filter(item => item[0].startsWith('typography.')).map(numberField));
  $('spacing-fields').replaceChildren(...DESIGN_NUMBER_FIELDS.filter(item => item[0].startsWith('spacing.')).map(numberField));
  for (const sample of DESIGN_SAMPLES) { const option = document.createElement('option'); option.value = sample.layout; option.textContent = sample.name; $('preview-layout').append(option); }
  category = designCategoryKey(draft, params.get('category'));
  syncCategories();
  $('preview-layout').value = layout; $('preview-category').value = category;
  categoryFields(); layoutFields(); $('theme-fields').disabled = false; $('save-design').disabled = false;
  $('draft-state').textContent = editing ? '保存済み' : '新しいデザイン'; document.body.dataset.ready = 'true';
  const requestedSlot = /^\d+$/.test(params.get('slot') ?? '') && designDeck(draft).slides[Number(params.get('slot'))] ? Number(params.get('slot')) : null;
  if (editing) $('editor-cancel').href = `/design/detail?theme=${encodeURIComponent(entry.id)}&category=${category}&layout=${layout}${requestedSlot !== null ? `&slot=${requestedSlot}` : ''}`;
  if (!draft.pdfSource) {
    const slots = designDeck(draft).slides;
    previewSlot = requestedSlot ?? (params.has('layout') ? Math.max(0, slots.findIndex(slot => slot.layout === layout)) : 0);
    layout = slots[previewSlot].layout; $('preview-layout').value = layout; layoutFields();
  }
  configurePdfPreview();
  if (pdfImportMode) {
    pdfImport = createDesignImport({ pdfReference, getDraft: () => structuredClone(draft), onSaved: () => { dirty = false; }, onComplete(result) {
      dirty = false;
      location.replace(`/design/edit?theme=${encodeURIComponent(result.id)}&category=${encodeURIComponent(category)}`);
    } });
    pdfImport.updateButton();
    if (params.has('task')) await pdfImport.restore(params.get('task'));
    document.querySelector('.theme-preview-note').textContent = '取り込みが終わると、元PDFのデザインをここで確認できます。';
  } else {
    presetControls = createPresetControls({ getDraft: () => draft, getCategory: () => category, setCategory: selectCategory, onChange: change, onPreviewSlot: previewSlotAt });
    if (draft.pdfSource) pdfPageEditor = await createPdfPageEditor({ getDraft: () => draft, onChange: change, onTextSelect: id => studioWorkspace?.selectPdf(id), onPreviewSlot: index => { configurePdfPreview(); previewSlotAt(index); } });
    if (draft.pdfSource && requestedSlot !== null) pdfPageEditor?.select(requestedSlot);
    $('ai-instructions').addEventListener('input', event => { draft.aiInstructions = event.target.value; change(); });
    aiCustomize = createAiCustomization({ getDraft: () => draft, pdfReference, resumed, saved: () => { dirty = false; }, lock(value) {
      aiLocked = value; $('theme-fields').disabled = value; $('customization-fields').disabled = value; $('ai-instructions').disabled = value;
      studioWorkspace?.setLocked(value);
      $('pdf-source-fields').disabled = value;
      $('save-design').disabled = value || !!validateDesign(draft).length || pdfReference.busy;
      $('draft-state').textContent = value ? 'AI依頼の完了待ち' : '未保存';
      if (!value) change();
    } });
    if (params.get('section') === 'categories') { $('category-editor-section').scrollIntoView({ block: 'center' }); $('new-category-name').focus(); }
    if (params.get('section') === 'ai') $('ai-customize').scrollIntoView({ block: 'start' });
  }
  openPreview();
}
if (!pdfImportMode) studioWorkspace = createDesignWorkspace({ getDraft: () => draft, getCategory: () => category, getLayout: () => layout, getSlot: () => previewSlot,
  selectPage: index => draft.pdfSource ? pdfPageEditor?.select(index) : previewSlotAt(index), change, selectPdfText: id => pdfPageEditor?.selectText(id) });
load().catch(failure => error(failure.message || 'デザインを読み込めません。'));
