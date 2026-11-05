import { renderSlide } from './slide-view.js';
import { applyMotion, hasMotion } from './motion.js';
import { wireDesignMotionControls } from './design-motion-controls.js';
import { DESIGN_SAMPLES as samples, LAYOUT_METRICS, layoutRules, designImages, validDesignCategory as validCategory, validDesignLayout as validLayout } from './design-catalog.js';
import { STANDARD_DESIGN_ID, readDesign, validateDesign, applyDesignTheme, designCategories, designCategoryKey, designDeck, validCategoryId } from './design-theme.js';
import { renderPdfDesign, clearPdfDesign, readPdfDesign, pdfAssetUrl } from './pdf-design.js';
import { wireCategoryAssignment } from './category-designs.js';
import { initDesignGallery } from './design-gallery.js';
import { makeDesignSample } from './design-sample.js';
import { COMPOSITIONS } from './design-compositions.js';

const $ = id => document.getElementById(id);

async function boot() {
if (document.body.classList.contains('design-preview')) {
  const params = new URLSearchParams(location.search);
  const category = validCategoryId(params.get('category')) ? params.get('category') : 'va';
  const layout = validLayout(params.get('layout'));
  const themeId = params.get('theme') || STANDARD_DESIGN_ID;
  const entry = await readDesign(themeId);
  const deck = { title: 'デザインの見本', brand: entry.design.brand, number: '01', category, slides: samples };
  const stage = $('stage');
  const resize = () => { stage.style.transform = `scale(${Math.min(innerWidth / 1920, innerHeight / 1080)})`; };
  new ResizeObserver(resize).observe(document.body);
  window.addEventListener('resize', resize);
  resize();
  let rendering = 0;
  let preview=null,clock=0,playing=false,raf=0,last=0;
  const status=()=>{if(preview&&parent!==window)parent.postMessage({type:'sakusura:design-motion-state',supported:hasMotion(preview.deck,preview.slide),duration:preview.duration,time:clock,playing},location.origin);};
  const paint=t=>{clock=t;if(!preview)return;for(const e of stage.querySelectorAll('[data-block]'))e.classList.toggle('visible',(preview.slide.cues.find(c=>c.target===e.dataset.block)?.at??0)<=t);applyMotion(stage,preview.deck,preview.slide,t,preview.duration,{frames:true});};
  const stop=()=>{cancelAnimationFrame(raf);playing=false;};
  const tick=now=>{if(!playing)return;paint(Math.min(preview.duration,clock+(now-last)/1000));last=now;if(clock>=preview.duration)playing=false;status();if(playing)raf=requestAnimationFrame(tick);};
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==parent||event.data?.type!=='sakusura:design-motion'||!preview)return;
    const {action,value}=event.data;
    if(action==='play'){stop();if(clock>=preview.duration)paint(0);playing=true;last=performance.now();raf=requestAnimationFrame(tick);}
    else if(action==='pause')stop();
    else if(action==='seek'&&Number.isFinite(value)){stop();paint(Math.max(0,Math.min(preview.duration,value)));}
    else if(action==='all'){stop();paint(preview.duration);}
    status();
  });
  async function draw(design, draft = false) {
    stop();preview=null;
    const operation = ++rendering;
    if (design.pdfSource) {
      const requestedSlot = params.has('slot') && /^\d+$/.test(params.get('slot')) ? Number(params.get('slot')) : Math.max(0, design.pdfSource.pages.findIndex(page => page.layout === layout));
      await renderPdfDesign(stage, design, requestedSlot);
      if (operation === rendering && parent !== window) parent.postMessage({ type: draft ? 'sakusura:design-updated' : 'sakusura:design-ready', category, layout, theme: themeId }, location.origin);
      return;
    }
    clearPdfDesign(stage);
    deck.brand = design.brand;
    const key = designCategoryKey(design, category), categories = designCategories(design), blueprint = designDeck(design);
    const slotIndex = params.has('slot') && /^\d+$/.test(params.get('slot')) ? Number(params.get('slot')) : -1;
    const slot = blueprint.slides[slotIndex];
    deck.slides = slot ? blueprint.slides.map(item => makeDesignSample(design, item.layout, item, blueprint.takehomeCount, !entry.builtin || draft)) : samples.map(item => makeDesignSample(design, item.layout, null, blueprint.takehomeCount, !entry.builtin || draft));
    deck.category = key;
    const index = slot ? slotIndex : samples.findIndex(s => s.layout === layout);
    renderSlide(stage, deck, index, designImages(key, categories[key].colors), categories[key]);
    if (!entry.builtin || draft) applyDesignTheme(stage, design, key, slot);
    stage.querySelectorAll('[data-block]').forEach(el => el.classList.add('visible'));
    applyMotion(stage, deck, deck.slides[index], 60, 60);
    preview={deck,slide:deck.slides[index],duration:Math.max(8,...deck.slides[index].cues.map(c=>c.at+3))};clock=preview.duration;status();
    await document.fonts.ready;
    try { await Promise.all([...stage.querySelectorAll('img')].map(img => img.decode())); }
    catch (failure) { if (operation !== rendering) return; throw failure; }
    if (operation === rendering && parent !== window) parent.postMessage({ type: draft ? 'sakusura:design-updated' : 'sakusura:design-ready', category, layout, theme: themeId }, location.origin);
  }
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'sakusura:design-draft') return;
    if (!validateDesign(event.data.design).length) draw(event.data.design, true).catch(showError);
  });
  await draw(entry.design);
} else if (document.body.classList.contains('design-gallery')) {
  const legacy = new URLSearchParams(location.search);
  if (legacy.has('layout')) location.replace(`/design/detail?category=${validCategory(legacy.get('category'))}&layout=${validLayout(legacy.get('layout'))}`);
  await initDesignGallery();
} else {
  const params = new URLSearchParams(location.search);
  const themeId = params.get('theme') || STANDARD_DESIGN_ID;
  const entry = await readDesign(themeId), design = entry.design;
  const themeQuery = entry.builtin ? '' : `&theme=${encodeURIComponent(themeId)}`;
  $('layout-page-title').textContent = design.name;
  $('theme-heading').textContent = 'デザイン情報';
  $('detail-source').textContent = design.pdfSource ? 'PDFから作成' : entry.builtin ? '標準デザイン' : 'カスタムデザイン';
  $('detail-page-count').textContent = `${designDeck(design).slides.length}枚`;
  $('layout-page-description').textContent = design.description;
  for (const element of document.querySelectorAll('[data-design-name]')) element.textContent = design.name;
  document.querySelector('.theme-summary > p').textContent = design.description;
  document.querySelector('.anatomy-brand').textContent = design.brand;
  $('duplicate-design').href = `/design/new?base=${encodeURIComponent(themeId)}`;
  const editorUrl = entry.builtin ? `/design/new?base=${encodeURIComponent(themeId)}` : `/design/edit?theme=${encodeURIComponent(themeId)}`;
  $('customize-design').href = editorUrl;
  $('add-design-category').href = editorUrl + '&section=categories';
  $('edit-design').href = editorUrl;
  if (entry.builtin) $('edit-design').textContent = '複製して編集';
  const more = $('detail-more');
  document.addEventListener('click', event => { if (more.open && !more.contains(event.target)) more.open = false; });
  more.addEventListener('keydown', event => { if (event.key === 'Escape') { more.open = false; more.querySelector('summary').focus(); } });
  more.querySelectorAll('a').forEach(link => link.addEventListener('click', () => { more.open = false; }));
  if (entry.referencePdfId) { $('reference-pdf-link').hidden = false; $('reference-pdf-link').href = `/api/design-pdfs/file?id=${encodeURIComponent(entry.referencePdfId)}`; }
  if (design.pdfSource) { await showPdfDetail(entry); return; }
  if (!entry.builtin) {
    document.querySelector('#design-palette .section-heading p').textContent = '線と図形はカテゴリごとに、背景と文字は共通の色で揃えます。';
    const textRow = [...document.querySelectorAll('.theme-summary dl > div')].find(row => row.querySelector('dt')?.textContent === '文字色');
    if (textRow) textRow.querySelector('dd').textContent = '全カテゴリ共通';
    document.querySelector('#type-heading').closest('section').querySelector('.section-note').textContent = '重要な語は太字で強調し、一文スライドでは下線マーカーを使います。';
  }
  const categories = designCategories(design), blueprint = designDeck(design);
  let category = designCategoryKey(design, params.get('category'));
  let layout = validLayout(params.get('layout'));
  let selectedSlot = params.has('slot') && /^\d+$/.test(params.get('slot')) && blueprint.slides[Number(params.get('slot'))] ? Number(params.get('slot')) : null;
  if (selectedSlot !== null) layout = blueprint.slides[selectedSlot].layout;
  const frame = $('design-frame');
  wireDesignMotionControls(frame);

  for (const [value, item] of Object.entries(categories)) {
    const option = document.createElement('option'); option.value = value; option.textContent = item.name;
    $('design-category').append(option);
  }
  $('design-category').value = category; await wireCategoryAssignment($('design-category'), entry);
  for (const sample of samples) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.layout = sample.layout;
    button.textContent = sample.name; button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => { if (layout === sample.layout && selectedSlot === null) return; selectedSlot = null; layout = sample.layout; navigate(); });
    $('layout-options').append(button);
  }
  $('summary-slide-count').textContent = `${blueprint.slides.length}枚`;
  $('structure-heading').textContent = `スライド一覧 · ${blueprint.slides.length}枚`;
  $('structure-description').textContent = '選ぶと右の見本が切り替わります。';
  document.querySelector('.deck-map').setAttribute('aria-label', `${blueprint.slides.length}枚のスライド構成`);
  $('structure-note').textContent = `予定${blueprint.targetSeconds}秒。並び・用途は「編集する」で変更できます。`;
  for (let i = 1; i <= blueprint.slides.length; i++) {
    const slot = blueprint.slides[i - 1], sample = samples.find(item => item.layout === slot.layout);
    const page = document.createElement('button'); page.type = 'button'; page.className = 'deck-page';
    const message = slot.layout === 'message', edge = ['title', 'takehome'].includes(slot.layout);
    page.classList.toggle('is-message', message); page.classList.toggle('is-edge', edge);
    const number = document.createElement('span'); number.textContent = String(i).padStart(2, '0');
    const label = document.createElement('small'); label.textContent = COMPOSITIONS[slot.composition]?.name ?? sample.name;
    page.title = slot.purpose || `${i}枚目：${sample.name}`;
    page.addEventListener('click', () => { selectedSlot = i - 1; layout = slot.layout; navigate(); });
    page.append(number, label); document.querySelector('.deck-map').append(page);
  }

  function navigate() {
    const sample = samples.find(s => s.layout === layout);
    document.title = `${sample.name} | ${design.name} | SAKUSURA`;
    $('preview-heading').textContent = `${sample.name}の見本`;
    $('layout-rule-title').textContent = `${sample.name}で決めていること`;
    $('layout-rule-description').textContent = sample.description;
    $('breadcrumb-layout').textContent = sample.name;
    for (const link of document.querySelectorAll('[data-gallery-link]')) link.href = `/design?category=${category}`;
    const rules = layoutRules(sample, category).filter(([label]) => !design.deck || label !== '役割');
    if (design.deck) rules.unshift(['この構成', `${blueprint.slides.length}枚のテンプレート。まとめの要点は${blueprint.takehomeCount}個です。`]);
    $('layout-rules').replaceChildren(...rules.map(([label, value]) => {
      const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = value; row.append(dt, dd); return row;
    }));
    $('design-category').value = category;
    $('summary-category').textContent = categories[category].name;
    const editContext = `&category=${category}&layout=${layout}${selectedSlot !== null ? `&slot=${selectedSlot}` : ''}`;
    $('customize-design').href = `${editorUrl}${editContext}&section=ai`;
    $('add-design-category').href = `${editorUrl}&category=${category}&section=categories`;
    $('duplicate-design').href = `/design/new?base=${encodeURIComponent(themeId)}&category=${category}`;
    $('edit-design').href = `${editorUrl}${editContext}`;
    for (const [i, page] of [...document.querySelectorAll('.deck-map .deck-page')].entries()) page.setAttribute('aria-current', String(i === selectedSlot));
    for (const button of $('layout-options').children) button.setAttribute('aria-pressed', String(button.dataset.layout === layout));
    const url = new URL(location.href); url.searchParams.set('category', category); url.searchParams.set('layout', layout);
    if (selectedSlot !== null) url.searchParams.set('slot', selectedSlot); else url.searchParams.delete('slot');
    history.replaceState(null, '', url);
    $('preview-status').textContent = '見本を読み込んでいます…';
    const src = `/design/preview?category=${category}&layout=${layout}${themeQuery}${selectedSlot !== null ? `&slot=${selectedSlot}` : ''}`;
    if (frame.getAttribute('src') !== src) frame.src = src;
  }

  function reflectDesign() {
    const stage = frame.contentDocument?.getElementById('stage');
    if (!stage) return;
    const css = getComputedStyle(stage);
    const token = key => css.getPropertyValue(`--${key}`).trim();
    const metrics = [[layout === 'title' ? '題名' : layout === 'message' ? '一文' : '見出し', 'h1', 'fontSize'], ['本文', '.block-text', 'fontSize'], ...(LAYOUT_METRICS[layout] ?? [])];
    $('layout-metrics').replaceChildren(...metrics.flatMap(([label, selector, property, pseudo]) => {
      const element = stage.querySelector(selector);
      if (!element) return [];
      const value = getComputedStyle(element, pseudo ?? null)[property];
      if (!value || value === 'normal' || value === 'auto') return [];
      const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = value; row.append(dt, dd); return [row];
    }));
    for (const key of ['primary', 'accent', 'marker', 'paper', 'text-strong', 'text', 'text-meta', 'rule']) document.body.style.setProperty(`--theme-${key}`, token(key));
    document.body.style.setProperty('--theme-font-family', css.fontFamily);
    document.body.style.setProperty('--theme-left', `${parseFloat(token('left')) / 1920 * 100}%`);
    document.body.style.setProperty('--theme-right', `${parseFloat(token('right')) / 1920 * 100}%`);
    const colors = [['primary', '主色'], ['accent', '差し色'], ['soft', '淡い色'], ['marker', 'マーカー'], ['paper', '背景'], ['text-strong', '見出し・重要語'], ['text', '本文'], ['text-meta', '補足'], ['rule', '罫線']];
    $('palette').replaceChildren(...colors.map(([key, name]) => {
      const swatch = document.createElement('div'); swatch.className = 'swatch';
      const color = document.createElement('div'); color.className = 'swatch-color'; color.style.setProperty('--swatch', token(key));
      const label = document.createElement('strong'); label.textContent = name;
      const value = document.createElement('code'); value.textContent = token(key).toUpperCase();
      swatch.append(color, label, value); return swatch;
    }));
    const fonts = css.fontFamily.split(',').map(f => f.trim().replaceAll(/['"]/g, ''));
    $('font-name').textContent = fonts[0];
    $('font-fallback').textContent = `代替書体：${fonts[1] === 'BIZ UDPGothic' ? 'BIZ UDPゴシック' : fonts[1]}`;
    $('type-specimens').replaceChildren(...[['heading', '見出し', '結論を、見出しに。'], ['body', '本文', '短い言葉で、読みやすく。'], ['message', '一文', '伝えることは、ひとつ。']].map(([key, label, text]) => {
      const row = document.createElement('div'); row.className = 'type-row'; row.dataset.kind = key;
      const name = document.createElement('span'); name.textContent = label;
      const sample = document.createElement('span'); sample.className = 'type-sample';
      if (key === 'message') { const strong = document.createElement('strong'); strong.textContent = 'ひとつ。'; sample.append('伝えることは、', strong); } else sample.textContent = text;
      const value = document.createElement('code'); value.textContent = `${design.settings.typography[key]}px`;
      row.append(name, sample, value); return row;
    }));
    const content = stage.querySelector('#slide-content');
    const contentCss = getComputedStyle(content), band = getComputedStyle(stage, '::before');
    $('spacing-specs').replaceChildren(...[['左の余白', token('left')], ['右の余白', token('right')], ['上の余白', contentCss.top], ['左端の帯', band.width]].map(([label, value]) => {
      const div = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = value; div.append(dt, dd); return div;
    }));
    $('preview-status').textContent = `${categories[category].name} / ${samples.find(s => s.layout === layout).name}`;
    document.body.dataset.ready = 'true';
  }

  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.type !== 'sakusura:design-ready') return;
    if (event.data.theme !== themeId) return;
    if (event.data.category === category && event.data.layout === layout) reflectDesign();
  });
  $('design-category').addEventListener('change', event => { const next = designCategoryKey(design, event.target.value); if (next === category) return; category = next; navigate(); });
  navigate();
  // 初期iframeが親のモジュールより先に読み込まれた場合も、表示を取得する。
  if (frame.contentDocument?.getElementById('slide-content')?.children.length && new URL(frame.contentWindow.location.href).searchParams.get('category') === category && new URL(frame.contentWindow.location.href).searchParams.get('layout') === layout && (new URL(frame.contentWindow.location.href).searchParams.get('theme') || STANDARD_DESIGN_ID) === themeId) reflectDesign();
}
}

