const manifests = new Map(), assets = new Map();
export const pdfAssetUrl = (id, file) => `/api/pdf-designs/asset?id=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}`;
export async function readPdfDesign(id) {
  if (!manifests.has(id)) manifests.set(id, fetch(`/api/pdf-designs?id=${encodeURIComponent(id)}`, { cache: 'no-store' }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'PDFのページを読み込めません。'); return data; }).catch(error => { manifests.delete(id); throw error; }));
  return manifests.get(id);
}
function safeSvg(raw) {
  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('PDFの図版を読み込めません。');
  const blocked = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'a', 'animate', 'animatetransform', 'animatemotion', 'set', 'style']);
  for (const element of [...doc.querySelectorAll('*')]) {
    if (blocked.has(element.localName.toLowerCase())) { element.remove(); continue; }
    for (const attr of [...element.attributes]) {
      if (/^on/i.test(attr.name) || (/href$/i.test(attr.name) && !/^(?:#[a-zA-Z0-9_-]+|data:image\/(?:png|jpeg);base64,)/.test(attr.value)) || (/url\(/i.test(attr.value) && !/^url\(#[a-zA-Z0-9_-]+\)$/.test(attr.value))) element.removeAttributeNode(attr);
    }
  }
  return document.importNode(doc.documentElement, true);
}
export function clearPdfDesign(stage) { delete stage.dataset.pdfScene; stage.querySelector('.pdf-source-canvas')?.remove(); }
export async function renderPdfDesign(stage, design, index) {
  stage.dataset.pdfScene = 'true';
  const manifest = await readPdfDesign(design.pdfSource.pdfId), configured = design.pdfSource.pages[index] ?? design.pdfSource.pages[0];
  const page = manifest.pages.find(item => item.page === configured.page);
  if (!page) throw new Error('指定した元PDFのページが見つかりません。');
  const url = pdfAssetUrl(design.pdfSource.pdfId, page.file);
  if (!assets.has(url)) assets.set(url, fetch(url).then(response => { if (!response.ok) throw new Error('PDFの図版を読み込めません。'); return response.text(); }).catch(error => { assets.delete(url); throw error; }));
  const svg = safeSvg(await assets.get(url));
  const canvas = document.createElement('div'); canvas.className = 'pdf-source-canvas'; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `元PDF ${configured.page}ページ：${configured.label}`);
  const ratio = Math.min(1920 / page.width, 1080 / page.height);
  canvas.style.cssText = `position:absolute;left:${(1920 - page.width * ratio) / 2}px;top:${(1080 - page.height * ratio) / 2}px;width:${page.width}px;height:${page.height}px;transform:scale(${ratio});transform-origin:top left;`;
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;'; canvas.append(svg);
  const fontPrefix = design.pdfSource.pdfId.replaceAll('-', '');
  const fitNodes = [];
  const fonts = document.createElement('style');
  fonts.textContent = manifest.fonts.map(font => `@font-face{font-family:${fontPrefix}${font.family};font-weight:${/bold|black|heavy/i.test(font.name) ? 700 : 400};src:url("${pdfAssetUrl(design.pdfSource.pdfId, font.file)}");}`).join(''); canvas.append(fonts);
  for (const edit of configured.edits) {
    const text = page.texts.find(item => item.id === edit.id); if (!text?.editable) continue;
    const glyphs = svg.querySelectorAll(`[data-text-id="${text.id}"]`);
    if (edit.hidden) { glyphs.forEach(glyph => { glyph.style.display = 'none'; }); continue; }
    if ((edit.text !== undefined && edit.text !== text.text) || (edit.width !== undefined && edit.width !== text.width)) {
      glyphs.forEach(glyph => { glyph.style.display = 'none'; });
      const replacement = document.createElement('div'); replacement.className = 'pdf-text-replacement'; replacement.dataset.textId = text.id;
      replacement.textContent = edit.text ?? text.text;
      const size = edit.fontSize ?? text.fontSize;
      replacement.style.cssText = `position:absolute;left:${edit.x ?? text.x}px;top:${edit.y ?? text.y}px;width:${edit.width ?? text.width}px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:${size}px;line-height:${text.height / text.fontSize};font-weight:${text.bold ? 700 : 400};color:${edit.color ?? text.color};font-family:${text.fontFamily ? fontPrefix + text.fontFamily + ',' : ''}'Noto Sans JP','Yu Gothic',sans-serif;`;
      canvas.append(replacement);
      if (edit.fit !== false) fitNodes.push({ node: replacement, max: size, height: text.height, width: edit.width ?? text.width });
    } else {
      const scale = (edit.fontSize ?? text.fontSize) / text.fontSize;
      for (const glyph of glyphs) {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('transform', `translate(${edit.x ?? text.x} ${edit.y ?? text.y}) scale(${scale}) translate(${-text.x} ${-text.y})`);
        glyph.replaceWith(group); group.append(glyph); if (edit.color) glyph.setAttribute('fill', edit.color);
      }
    }
  }
  clearPdfDesign(stage); stage.dataset.pdfScene = 'true'; stage.append(canvas);
  await Promise.all([...canvas.querySelectorAll('.pdf-text-replacement')].map(node => document.fonts.load(`${parseFloat(node.style.fontSize)}px ${getComputedStyle(node).fontFamily}`).catch(() => {})));
  await document.fonts.ready;
  for (const { node, max, height, width } of fitNodes) {
    let low = Math.min(6, max), high = max;
    for (let i = 0; i < 12; i++) { const middle = (low + high) / 2; node.style.fontSize = `${middle}px`; if (node.scrollHeight <= height + 1 && node.scrollWidth <= width + 1) low = middle; else high = middle; }
    node.style.fontSize = `${low}px`; node.style.maxHeight = `${height}px`; node.style.overflow = 'hidden';
    node.dataset.fitSize = low.toFixed(1); node.dataset.fitError = String(node.scrollHeight > height + 2 || node.scrollWidth > width + 2);
  }
  await Promise.all([...svg.querySelectorAll('image')].map(async element => { const src = element.getAttribute('href') || element.getAttributeNS('http://www.w3.org/1999/xlink', 'href'); if (src) { const image = new Image(); image.src = src; await image.decode().catch(() => {}); } }));
  return { page, configured };
}

export async function createPdfPageEditor({ getDraft, onChange, onPreviewSlot, onTextSelect = () => {} }) {
  const $ = id => document.getElementById(id), design = getDraft();
  if (!design.pdfSource) return;
  document.body.classList.add('pdf-source-editor');
  const manifest = await readPdfDesign(design.pdfSource.pdfId);
  let selected = 0, selectedText = '';
  const sourcePage = () => manifest.pages.find(page => page.page === getDraft().pdfSource.pages[selected].page);
  function refreshPages() {
    $('pdf-page-select').replaceChildren(...getDraft().pdfSource.pages.map((page, index) => { const option = document.createElement('option'); option.value = index; option.textContent = `${index + 1}. ${page.label || `元PDF ${page.page}ページ`}`; return option; }));
    selected = Math.min(selected, getDraft().pdfSource.pages.length - 1); $('pdf-page-select').value = selected;
    const page = getDraft().pdfSource.pages[selected]; $('pdf-page-label').value = page.label;
    $('pdf-page-metrics').textContent = `元PDF ${page.page}ページ / ${Math.round(sourcePage().width)} × ${Math.round(sourcePage().height)}。図版・罫線・文字位置は原本を保持します。`;
    $('pdf-text-select').replaceChildren(...sourcePage().texts.filter(text => text.editable).map(text => { const option = document.createElement('option'); option.value = text.id; option.textContent = text.text.slice(0, 60); return option; }));
    selectedText = $('pdf-text-select').value; refreshText();
    $('delete-pdf-page').disabled = getDraft().pdfSource.pages.length <= 1;
    $('pdf-page-up').disabled = selected === 0; $('pdf-page-down').disabled = selected === getDraft().pdfSource.pages.length - 1;
  }
  function refreshText() {
    const text = sourcePage().texts.find(item => item.id === selectedText);
    $('pdf-text-fields').disabled = !text;
    if (!text) return;
    const edit = getDraft().pdfSource.pages[selected].edits.find(item => item.id === selectedText) ?? {};
    $('pdf-text-value').value = edit.text ?? text.text;
    for (const key of ['x', 'y', 'width', 'fontSize', 'color']) $(`pdf-text-${key}`).value = edit[key] ?? (key === 'color' ? text[key] : Math.round(text[key] * 100) / 100);
    $('pdf-text-hidden').checked = edit.hidden ?? false;
    $('pdf-text-fit').checked = edit.fit !== false;
    onTextSelect(selectedText);
  }
  $('pdf-source-edit-section').hidden = false;
  $('pdf-page-select').addEventListener('change', event => { selected = Number(event.target.value); refreshPages(); onPreviewSlot(selected); });
  $('pdf-text-select').addEventListener('change', event => { selectedText = event.target.value; refreshText(); });
  $('pdf-page-label').addEventListener('input', event => { getDraft().pdfSource.pages[selected].label = event.target.value; const option = $('pdf-page-select').selectedOptions[0]; if (option) option.textContent = `${selected + 1}. ${event.target.value}`; onChange(); });
  for (const [id, offset] of [['pdf-page-up', -1], ['pdf-page-down', 1]]) $(id).addEventListener('click', () => { const pages = getDraft().pdfSource.pages; [pages[selected], pages[selected + offset]] = [pages[selected + offset], pages[selected]]; selected += offset; refreshPages(); onChange(); onPreviewSlot(selected); });
  $('duplicate-pdf-page').addEventListener('click', () => { const pages = getDraft().pdfSource.pages; if (pages.length >= 60) return; pages.splice(selected + 1, 0, structuredClone(pages[selected])); selected++; refreshPages(); onChange(); onPreviewSlot(selected); });
  $('delete-pdf-page').addEventListener('click', () => { const pages = getDraft().pdfSource.pages; if (pages.length <= 1) return; pages.splice(selected, 1); refreshPages(); onChange(); onPreviewSlot(selected); });
  function applyText() {
    if (!selectedText) return;
    const original = sourcePage().texts.find(item => item.id === selectedText), edits = getDraft().pdfSource.pages[selected].edits;
    let edit = edits.find(item => item.id === selectedText); if (!edit) { edit = { id: selectedText }; edits.push(edit); }
    edit.text = $('pdf-text-value').value; edit.hidden = $('pdf-text-hidden').checked; edit.fit = $('pdf-text-fit').checked;
    for (const key of ['x', 'y', 'width', 'fontSize', 'color']) {
      const value = key === 'color' ? $(`pdf-text-${key}`).value : Number($(`pdf-text-${key}`).value);
      if (key !== 'color' && Math.abs(value - original[key]) < .015) delete edit[key]; else edit[key] = value;
    }
    onChange();
  }
  $('apply-pdf-text').addEventListener('click', applyText);
  $('pdf-text-value').addEventListener('input', applyText);
  $('reset-pdf-text').addEventListener('click', () => { const page = getDraft().pdfSource.pages[selected]; page.edits = page.edits.filter(edit => edit.id !== selectedText); refreshText(); onChange(); onPreviewSlot(selected); });
  refreshPages(); onPreviewSlot(0);
  return { select(index) { selected = index; refreshPages(); onPreviewSlot(selected); }, selectText(id) { if (!sourcePage().texts.some(text => text.id === id && text.editable)) return; selectedText = id; $('pdf-text-select').value = id; refreshText(); } };
}
