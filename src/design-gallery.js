import { renderSlide } from './slide-view.js';
import { applyMotion } from './motion.js';
import { designImages } from './design-catalog.js';
import { applyDesignTheme, designCategories, designCategoryKey, designDeck } from './design-theme.js';
import { makeDesignSample } from './design-sample.js';
import { renderPdfDesign } from './pdf-design.js';
import { renderCategoryAssignments } from './category-designs.js';
import { setupShare, openShareExport } from './share-ui.js';

const $ = id => document.getElementById(id);
const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const normalize = value => value.normalize('NFKC').toLocaleLowerCase('ja');
const folderNames = { active: 'デザイン', unused: '使わない', trash: 'ゴミ箱' };
const folderIcon = '<svg viewBox="0 0 24 20" aria-hidden="true"><path d="M2 17V4a2 2 0 0 1 2-2h5l3 3h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z"/></svg>';

export async function initDesignGallery() {
  let entries = [], categories = [], busy = false, pendingDelete = null, pendingTrigger = null;
  let dragged = null;
  const params = new URLSearchParams(location.search);
  let folder = Object.hasOwn(folderNames, params.get('folder')) ? params.get('folder') : 'active';
  const previews = new Map();
  const resize = new ResizeObserver(items => { for (const item of items) { const stage = item.target.shadowRoot?.getElementById('stage'); if (stage) stage.style.transform = `scale(${item.contentRect.width / 1920})`; } });
  const visible = new IntersectionObserver(items => {
    for (const item of items) if (item.isIntersecting) { visible.unobserve(item.target); const record = previews.get(item.target); if (record) void drawThumbnail(record); }
  }, { rootMargin: '200px' });
  async function drawThumbnail({ host, entry, stage, shadow }) {
    try {
      await Promise.all([...shadow.querySelectorAll('link')].map(link => link.sheet ? Promise.resolve() : new Promise(done => { link.addEventListener('load', done, { once: true }); link.addEventListener('error', done, { once: true }); })));
      if (!host.isConnected) return;
      if (entry.design.pdfSource) await renderPdfDesign(stage, entry.design, 0);
      else {
        const design = entry.design, key = designCategoryKey(design, params.get('category')), blueprint = designDeck(design);
        const deck = { title: design.name, brand: design.brand, number: '01', category: key, slides: blueprint.slides.map(slot => makeDesignSample(design, slot.layout, slot, blueprint.takehomeCount)) };
        renderSlide(stage, deck, 0, designImages(key, designCategories(design)[key].colors), designCategories(design)[key]);
        applyDesignTheme(stage, design, key, blueprint.slides[0]);
        stage.querySelectorAll('[data-block]').forEach(node => node.classList.add('visible'));
        applyMotion(stage, deck, deck.slides[0], 60, 60);
      }
      stage.style.transform = `scale(${host.clientWidth / 1920})`; host.dataset.previewReady = 'true';
    } catch {
      host.classList.add('preview-failed'); host.replaceChildren(make('span', '', 'プレビューを読み込めません')); host.setAttribute('aria-hidden', 'true');
    }
  }
  function thumbnail(entry) {
    const host = make('div', `design-thumb${entry.design.pdfSource ? ' pdf-card-preview' : ''}`); host.setAttribute('aria-hidden', 'true');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/design-theme.css"><style>#stage[data-pdf-scene]{background:white}#stage[data-pdf-scene]::before,#stage[data-pdf-scene]::after,#stage[data-pdf-scene]>:not(.pdf-source-canvas){display:none}</style><section id="stage"><div class="slide-header"><span id="eyebrow"></span><strong id="brand"></strong></div><div id="slide-content"></div><footer class="slide-footer"><span id="lecture-title"></span><span id="slide-number"></span></footer></section>';
    previews.set(host, { host, entry, shadow, stage: shadow.getElementById('stage') }); resize.observe(host); visible.observe(host); return host;
  }
  function clearPreviews() { for (const host of previews.keys()) { resize.unobserve(host); visible.unobserve(host); } previews.clear(); }
  const detailUrl = entry => `/design/detail?category=${designCategoryKey(entry.design, params.get('category'))}&layout=title${entry.builtin ? '' : `&theme=${entry.id}`}`;
  function status(message, error = false) { $('design-gallery-status').textContent = message; $('design-gallery-status').dataset.error = String(error); }
  async function load() {
    const [designsResponse, categoriesResponse] = await Promise.all([fetch('/api/designs?includeTrash=1', { cache: 'no-store' }), fetch('/api/category-designs', { cache: 'no-store' })]);
    const designs = await designsResponse.json(), config = await categoriesResponse.json();
    if (!designsResponse.ok || !categoriesResponse.ok) throw new Error(designs.error || config.error || '一覧を読み込めません。');
    entries = designs.designs; categories = config.categories; render();
  }
  async function change(entry, op, destination) {
    if (busy) return false;
    busy = true; $('design-list').setAttribute('aria-busy', 'true');
    for (const button of $('design-list').querySelectorAll('button')) button.disabled = true;
    try {
      const response = await fetch('/api/designs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Editor': '1' }, body: JSON.stringify({ op, id: entry.id, revision: entry.revision, ...(destination ? { folder: destination } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '操作を保存できません。');
      await load();
      status(op === 'trash' ? `「${entry.design.name}」をゴミ箱に移動しました。ゴミ箱から復元できます。` : `「${entry.design.name}」を「${folderNames[result.folder]}」へ${op === 'restore' ? '復元' : '移動'}しました。`);
      document.querySelector(`[data-design-folder="${folder}"]`)?.focus(); return true;
    } catch (error) { status(error.message, true); return false; }
    finally { busy = false; $('design-list').setAttribute('aria-busy', 'false'); for (const button of $('design-list').querySelectorAll('button')) button.disabled = false; }
  }
  function deleteEntry(entry, trigger) {
    if (busy) return;
    pendingDelete = entry; pendingTrigger = trigger;
    $('design-delete-name').textContent = entry.design.name;
    $('design-delete-error').hidden = true; $('design-delete-confirm').disabled = false;
    $('design-delete-dialog').showModal(); $('design-delete-cancel').focus();
  }
  function dropAllowed(destination) {
    if (!dragged || busy || pendingDelete || dragged.entry.folder === destination) return false;
    return destination !== 'trash' || (!dragged.entry.builtin && dragged.entry.folder !== 'trash');
  }
  function clearDrag() {
    dragged?.element.classList.remove('is-dragging'); dragged = null;
    document.body.classList.remove('dragging-design');
    for (const button of document.querySelectorAll('[data-design-folder]')) button.classList.remove('drop-allowed', 'drop-target');
  }
  function card(entry) {
    const wrapper = make('article', 'design-tile'); wrapper.dataset.design = entry.id;
    wrapper.draggable = true; wrapper.setAttribute('aria-describedby', 'design-folder-hint');
    let dragFromMenu = false;
    wrapper.addEventListener('pointerdown', event => { dragFromMenu = !!event.target.closest('.design-tile-menu'); });
    wrapper.addEventListener('dragstart', event => {
      if (busy || pendingDelete || dragFromMenu || !event.dataTransfer) { event.preventDefault(); return; }
      clearDrag(); dragged = { entry, element: wrapper };
      event.dataTransfer.clearData(); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-sakusura-design', entry.id); event.dataTransfer.setData('text/plain', entry.design.name);
      wrapper.classList.add('is-dragging'); document.body.classList.add('dragging-design');
      for (const button of document.querySelectorAll('[data-design-folder]')) button.classList.toggle('drop-allowed', dropAllowed(button.dataset.designFolder));
    });
    wrapper.addEventListener('dragend', clearDrag);
    const link = make(entry.folder === 'trash' ? 'div' : 'a', 'catalog-theme'); if (entry.folder !== 'trash') link.href = detailUrl(entry); link.dataset.themeId = entry.id;
    link.draggable = true;
    link.title = entry.design.name;
    link.id = entry.builtin ? 'theme-detail-link' : `theme-${entry.id}`;
    const body = make('div', 'design-tile-body'), title = make('h2', '', entry.design.name); title.id = `title-${entry.id}`;
    link.setAttribute('aria-labelledby', title.id);
    const badges = make('div', 'design-tile-meta'); badges.append(make('span', '', entry.builtin ? '標準' : entry.design.pdfSource ? 'PDF' : 'カスタム'), make('span', '', `${designDeck(entry.design).slides.length}枚`));
    const used = categories.filter(item => item.designId === entry.id).map(item => item.name);
    if (used.length) { const badge = make('span', 'design-in-use', '使用中'); badge.title = used.join('、'); badges.append(badge); }
    body.append(title, badges); link.append(thumbnail(entry), body);
    const footer = make('div', 'design-tile-foot'); footer.append(make('small', '', entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString('ja-JP') : '標準デザイン'));
    const menu = make('details', 'design-tile-menu'), summary = make('summary', '', '···'); summary.setAttribute('aria-label', `${entry.design.name}の操作`); summary.title = '移動・削除';
    const actions = make('div', 'design-tile-actions');
    function action(text, callback, danger = false) { const button = make('button', danger ? 'is-danger' : '', text); button.type = 'button'; button.addEventListener('click', () => { menu.open = false; callback(button); }); actions.append(button); return button; }
    if (entry.folder === 'trash') action('復元する', () => change(entry, 'restore'));
    else {
      const destination = entry.folder === 'unused' ? 'active' : 'unused';
      action(destination === 'unused' ? '「使わない」へ移動' : 'デザイン一覧に戻す', () => change(entry, 'move', destination));
      const duplicate = make('a', '', '複製して編集'); duplicate.href = `/design/new?base=${encodeURIComponent(entry.id)}`; actions.append(duplicate);
      // 共有：標準デザインは誰でも持っているので対象外。PDFから作ったデザインは追加ファイルが要るため、この版では書き出せない（docs/SHARE.md）。
      if (!entry.builtin) {
        const share = action('共有ファイルに書き出す', () => openShareExport({ kind: 'design', id: entry.id, title: entry.design.name }));
        if (entry.design.pdfSource || entry.referencePdfId) { share.disabled = true; share.title = 'PDFから作ったデザインは、まだ共有できません'; share.textContent = '共有ファイルに書き出す（PDF由来は未対応）'; }
      }
      if (!entry.builtin) action('削除する', trigger => deleteEntry(entry, trigger), true);
    }
    menu.addEventListener('toggle', () => {
      if (!menu.open) return;
      menu.classList.toggle('opens-up', innerHeight - menu.getBoundingClientRect().bottom < actions.scrollHeight + 12);
      for (const other of document.querySelectorAll('.design-tile-menu[open]')) if (other !== menu) other.open = false;
    });
    menu.append(summary, actions); footer.append(menu); wrapper.append(link, footer); return wrapper;
  }
  function render() {
    clearPreviews();
    const query = normalize($('design-search').value.trim());
    const items = entries.filter(entry => (entry.folder ?? 'active') === folder && (!query || normalize(`${entry.design.name} ${entry.design.description}`).includes(query)));
    if ($('design-sort').value === 'name') items.sort((a, b) => a.design.name.localeCompare(b.design.name, 'ja'));
    else items.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    $('design-list').replaceChildren(...items.map(card));
    $('design-list-empty').hidden = !!items.length;
    $('design-list-empty').textContent = query ? '検索に一致するデザインがありません。' : folder === 'trash' ? 'ゴミ箱は空です。削除したデザインはここから復元できます。' : folder === 'unused' ? '各デザインの「···」から、使わないデザインをここに収納できます。' : 'デザインはありません。「デザインを追加」からPDFを追加できます。';
    $('design-folder-title').textContent = folderNames[folder]; $('design-result-count').textContent = `${items.length}件`;
    $('design-count').textContent = `${entries.filter(entry => entry.folder !== 'trash').length}テーマ`;
    for (const button of document.querySelectorAll('[data-design-folder]')) {
      button.setAttribute('aria-current', String(button.dataset.designFolder === folder));
      button.querySelector('small').textContent = entries.filter(entry => (entry.folder ?? 'active') === button.dataset.designFolder).length;
    }
  }
  for (const button of document.querySelectorAll('[data-design-folder]')) {
    button.querySelector('.design-folder-icon').innerHTML = folderIcon;
    button.addEventListener('click', () => { folder = button.dataset.designFolder; const url = new URL(location.href); folder === 'active' ? url.searchParams.delete('folder') : url.searchParams.set('folder', folder); history.replaceState(null, '', url); render(); status(''); });
    button.addEventListener('dragover', event => {
      event.preventDefault(); const allowed = dropAllowed(button.dataset.designFolder);
      if (event.dataTransfer) event.dataTransfer.dropEffect = allowed ? 'move' : 'none';
      button.classList.toggle('drop-target', allowed);
    });
    button.addEventListener('dragleave', event => { if (!button.contains(event.relatedTarget)) button.classList.remove('drop-target'); });
    button.addEventListener('drop', event => {
      event.preventDefault(); const destination = button.dataset.designFolder;
      const source = dragged, allowed = dropAllowed(destination); clearDrag();
      if (!allowed) return;
      if (destination === 'trash') deleteEntry(source.entry, source.element.querySelector('summary'));
      else void change(source.entry, source.entry.folder === 'trash' ? 'restore' : 'move', destination);
    });
  }
  $('design-search').addEventListener('input', render); $('design-sort').addEventListener('change', render);
  document.addEventListener('click', event => { for (const menu of document.querySelectorAll('.design-tile-menu[open]')) if (!menu.contains(event.target)) menu.open = false; });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { clearDrag(); for (const menu of document.querySelectorAll('.design-tile-menu[open]')) { menu.open = false; menu.querySelector('summary').focus(); } } });
  window.addEventListener('blur', clearDrag);
  $('design-delete-cancel').addEventListener('click', () => $('design-delete-dialog').close());
  $('design-delete-dialog').addEventListener('close', () => { pendingDelete = null; if (pendingTrigger?.isConnected) pendingTrigger.closest('details')?.querySelector('summary')?.focus(); else document.querySelector(`[data-design-folder="${folder}"]`)?.focus(); });
  $('design-delete-confirm').addEventListener('click', async () => {
    if (!pendingDelete || busy) return;
    $('design-delete-confirm').disabled = true;
    if (await change(pendingDelete, 'trash')) $('design-delete-dialog').close();
    else { $('design-delete-error').textContent = $('design-gallery-status').textContent; $('design-delete-error').hidden = false; $('design-delete-confirm').disabled = false; }
  });
  // 共有ファイル（ZIP）の取り込み・書き出し。講義のZIPを入れた場合も取り込み、ライブラリの「共有で受け取った」に入る。
  if ($('share-import')) setupShare({
    importButton: $('share-import'), fileInput: $('share-file'),
    status: (text, isError = false) => status(text, isError),
    refresh: () => load().catch(error => status(error.message, true)),
  });
  await load();
  await renderCategoryAssignments($('gallery-category-settings'), { onSaved: load });
  document.body.dataset.ready = 'true';
}