function showError(error) {
  let target = $('design-error');
  if (!target) { target = document.createElement('p'); target.id = 'design-error'; target.className = 'design-error'; target.setAttribute('role', 'alert'); (document.querySelector('main') || document.body).prepend(target); }
  target.textContent = error.message || 'デザインを読み込めません。ページを再読み込みしてください。'; target.hidden = false;
}
boot().catch(showError);

async function showPdfDetail(entry) {
  const design = entry.design, source = design.pdfSource, params = new URLSearchParams(location.search), manifest = await readPdfDesign(source.pdfId), frame = $('design-frame');
  document.body.classList.add('pdf-source-detail');
  for (const selector of ['#common-design', '#design-palette', '.detail-columns']) document.querySelector(selector).hidden = true;
  document.querySelector('.theme-summary .summary-note').textContent = 'このプリセットはPDFの原本デザインです。カテゴリの色や標準テンプレートの配置は適用しません。';
  const textColorRow = [...document.querySelectorAll('.theme-summary dl>div')].find(row => row.querySelector('dt')?.textContent === '文字色');
  if (textColorRow) textColorRow.querySelector('dd').textContent = '元PDFを保持';
  document.querySelector('#layout-page-description').textContent = '元PDFの配置・図版・罫線・文字の形を保持したデザイン。';
  $('summary-slide-count').textContent = `${source.pages.length}枚`;
  $('structure-heading').textContent = `${source.pages.length}枚のPDFページ`;
  $('structure-description').textContent = 'ページを選ぶと、元PDFのデザインを確認できます。';
  $('structure-note').textContent = '編集画面では文字の差し替え・位置・サイズ、ページの並び・複製・削除を設定できます。';
  const categories = designCategories(design), select = $('design-category');
  for (const [id, item] of Object.entries(categories)) { const option = document.createElement('option'); option.value = id; option.textContent = item.name; select.append(option); }
  let category = params.get('category') || designCategoryKey(design);
  select.value = category;
  const assignment = await wireCategoryAssignment(select, entry);
  select.value = [...select.options].some(option => option.value === category) ? category : select.options[0].value; category = select.value; assignment.refresh();
  let index = /^\d+$/.test(params.get('slot') ?? '') && source.pages[Number(params.get('slot'))] ? Number(params.get('slot')) : 0;
  const pages = document.createElement('select'); pages.id = 'pdf-detail-page'; pages.setAttribute('aria-label', 'PDFのページ');
  source.pages.forEach((page, i) => {
    const option = document.createElement('option'); option.value = i; option.textContent = `${i + 1}. ${page.label || `元PDF ${page.page}ページ`}`; pages.append(option);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'deck-page'; button.textContent = String(i + 1).padStart(2, '0'); button.title = page.label;
    button.addEventListener('click', () => { index = i; draw(); }); document.querySelector('.deck-map').append(button);
  });
  const pager = document.createElement('div'); pager.className = 'pdf-page-navigation'; pager.setAttribute('aria-label', 'PDFのページ切り替え');
  const previous = document.createElement('button'); previous.type = 'button'; previous.id = 'pdf-page-previous'; previous.textContent = '←'; previous.setAttribute('aria-label', '前のページ');
  const next = document.createElement('button'); next.type = 'button'; next.id = 'pdf-page-next'; next.textContent = '→'; next.setAttribute('aria-label', '次のページ');
  const count = document.createElement('span'); count.id = 'pdf-page-position'; count.setAttribute('aria-live', 'polite');
  const pageLabel = document.createElement('label'); pageLabel.className = 'pdf-page-choice'; pageLabel.textContent = 'ページ'; pageLabel.append(pages);
  pager.append(previous, pageLabel, next, count); $('layout-options').replaceChildren(pager);
  document.querySelector('.preview-panel > .preview-canvas').before($('layout-options'));
  function draw() {
    const page = source.pages[index], original = manifest.pages.find(item => item.page === page.page); pages.value = index;
    const categoryName = select.selectedOptions[0]?.textContent || category;
    $('summary-category').textContent = categoryName;
    $('preview-heading').textContent = `${index + 1}. ${page.label || 'PDFのページ'}`;
    $('breadcrumb-layout').textContent = `PDF ${index + 1}ページ`;
    $('layout-rule-title').textContent = 'PDF原本のページ情報'; $('layout-rule-description').textContent = '原本にない装飾や固定要素を追加しません。';
    $('layout-metrics').replaceChildren(...[['元のページ', `${page.page}ページ`], ['横', `${original.width}px`], ['縦', `${original.height}px`], ['文字の変更', `${page.edits.length}か所`]].map(([key, value]) => { const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = value; row.append(dt, dd); return row; }));
    $('layout-rules').replaceChildren();
    const editContext = `/design/edit?theme=${entry.id}&category=${category}&slot=${index}&layout=${page.layout}`;
    $('customize-design').href = `${editContext}&section=ai`; $('edit-design').href = editContext;
    previous.disabled = index === 0; next.disabled = index === source.pages.length - 1; count.textContent = `${index + 1} / ${source.pages.length}`;
    [...document.querySelectorAll('.deck-map .deck-page')].forEach((button, i) => button.setAttribute('aria-current', String(i === index)));
    $('add-design-category').href = `/design#category-assignments`;
    for (const link of document.querySelectorAll('[data-gallery-link]')) link.href = `/design?category=${category}`;
    frame.style.visibility = 'hidden'; $('preview-status').textContent = 'PDFのページを読み込んでいます…';
    const url = new URL(location.href); url.searchParams.set('category', category); url.searchParams.set('slot', index); history.replaceState(null, '', url);
    frame.src = `/design/preview?theme=${entry.id}&category=${category}&slot=${index}&layout=${page.layout}`;
  }
  pages.addEventListener('change', () => { index = Number(pages.value); draw(); });
  previous.addEventListener('click', () => { if (index > 0) { index--; draw(); } });
  next.addEventListener('click', () => { if (index < source.pages.length - 1) { index++; draw(); } });
  select.addEventListener('change', () => { category = select.value; draw(); });
  window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.type !== 'sakusura:design-ready' || event.data.theme !== entry.id || event.data.category !== category) return;
    frame.style.visibility = 'visible'; $('preview-status').textContent = `${select.selectedOptions[0].textContent} / PDF ${source.pages[index].page}ページ`; document.body.dataset.ready = 'true';
  });
  draw();
}
