import { designDeck, designCategories, applyDesignTheme, validateDesign } from './design-theme.js';
import { COMPOSITIONS } from './design-compositions.js';
import { DESIGN_SAMPLES, designImages } from './design-catalog.js';
import { renderSlide } from './slide-view.js';
import { applyMotion } from './motion.js';
import { makeDesignSample } from './design-sample.js';
import { designTextNodes } from './design-text.js';
import { readPdfDesign, renderPdfDesign } from './pdf-design.js';

const $ = id => document.getElementById(id);
const layoutName = layout => DESIGN_SAMPLES.find(item => item.layout === layout)?.name ?? layout;
const option = (value, label) => { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; };

export function createDesignWorkspace({ getDraft, getCategory, getLayout, getSlot, selectPage, change, selectPdfText }) {
  document.body.classList.add('design-studio-editor');
  const workspace = document.querySelector('.theme-editor-workspace'), preview = document.querySelector('.theme-preview-panel');
  const pages = document.createElement('aside'); pages.className = 'design-pages'; pages.setAttribute('aria-label', 'デザインのページ一覧');
  pages.innerHTML = '<div class="design-panel-heading"><strong>ページ</strong><span id="design-page-count"></span></div><nav id="design-page-list" aria-label="ページを選択"></nav><div class="design-sidebar-foot">1920 × 1080 <span>16:9</span></div>';
  const inspector = document.createElement('aside'); inspector.className = 'design-inspector'; inspector.setAttribute('aria-label', 'デザインの編集スペース');
  inspector.innerHTML = '<div class="design-panel-heading"><strong>編集スペース</strong><span>デザイン</span></div><div id="design-inspector-body"></div>';
  const body = inspector.querySelector('#design-inspector-body');
  const textSection = document.createElement('section'); textSection.id = 'design-selection'; textSection.className = 'design-selection';
  textSection.innerHTML = '<h2>選択した文字</h2><p id="design-text-empty">スライド上の文字をクリックすると、ここで編集できます。</p><label>編集する文章<select id="design-text-select" aria-label="編集する文章"></select></label><label>文字<textarea id="design-text-value" rows="5" maxlength="6000" disabled></textarea></label><p class="form-hint">入力すると見本に反映されます。「変更を保存」または「保存して追加」で保存します。<br>**重要語** で太字にできます。</p>';
  const settings = document.createElement('details'); settings.className = 'design-settings-group'; settings.open = true;
  const summary = document.createElement('summary'); summary.textContent = 'デザイン全体の設定'; settings.append(summary, $('theme-form'));
  body.append(textSection, $('pdf-source-edit-section'), settings, $('preset-structure-editor'), $('ai-customize'));
  const canvas = document.createElement('div'); canvas.className = 'design-canvas-area';
  $('slide-preview-pane').before(canvas); canvas.append($('slide-preview-pane'), $('reference-preview-pane'), $('import-preview-empty'));
  const help = document.createElement('p'); help.className = 'design-canvas-help'; help.textContent = '文字をクリック → 右の編集スペースで編集';
  canvas.after(help);
  workspace.replaceChildren(pages, preview, inspector);
  const frame = $('theme-preview-frame');
  let selected = '', nodes = [], pageSignature = '', thumbs = [], selectionSerial = 0, locked = false;
  function fit() {
    if (innerWidth <= 760) { $('slide-preview-pane').style.removeProperty('width'); $('slide-preview-pane').style.removeProperty('height'); return; }
    const width = Math.min(canvas.clientWidth, canvas.clientHeight * 16 / 9);
    $('slide-preview-pane').style.width = `${Math.max(1, width)}px`; $('slide-preview-pane').style.height = `${Math.max(1, width * 9 / 16)}px`;
  }
  new ResizeObserver(fit).observe(canvas);
  function markSelection() {
    for (const { node, key } of nodes) node.classList.toggle('design-text-selected', key === selected);
  }
  function choose(key, scroll = false) {
    const found = nodes.find(item => item.key === key); selected = found ? key : '';
    $('design-text-select').value = selected;
    $('design-text-value').disabled = locked || !found;
    $('design-text-empty').hidden = !!found;
    if (!found) { $('design-text-value').value = ''; delete $('design-text-value').dataset.key; }
    if (found) {
      const draft = getDraft(), slot = getSlot(), source = slot === null ? draft.layoutTexts?.[getLayout()] : designDeck(draft).slides[slot]?.texts;
      const value = key === 'brand' ? draft.brand : key === 'title' && slot !== null ? designDeck(draft).slides[slot]?.purpose || found.node.textContent : source?.[key] ?? found.node.textContent;
      // 太字記法やコード改行は、プレビューのDOMではなく元の見本データから取得する。
      const blueprint = designDeck(draft), page = slot === null ? null : blueprint.slides[slot];
      const sample = makeDesignSample(draft, getLayout(), page, blueprint.takehomeCount);
      const raw = key === 'brand' ? draft.brand : key.split('.').reduce((owner, part) => owner?.[part], sample);
      if (document.activeElement !== $('design-text-value') || $('design-text-value').dataset.key !== key) $('design-text-value').value = typeof raw === 'string' ? raw : value;
      $('design-text-value').dataset.key = key;
      $('design-text-value').maxLength = key === 'brand' ? 32 : key === 'title' && slot !== null ? 100 : 6000;
    }
    markSelection();
    if (scroll) body.scrollTop = 0;
  }
  $('design-text-select').addEventListener('change', event => choose(event.target.value));
  $('design-text-value').addEventListener('input', event => {
    if (!selected || locked) return;
    const draft = getDraft(), slotIndex = getSlot();
    if (selected === 'brand') { draft.brand = event.target.value; $('design-brand').value = draft.brand; }
    else if (slotIndex !== null) {
      draft.deck ??= designDeck(draft);
      const slot = draft.deck.slides[slotIndex];
      if (selected === 'title') {
        slot.purpose = event.target.value;
        slot.texts ??= {}; slot.texts.title = event.target.value;
        const purpose = document.querySelector(`#deck-rows [data-slot="${slotIndex}"] > input`); if (purpose) purpose.value = slot.purpose;
      } else { slot.texts ??= {}; slot.texts[selected] = event.target.value; }
    } else {
      draft.layoutTexts ??= {}; draft.layoutTexts[getLayout()] ??= {}; draft.layoutTexts[getLayout()][selected] = event.target.value;
    }
    change();
  });
  function pdfMode() {
    textSection.hidden = true;
    if ($('pdf-source-fields').dataset.arranged) return;
    const fields = $('pdf-source-fields'), textLabel = $('pdf-text-select').closest('label'), textFields = $('pdf-text-fields');
    const pageDetails = document.createElement('details'); pageDetails.className = 'design-page-settings'; pageDetails.open = true;
    const summary = document.createElement('summary'); summary.textContent = 'ページの設定'; pageDetails.append(summary);
    for (const child of [...fields.children]) if (child !== textLabel && child !== textFields) pageDetails.append(child);
    fields.replaceChildren(textLabel, textFields, pageDetails); fields.dataset.arranged = 'true';
    $('pdf-source-edit-section').querySelector('h2').textContent = '選択した文字';
    $('pdf-source-edit-section').querySelector('p').textContent = 'プレビューの文字をクリックして選択し、ここで編集します。入力は見本に反映されます。';
  }
  async function connectPreview() {
    const serial = ++selectionSerial, draft = getDraft(), doc = frame.contentDocument;
    if (!doc?.getElementById('stage')) return;
    if (!doc.getElementById('design-edit-style')) {
      const style = doc.createElement('style'); style.id = 'design-edit-style';
      style.textContent = '.design-preview #stage{pointer-events:auto}[data-design-text]{cursor:pointer}[data-design-text]:hover,.design-text-selected{outline:3px solid #547ab9;outline-offset:5px}.design-pdf-hit{position:absolute;z-index:10;background:transparent!important;border:0!important;border-radius:0!important;padding:0!important;cursor:pointer}.design-pdf-hit:hover,.design-pdf-hit.design-text-selected{outline:1.5px solid #547ab9;outline-offset:1px;background:#547ab914!important}';
      doc.head.append(style);
    }
    if (draft.pdfSource) {
      pdfMode();
      const manifest = await readPdfDesign(draft.pdfSource.pdfId);
      if (serial !== selectionSerial) return;
      const configured = draft.pdfSource.pages[getSlot() ?? 0], page = manifest.pages.find(item => item.page === configured.page), surface = doc.querySelector('.pdf-source-canvas');
      if (!surface || !page) return;
      surface.querySelectorAll('.design-pdf-hit').forEach(node => node.remove()); nodes = [];
      for (const text of page.texts.filter(item => item.editable)) {
        const edit = configured.edits.find(item => item.id === text.id) ?? {}; if (edit.hidden) continue;
        const button = doc.createElement('button'); button.type = 'button'; button.className = 'design-pdf-hit'; button.dataset.designText = text.id; button.setAttribute('aria-label', `編集：${edit.text ?? text.text}`);
        const ratio = (edit.fontSize ?? text.fontSize) / text.fontSize;
        Object.assign(button.style, { left: `${edit.x ?? text.x}px`, top: `${edit.y ?? text.y}px`, width: `${edit.width ?? text.width * ratio}px`, height: `${Math.max(8, text.height * ratio)}px` });
        button.addEventListener('click', () => { selectPdfText(text.id); selected = text.id; markSelection(); body.scrollTop = 0; });
        surface.append(button); nodes.push({ node: button, key: text.id });
      }
      selected = $('pdf-text-select').value; markSelection(); return;
    }
    nodes = designTextNodes(doc.getElementById('stage'));
    $('design-text-select').replaceChildren(option('', '文字を選択'), ...nodes.map(item => option(item.key, `${item.label} · ${item.node.textContent.slice(0, 22)}`)));
    for (const { node, key } of nodes) {
      const hit = key === 'title' ? node.closest('h1') : node;
      hit.style.cursor = 'pointer'; hit.addEventListener('click', () => choose(key, true));
    }
    choose(selected);
  }
  function drawThumb(record, i) {
    const draft = getDraft(), blueprint = designDeck(draft), slot = blueprint.slides[i]; if (!slot) return;
    if (validateDesign(draft).length) return;
    const stage = record.stage;
    if (draft.pdfSource) {
      if (record.busy) { record.again = true; return; }
      record.busy = true;
      renderPdfDesign(stage, structuredClone(draft), i).catch(() => { record.mini.dataset.failed = 'true'; }).finally(() => { record.busy = false; if (record.again && record.mini.isConnected) { record.again = false; drawThumb(record, i); } });
    } else {
      const key = getCategory(), categories = designCategories(draft);
      const deck = { brand: draft.brand, title: draft.name, number: '01', category: key, slides: blueprint.slides.map(item => makeDesignSample(draft, item.layout, item, blueprint.takehomeCount)) };
      renderSlide(stage, deck, i, designImages(key, categories[key].colors), categories[key]); applyDesignTheme(stage, draft, key, slot);
      stage.querySelectorAll('[data-block]').forEach(node => node.classList.add('visible')); applyMotion(stage, deck, deck.slides[i], 60, 60);
    }
    stage.style.transform = `scale(${record.mini.clientWidth / 1920})`;
    record.button.setAttribute('aria-current', String(i === getSlot()));
    record.button.title = slot.purpose || `${i + 1} · ${layoutName(slot.layout)}`;
    record.label.textContent = draft.pdfSource ? slot.purpose : COMPOSITIONS[slot.composition]?.name ?? layoutName(slot.layout);
  }
  function syncPages() {
    const draft = getDraft(); if (!draft) return;
    const blueprint = designDeck(draft), signature = JSON.stringify(blueprint.slides.map(item => [item.layout, item.pdfPage]));
    if (signature !== pageSignature) {
      pageSignature = signature; thumbs = []; $('design-page-list').replaceChildren();
      blueprint.slides.forEach((slot, i) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'design-page-item'; button.setAttribute('aria-label', `${i + 1}枚目を編集`);
        const mini = document.createElement('div'); mini.className = 'design-page-mini'; mini.setAttribute('aria-hidden', 'true');
        const shadow = mini.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/design-theme.css"><section id="stage"><div class="slide-header"><span id="eyebrow"></span><strong id="brand"></strong></div><div id="slide-content"></div><footer class="slide-footer"><span id="lecture-title"></span><span id="slide-number"></span></footer></section>';
        const pdfStyle = document.createElement('style'); pdfStyle.textContent = '#stage[data-pdf-scene]{background:white}#stage[data-pdf-scene]::before,#stage[data-pdf-scene]::after,#stage[data-pdf-scene]>:not(.pdf-source-canvas){display:none}'; shadow.append(pdfStyle);
        const footer = document.createElement('div'); footer.className = 'design-page-footer';
        const number = document.createElement('strong'); number.textContent = String(i + 1).padStart(2, '0'); const label = document.createElement('span'); footer.append(number, label);
        button.append(mini, footer); $('design-page-list').append(button);
        const record = { button, mini, stage: shadow.getElementById('stage'), label }; thumbs.push(record);
        for (const link of shadow.querySelectorAll('link')) link.addEventListener('load', () => drawThumb(record, i), { once: true });
        button.addEventListener('click', () => { selected = ''; selectPage(i); });
      });
    }
    thumbs.forEach(drawThumb); $('design-page-count').textContent = `${blueprint.slides.length}枚`;
  }
  new ResizeObserver(() => thumbs.forEach(record => { record.stage.style.transform = `scale(${record.mini.clientWidth / 1920})`; })).observe(pages);
  $('customize-jump').addEventListener('click', () => { $('ai-customize').scrollIntoView({ block: 'start' }); });
  return { syncPages, connectPreview, selectPdf(id) { selected = id; markSelection(); }, clearSelection() { selected = ''; }, setLocked(value) { locked = value; $('design-text-value').disabled = value || !selected; $('design-text-select').disabled = value; } };
}
