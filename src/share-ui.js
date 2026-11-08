// 共有（ZIPの書き出し・取り込み）の画面部品。ライブラリ（src/library.js）とデザイン一覧（src/design-gallery.js）で使う。
// 書き出し・取り込みのダイアログはこの部品が作る。見た目は src/share.css、サーバー側は tools/lib/share-api.mjs、仕様は docs/SHARE.md。
const $ = id => document.getElementById(id);
const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
const MAX_UPLOAD = 1024 ** 3;
let ctx = null, exporting = null, pendingFile = null, working = false;

const DIALOGS = `
<dialog id="share-export-dialog" class="share-dialog"><form id="share-export-form"><span class="share-eyebrow">SHARE</span><h2 id="share-export-heading">共有ファイルに書き出す</h2><p class="share-export-name"><strong id="share-export-title"></strong></p><label class="share-field">送り主の名前<input id="share-export-author" type="text" maxlength="60" autocomplete="off" placeholder="例：山田 花子、〇〇病院 臨床工学室"></label><label id="share-export-audio-row" class="share-check"><input id="share-export-audio" type="checkbox" checked> <span>音声も入れる（外すとファイルが小さくなり、相手がTTSで作り直します）</span></label><p id="share-export-note" class="share-help"></p><p class="share-help">ZIPファイル1つをダウンロードします。メール・USB・Googleドライブなどで相手に渡してください。</p><p class="share-error" data-error role="alert" hidden></p><div class="share-actions"><button type="button" class="share-close">キャンセル</button><button id="share-export-submit" class="share-primary" type="submit">書き出す</button></div></form></dialog>
<dialog id="share-import-dialog" class="share-dialog"><form id="share-import-form"><span class="share-eyebrow">IMPORT</span><h2>共有ファイルを取り込む</h2><p id="share-import-file" class="share-help"></p><div id="share-import-summary"></div><ul id="share-import-warnings" class="share-warnings" hidden></ul><fieldset id="share-import-choice" hidden><legend id="share-import-conflict"></legend><label class="share-check"><input type="radio" name="share-mode" value="update"> <span id="share-mode-update-label">更新する</span></label><label class="share-check"><input type="radio" name="share-mode" value="copy"> <span id="share-mode-copy-label">別に残す</span></label></fieldset><p id="share-import-help" class="share-help"></p><p class="share-error" data-error role="alert" hidden></p><div class="share-actions"><button type="button" class="share-close">キャンセル</button><button id="share-import-submit" class="share-primary" type="submit">取り込む</button></div></form></dialog>`;

async function readJson(response) {
  let value = {};
  try { value = await response.json(); } catch { /* 本文なし */ }
  if (!response.ok) throw Object.assign(new Error(value.error || '操作に失敗しました。スタジオを再起動してください。'), { status: response.status, body: value });
  return value;
}
function setWorking(value, dialog) { working = value; for (const button of dialog.querySelectorAll('button')) button.disabled = value; }
function dialogError(dialog, message = '') { const el = dialog.querySelector('[data-error]'); el.textContent = message; el.hidden = !message; }
const fileNameOf = (response, fallback) => {
  const encoded = (response.headers.get('Content-Disposition') ?? '').match(/filename\*=UTF-8''([^;]+)/i);
  try { return encoded ? decodeURIComponent(encoded[1]) : fallback; } catch { return fallback; }
};

