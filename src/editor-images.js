import { IMAGE_LAYOUTS } from './core.js';
import { fullCrop, validCrop, croppedPoint } from './image-data.js';

export function initEditorImages({ current, commit }) {
  const $ = id => document.getElementById(id);
  const button = document.createElement('button'); button.id = 'image-add'; button.type = 'button'; button.textContent = '画像'; button.title = '画像を追加・差し替え・トリミング';
  document.querySelector('.add-shapes').append(button);
  const dialog = document.createElement('dialog'); dialog.id = 'image-dialog'; dialog.className = 'image-dialog'; dialog.setAttribute('aria-labelledby', 'image-title');
  dialog.innerHTML = `<div class="feature-head"><h2 id="image-title">画像を追加・差し替え</h2><button id="image-close" type="button" aria-label="閉じる">×</button></div>
    <div class="image-dialog-body"><div><label class="field">画像ファイル（PNG・JPEG・WebP、10MBまで）<input id="image-file" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"></label>
    <div id="image-preview" class="image-preview"><img id="image-preview-img" alt="編集中の画像"><div id="image-crop-box"></div><div id="image-label-points"></div></div>
    <p class="feature-note">画像上をドラッグして使う範囲を選びます。元画像は残り、トリミングは後から変更できます。</p></div>
    <div class="image-options"><label class="field">画像の説明<input id="image-alt" type="text" maxlength="500" placeholder="何を表す画像か"></label>
    <h3>トリミング（画像全体に対する％）</h3><div class="number-grid"><label>左から<input id="crop-x" type="number" min="0" max="99" step="0.1"></label><label>上から<input id="crop-y" type="number" min="0" max="99" step="0.1"></label><label>幅<input id="crop-width" type="number" min="1" max="100" step="0.1"></label><label>高さ<input id="crop-height" type="number" min="1" max="100" step="0.1"></label></div>
    <button id="image-crop-reset" type="button">画像全体を使う</button><section id="image-label-editor" hidden><h3>構造ラベルの位置</h3><p class="feature-note">ラベルを選んで、画像上の構造をクリックしてください。差し替え時はすべてのラベルを指定します。</p><label class="field">位置を指定するラベル<select id="image-label-select"></select></label><label class="field">文字を置く向き<select id="image-label-side"><option value="left">左</option><option value="right">右</option><option value="top">上</option><option value="bottom">下</option></select></label><button id="image-label-finish" type="button">範囲の選択に戻る</button></section></div></div>
    <p id="image-status" class="feature-status" role="status"></p><div class="feature-foot"><button id="image-cancel" type="button">キャンセル</button><button id="image-apply" class="primary" type="button" disabled>画像を適用</button></div>`;
  document.body.append(dialog);
  let context, original, entry, file, crop = fullCrop(), labelPositions = [], placed = new Set(), labelMode = false, drag = null, dataUrl = '', decoding = false, uploading = false, operation = 0;
  const img = $('image-preview-img');
  const status = message => { $('image-status').textContent = message; };
  function sync() {
    const state = current();
    const allowed=IMAGE_LAYOUTS.includes(state.slide?.layout)||state.slide?.layout==='document';
    button.disabled = !state.lecture || state.busy || !allowed;
    button.title = state.slide && !allowed ? '画像はサムネイル・要点・図と要点のページに追加できます' : '画像を追加・差し替え・トリミング';
  }
  function validate() {
    const missing = labelPositions.some(p => !placed.has(p.text));
    const outside = labelPositions.some(p => { const q = croppedPoint(p, crop); return q.x < 0 || q.y < 0 || q.x > 1 || q.y > 1; });
    $('image-apply').disabled = uploading || decoding || !img.naturalWidth || !validCrop(crop) || !$('image-alt').value.trim() || missing || outside;
    if (missing) status('画像上で、すべての構造ラベルの位置をクリックしてください。');
    else if (outside) status('構造ラベルがトリミング範囲の外にあります。範囲またはラベル位置を調整してください。');
    else if (!uploading && !decoding) status(!validCrop(crop) ? 'トリミング範囲を画像内に収めてください。' : '適用後に「保存する」で講義へ保存します。');
  }
  function draw() {
    const box = $('image-crop-box');
    Object.assign(box.style, { left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` });
    $('image-label-points').replaceChildren();
    for (const point of labelPositions) {
      const node = document.createElement('span'); node.className = 'image-edit-point'; node.textContent = point.text; node.style.left = `${100 * point.x}%`; node.style.top = `${100 * point.y}%`; node.classList.toggle('needs-position', !placed.has(point.text)); $('image-label-points').append(node);
    }
    $('image-preview').classList.toggle('label-mode', labelMode);
    validate();
  }
  function syncCropInputs() { for (const key of ['x', 'y', 'width', 'height']) $(`crop-${key}`).value = Math.round(crop[key] * 1000) / 10; }
  function syncLabels() {
    const selected = $('image-label-select').value;
    $('image-label-select').replaceChildren(...labelPositions.map(p => { const option = document.createElement('option'); option.value = p.text; option.textContent = `${!placed.has(p.text) ? '未指定 · ' : ''}${p.text}`; return option; }));
    if (labelPositions.some(p => p.text === selected)) $('image-label-select').value = selected;
    $('image-label-editor').hidden = !labelPositions.length;
    $('image-label-side').value = labelPositions.find(p => p.text === $('image-label-select').value)?.side ?? 'right';
  }
  async function preview(url, op) {
    decoding = true; $('image-apply').disabled = true;
    // decode中に前の画像の大きさを使わない。
    img.removeAttribute('src'); img.src = url;
    try {
      await img.decode(); if (op !== operation || !dialog.open) return;
      if (img.naturalWidth * img.naturalHeight > 80000000) throw new Error('画像が大きすぎます。8000万画素以内に縮小してください。');
      decoding = false; draw();
    } catch (error) {
      if (op !== operation) return;
      decoding = false; img.removeAttribute('src'); $('image-apply').disabled = true;
      status(error.message?.includes('画素') ? error.message : '画像を読み込めません。PNG・JPEG・WebPのファイルを選び直してください。');
    }
  }
  function open() {
    const state = current(); if (state.busy || !IMAGE_LAYOUTS.includes(state.slide?.layout)&&state.slide?.layout!=='document') return;
    context = { name: state.name, slideId: state.slide.id, ...(state.blockId?{blockId:state.blockId}:{}) }; original = structuredClone(state.image ?? state.slide.image ?? {}); entry = state.entry; file = null; dataUrl = ''; labelMode = false; decoding = false; placed = new Set();
    crop = structuredClone(original.crop ?? fullCrop()); labelPositions = (original.labels ?? []).map((text, i) => structuredClone((original.labelPositions ?? entry?.labels ?? []).find(p => p.text === text) ?? { text, x: .3 + i * .04, y: .5, side: 'right' }));
    placed = new Set((original.labelPositions ?? entry?.labels ?? []).filter(p => [p.x, p.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1) && ['left', 'right', 'top', 'bottom'].includes(p.side)).map(p => p.text));
    labelMode = labelPositions.some(p => !placed.has(p.text));
    $('image-file').value = ''; $('image-alt').value = original.alt ?? ''; $('image-title').textContent = original.file ? '画像を差し替え・トリミング' : '画像を追加';
    img.removeAttribute('src'); syncCropInputs(); syncLabels(); dialog.showModal(); const op = ++operation;
    if (entry?.ready) void preview(entry.url, op); else { status('画像ファイルを選んでください。'); $('image-apply').disabled = true; }
  }
  $('image-file').addEventListener('change', async event => {
    const next = event.target.files[0]; if (!next) return;
    const op = ++operation; file = null; img.removeAttribute('src'); $('image-apply').disabled = true;
    if (!/\.(png|jpe?g|webp)$/i.test(next.name) || !next.size || next.size > 10 * 1024 * 1024) { status('PNG・JPEG・WebPの画像（10MBまで）を選んでください。'); return; }
    file = next; crop = fullCrop(); placed = new Set(); labelMode = labelPositions.length > 0; syncCropInputs(); syncLabels();
    if (!$('image-alt').value.trim()) $('image-alt').value = next.name.replace(/\.[^.]+$/, '');
    decoding = true;
    try {
      dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('画像を読み込めません。')); reader.readAsDataURL(next); });
      if (op === operation) await preview(dataUrl, op);
    } catch (error) { if (op === operation) { decoding = false; status(error.message); } }
  });
  for (const key of ['x', 'y', 'width', 'height']) $(`crop-${key}`).addEventListener('input', () => { crop[key] = $(`crop-${key}`).value === '' ? NaN : Number($(`crop-${key}`).value) / 100; draw(); });
  $('image-alt').addEventListener('input', validate);
  $('image-crop-reset').addEventListener('click', () => { crop = fullCrop(); labelMode = false; syncCropInputs(); draw(); });
  $('image-label-select').addEventListener('change', () => { labelMode = true; syncLabels(); draw(); });
  $('image-label-select').addEventListener('focus', () => { labelMode = true; draw(); });
  $('image-label-side').addEventListener('change', () => { const point = labelPositions.find(p => p.text === $('image-label-select').value); if (point) point.side = $('image-label-side').value; draw(); });
  $('image-label-finish').addEventListener('click', () => { labelMode = false; draw(); });
  const pointAt = event => { const r = $('image-preview').getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)) }; };
  $('image-preview').addEventListener('pointerdown', event => {
    if (event.button !== 0 || !img.naturalWidth || decoding || uploading) return;
    event.preventDefault();
    const point = pointAt(event);
    if (labelMode) {
      const item = labelPositions.find(p => p.text === $('image-label-select').value); if (!item) return;
      Object.assign(item, point); placed.add(item.text); syncLabels();
      const next = labelPositions.find(p => !placed.has(p.text)); if (next) $('image-label-select').value = next.text;
      $('image-label-side').value = labelPositions.find(p => p.text === $('image-label-select').value)?.side ?? 'right'; draw(); return;
    }
    drag = { id: event.pointerId, point, before: { ...crop } }; $('image-preview').setPointerCapture(event.pointerId);
  });
  $('image-preview').addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const p = pointAt(event), start = drag.point;
    crop = { x: Math.min(p.x, start.x), y: Math.min(p.y, start.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) }; syncCropInputs(); draw();
  });
  function finish(event) {
    if (!drag) return;
    if (event.type === 'pointercancel' || !validCrop(crop)) crop = drag.before;
    drag = null; syncCropInputs(); draw();
  }
  $('image-preview').addEventListener('pointerup', finish); $('image-preview').addEventListener('pointercancel', finish);
  $('image-preview').addEventListener('lostpointercapture', finish);
  $('image-apply').addEventListener('click', async () => {
    if ($('image-apply').disabled || !context) return;
    const state = current(); if (state.name !== context.name || state.slide?.id !== context.slideId || state.busy) { status('編集するページが変わりました。開き直してください。'); return; }
    uploading = true; $('image-apply').disabled = true; status('画像を保存しています…');
    dialog.querySelectorAll('input,select,button').forEach(node => { node.disabled = true; });
    let errorMessage = '';
    try {
      let nextEntry = entry;
      if (file) {
        const response = await fetch(`/api/lecture/images?name=${encodeURIComponent(context.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Studio-Editor': '1' }, body: file });
        nextEntry = await response.json(); if (!response.ok) throw new Error(nextEntry.error || '画像を保存できません。');
      }
      const image = { ...original, alt: $('image-alt').value.trim(), prompt: original.prompt || '利用者がアップロードした画像', file: nextEntry.file, crop: { ...crop } };
      if (labelPositions.length) image.labelPositions = structuredClone(labelPositions);
      if (file) delete image.revision;
      commit(context, image, { ...nextEntry, labels: labelPositions }); dialog.close();
    } catch (error) { errorMessage = error.message; }
    finally { uploading = false; dialog.querySelectorAll('input,select,button').forEach(node => { node.disabled = false; }); if (dialog.open) { validate(); if (errorMessage) status(errorMessage); } }
  });
  for (const id of ['image-close', 'image-cancel']) $(id).addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (uploading) event.preventDefault(); });
  dialog.addEventListener('close', () => { operation++; img.removeAttribute('src'); file = null; entry = null; context = null; dataUrl = ''; drag = null; button.focus(); });
  button.addEventListener('click', open);
  return { open, sync };
}