// 書き出し。target：{ kind:'lecture', name, title, format?, share? } または { kind:'design', id, title }
export async function openShareExport(target) {
  if (working || !ctx) return;
  exporting = target.kind ? target : { kind: 'lecture', ...target };
  const dialog = $('share-export-dialog'), lecture = exporting.kind === 'lecture';
  $('share-export-heading').textContent = lecture ? '共有ファイルに書き出す' : 'デザインを共有ファイルに書き出す';
  $('share-export-title').textContent = exporting.title;
  $('share-export-audio-row').hidden = !lecture || exporting.format === 'html';
  $('share-export-audio').checked = true;
  $('share-export-note').textContent = !lecture
    ? 'デザインテンプレートだけを書き出します。相手は「デザイン」画面またはライブラリの「共有ファイルを取り込む」で取り込みます。'
    : exporting.share ? `共有で受け取った講義です（送り主：${exporting.share.author || '不明'}）。手を加えずに書き出すと同じ共有ID・同じ版のまま転送し、手を加えていれば新しい共有IDで書き出します。`
    : '初めて書き出すときに共有ID（例 SKS-7F3K-92QD）を発行し、以後は同じIDで版を上げていきます。';
  dialogError(dialog);
  try { $('share-export-author').value = (await readJson(await fetch('/api/share/settings'))).author ?? ''; } catch { /* 名前は手入力 */ }
  dialog.showModal();
  ($('share-export-author').value ? $('share-export-submit') : $('share-export-author')).focus();
}
async function submitExport(event) {
  event.preventDefault();
  if (working || !exporting) return;
  const dialog = $('share-export-dialog'), author = $('share-export-author').value.trim(), lecture = exporting.kind === 'lecture';
  if (!author) { dialogError(dialog, '送り主の名前を入力してください（相手の画面に表示されます）。'); $('share-export-author').focus(); return; }
  setWorking(true, dialog); dialogError(dialog); $('share-export-submit').textContent = '書き出し中…';
  try {
    const body = lecture ? { lecture: exporting.name, author, audio: $('share-export-audio').checked } : { design: exporting.id, author };
    const response = await fetch(lecture ? '/api/share/export' : '/api/share/export-design', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Editor': '1' }, body: JSON.stringify(body) });
    if (!response.ok) await readJson(response);
    const blob = await response.blob(), name = fileNameOf(response, `${exporting.name ?? exporting.id}.zip`);
    const link = make('a'); link.href = URL.createObjectURL(blob); link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    const forwarded = response.headers.get('X-Share-Forwarded') === 'true';
    dialog.close();
    ctx.status(lecture
      ? `共有ファイル「${name}」を保存しました（共有ID ${response.headers.get('X-Share-Id')}・v${response.headers.get('X-Share-Revision')}${forwarded ? '・受け取ったまま転送' : ''}）。相手のSAKUSURAで「共有ファイルを取り込む」から選んでもらいます。`
      : `デザインの共有ファイル「${name}」を保存しました。相手のSAKUSURAの「デザイン」画面で「共有ファイルを取り込む」から選んでもらいます。`);
    await ctx.refresh?.();
  } catch (error) { dialogError(dialog, error.message); }
  finally { setWorking(false, dialog); $('share-export-submit').textContent = '書き出す'; }
}

// 取り込み
const STATE = { new: '新しく追加', same: '手元と同じ（そのまま）', different: '手元と中身が違う' };
function summaryRows(summary) {
  const list = make('dl', 'share-summary');
  const row = (label, value) => { if (value === undefined || value === null || value === '') return; list.append(make('dt', '', label), make('dd', '', String(value))); };
  row('種類', summary.kind === 'lecture' ? (summary.lecture?.type === 'html' ? 'HTMLスライド' : 'スライド') : 'デザインテンプレート');
  row('題名', summary.title);
  row('送り主', summary.author);
  row(summary.kind === 'lecture' ? '共有ID・版' : 'デザインID', summary.kind === 'lecture' ? `${summary.id}・v${summary.revision}` : summary.id);
  if (summary.originId) row('元の共有ID', `${summary.originId}（改変版）`);
  if (summary.exportedAt) row('作成日時', new Date(summary.exportedAt).toLocaleString('ja-JP'));
  if (summary.lecture) row('音声', summary.lecture.audio ? 'あり' : 'なし（取り込んだあとTTSで作れます）');
  for (const design of summary.designs) row('デザイン', `${design.name}（${STATE[design.state]}）`);
  return list;
}
async function inspectFile(file) {
  if (working || !ctx) return;
  ctx.showError?.('');
  if (!/\.zip$/i.test(file.name) && !['application/zip', 'application/x-zip-compressed'].includes(file.type)) { ctx.status('共有ファイル（.zip）を選んでください。', true); return; }
  if (file.size > MAX_UPLOAD) { ctx.status('共有ファイルは1GB以内にしてください。', true); return; }
  ctx.status(`「${file.name}」を確認しています…`);
  let summary;
  try { summary = await readJson(await fetch('/api/share/inspect', { method: 'POST', headers: { 'Content-Type': 'application/zip', 'X-Studio-Editor': '1' }, body: file })); }
  catch (error) { ctx.status(''); ctx.status(error.message, true); return; }
  ctx.status('');
  pendingFile = file;
  const dialog = $('share-import-dialog');
  $('share-import-file').textContent = file.name;
  $('share-import-summary').replaceChildren(summaryRows(summary));
  $('share-import-warnings').replaceChildren(...summary.warnings.map(text => make('li', '', text)));
  $('share-import-warnings').hidden = !summary.warnings.length;
  const conflict = summary.kind === 'lecture' ? summary.existing : summary.designs[0]?.state === 'different' ? summary.designs[0] : null;
  $('share-import-choice').hidden = !conflict;
  if (conflict) {
    $('share-import-conflict').textContent = summary.kind === 'lecture' ? `同じ共有IDのスライドがすでにあります（${summary.existing.slug}・v${summary.existing.revision}）。` : `同じデザイン（${conflict.name}）が、中身の違う状態ですでにあります。`;
    const newer = summary.kind !== 'lecture' || summary.revision > summary.existing.revision;
    dialog.querySelector(`input[name="share-mode"][value="${newer ? 'update' : 'copy'}"]`).checked = true;
    $('share-mode-update-label').textContent = summary.kind === 'lecture' ? '更新する（手元のスライドを新しい版に置き換え。元はバックアップ）' : '更新する（手元のデザインを置き換え）';
    $('share-mode-copy-label').textContent = summary.kind === 'lecture' ? '別に残す（新しいスライドとして追加）' : '別に残す（「（受け取り）」を付けて追加）';
  }
  $('share-import-help').textContent = summary.kind === 'lecture'
    ? '取り込んだスライドはライブラリの「共有で受け取った」に並びます。カテゴリは送り主のまま残り、「整理」で自分のカテゴリ・フォルダーへ移すとそこから外れます。'
    : '取り込んだデザインは「デザイン」画面の一覧に表示されます。';
  dialogError(dialog);
  dialog.showModal(); $('share-import-submit').focus();
}
async function submitImport(event) {
  event.preventDefault();
  if (working || !pendingFile) return;
  const dialog = $('share-import-dialog');
  const mode = $('share-import-choice').hidden ? '' : dialog.querySelector('input[name="share-mode"]:checked')?.value ?? '';
  setWorking(true, dialog); dialogError(dialog); $('share-import-submit').textContent = '取り込み中…';
  try {
    const result = await readJson(await fetch(`/api/share/import${mode ? `?mode=${mode}` : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/zip', 'X-Studio-Editor': '1' }, body: pendingFile }));
    dialog.close(); pendingFile = null;
    await ctx.refresh?.();
    if (result.kind === 'lecture') {
      ctx.onLectureImported?.(result);
      ctx.status(`「${result.title}」を${{ new: '取り込みました', copy: '別のスライドとして取り込みました', update: '新しい版に更新しました（元はバックアップ済み）' }[result.mode]}。ライブラリの「共有で受け取った」に並んでいます。`);
    } else ctx.status(result.designsImported.length ? `デザイン「${result.designsImported[0].name}」を取り込みました。一覧に表示されます。` : `デザイン「${result.title}」は手元と同じなので、そのまま使えます。`);
  } catch (error) {
    dialogError(dialog, error.message);
    if (error.status === 409 && error.body?.summary) $('share-import-choice').hidden = false;
  } finally { setWorking(false, dialog); $('share-import-submit').textContent = '取り込む'; }
}

// options：{ importButton, fileInput, status(text, isError), showError?(text), refresh?(), onLectureImported?(result) }
export function setupShare(options) {
  ctx = options;
  if (!$('share-export-dialog')) document.body.insertAdjacentHTML('beforeend', DIALOGS);
  $('share-export-form').addEventListener('submit', submitExport);
  $('share-import-form').addEventListener('submit', submitImport);
  for (const dialog of [$('share-export-dialog'), $('share-import-dialog')]) {
    dialog.addEventListener('cancel', event => { if (working) event.preventDefault(); });
    dialog.querySelector('.share-close').addEventListener('click', () => { if (!working) dialog.close(); });
  }
  options.importButton.addEventListener('click', () => { if (!working) options.fileInput.click(); });
  options.fileInput.addEventListener('change', () => { const [file] = options.fileInput.files; options.fileInput.value = ''; if (file) void inspectFile(file); });
  // ZIPを画面にドラッグして取り込む（画面内の要素のドラッグとは別。ファイルのドラッグだけ受ける）。
  const hasFiles = event => [...(event.dataTransfer?.types ?? [])].includes('Files');
  let depth = 0;
  document.addEventListener('dragenter', event => { if (!hasFiles(event)) return; depth++; document.body.classList.add('share-dropping'); });
  document.addEventListener('dragleave', event => { if (!hasFiles(event)) return; depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('share-dropping'); });
  document.addEventListener('dragover', event => { if (hasFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
  document.addEventListener('drop', event => {
    if (!hasFiles(event)) return;
    event.preventDefault(); depth = 0; document.body.classList.remove('share-dropping');
    if (document.querySelector('dialog[open]')) return;
    const [file] = event.dataTransfer.files;
    if (file) void inspectFile(file);
  });
}
