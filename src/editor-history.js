import { lectureChanges } from './history-data.js';
import { plainText } from './core.js';
import { ANIMATION_TYPES } from './animation.js';

export function initEditorHistory({ current, restore, miniature }) {
  const $ = id => document.getElementById(id);
  const menu = document.createElement('button'); menu.id = 'version-history'; menu.type = 'button'; menu.setAttribute('role', 'menuitem');
  menu.innerHTML = '<strong>保存履歴を比較・復元</strong><small>以前の内容と見比べて、全体または1ページを戻します</small>';
  document.querySelector('.more-menu').prepend(menu);
  const dialog = document.createElement('dialog'); dialog.id = 'history-dialog'; dialog.className = 'history-dialog'; dialog.setAttribute('aria-labelledby', 'history-title');
  dialog.innerHTML = `<div class="feature-head"><h2 id="history-title">保存履歴を比較・復元</h2><button id="history-close" type="button" aria-label="閉じる">×</button></div>
    <div class="history-controls"><label class="field">保存前の履歴<select id="history-version"></select></label><label class="field">比較するページ<select id="history-page"></select></label></div>
    <p id="history-status" class="feature-status" role="status"></p><div id="history-content" class="history-content"></div>
    <p class="feature-note">復元した内容は編集画面に読み込みます。「保存する」で確定し、その前は「元に戻す」で取り消せます。音声ファイルは戻しません。原稿を戻したページは音声の状態を再確認してください。</p>
    <div class="feature-foot"><button id="history-cancel" type="button">閉じる</button><button id="history-restore-page" type="button" disabled>このページを復元</button><button id="history-restore-all" class="primary" type="button" disabled>講義全体を復元</button></div>`;
  document.body.append(dialog);
  let openedName = '', snapshot = null, comparison = null, requestId = 0;
  const status = message => { $('history-status').textContent = message; };
  function disabled(value) { $('history-restore-page').disabled = value; $('history-restore-all').disabled = value; }
  const captions = { label: '小見出し', text: '文章', detail: '補足', alt: '画像の説明', prompt: '画像の制作指示', crop: 'トリミング', x: '左右', y: '上下', width: '幅', height: '高さ', labels: '構造ラベル', labelPositions: 'ラベル位置', checklist: '確認項目', side: '文字の向き', at: '時刻（秒）', target: '表示対象', kind: '種類', color: '色', size: '文字サイズ', angle: '角度', role: '話者', note: 'まとめの一文', title: '見出し', image: '画像', name: '名前', value: '値', unit: '単位', cells: '列の文章', row: '段', revision: '画像の修正依頼', file: '画像ファイル' };
  const terms = { title: 'サムネイル', statement: '要点', figure: '図と要点', flow: 'フロー図', message: '一文', agenda: 'アジェンダ', steps: '段階', compare: '比較', table: '表', takehome: 'Take Home Message', respiratory: 'カテゴリC', ecg: 'カテゴリB', va: 'カテゴリA', ai: '動き多め', strong: '濃いグレー', text: '薄いグレー', primary: '基本色', accent: 'アクセント色', left: '左', right: '右', top: '上', bottom: '下', rect: '四角', circle: '丸', arrow: '矢印', line: '線' };
  function describe(value, key = '') {
    if (value === undefined) return '（なし）';
    if (key === 'animation') return [`動き：${ANIMATION_TYPES[value.type] ?? value.type}`, `同時の項目：${value.stagger === false ? '同時に出す' : '0.09秒ずらす'}`, ...(value.limit !== undefined ? [`上限：${value.limit}`] : []), ...(value.verdicts?.length ? [`項目の判定：${value.verdicts.length}か所`] : []), ...(value.links?.length ? [`矢印の個別指定：${value.links.length}か所`] : [])].join('\n');
    if (key === 'css') return '講義のデザインが変更されています。プレビューで見比べてください。';
    if (key === 'file') return value.startsWith('upload-') ? 'アップロードした画像（プレビューを参照）' : '保存済みの画像（プレビューを参照）';
    if (key === 'crop') return `左 ${Math.round(value.x * 1000) / 10}％・上 ${Math.round(value.y * 1000) / 10}％\n幅 ${Math.round(value.width * 1000) / 10}％・高さ ${Math.round(value.height * 1000) / 10}％`;
    if (Array.isArray(value)) return value.length ? value.map((item, i) => `${i + 1}. ${describe(item)}`).join('\n\n') : '（なし）';
    if (value && typeof value === 'object') return Object.entries(value).filter(([k]) => k !== 'id').map(([k, v]) => `${captions[k] ?? k}：${describe(v, k)}`).join('\n');
    if (typeof value === 'boolean') return value ? 'あり' : 'なし';
    return ['layout', 'category', 'kind', 'side', 'color'].includes(key) ? terms[value] ?? String(value) : String(value);
  }
  function table(fields) {
    const table = document.createElement('table'); table.className = 'history-diff';
    const header = table.createTHead().insertRow();
    for (const text of ['変更箇所', '選んだ履歴', '現在の編集内容']) { const th = document.createElement('th'); th.textContent = text; header.append(th); }
    const body = table.createTBody();
    for (const field of fields) {
      const row = body.insertRow(); row.insertCell().textContent = field.label;
      for (const value of [field.before, field.current]) {
        const pre = document.createElement('pre'); pre.textContent = describe(value, field.key); row.insertCell().append(pre);
      }
    }
    return table;
  }
  function drawPage() {
    const area = $('history-content'); area.replaceChildren();
    if (!comparison) return;
    const id = $('history-page').value, item = comparison.pages.find(page => page.id === id);
    if (id === '@settings') {
      area.append(table(comparison.settings)); $('history-restore-page').disabled = true; return;
    }
    if (!item) return;
    const previews = document.createElement('div'); previews.className = 'history-previews';
    const now = current();
    for (const [title, deck, page, images] of [['選んだ履歴', snapshot.lecture, item.beforePage, snapshot.images], ['現在の編集内容', now.lecture, item.currentPage, now.images]]) {
      const pane = document.createElement('div'), heading = document.createElement('strong'); heading.textContent = title; pane.append(heading);
      if (page) pane.append(miniature(deck, page - 1, images)); else { const missing = document.createElement('p'); missing.textContent = 'この版にはありません'; pane.append(missing); }
      previews.append(pane);
    }
    area.append(previews);
    if (item.moved) { const note = document.createElement('p'); note.textContent = `並び順：履歴では${item.beforePage}枚目 → 現在は${item.currentPage}枚目`; area.append(note); }
    if (item.fields.length) area.append(table(item.fields));
    else { const note = document.createElement('p'); note.textContent = 'このページの内容に変更はありません。'; area.append(note); }
    $('history-restore-page').disabled = !item.before || !item.current || !item.fields.length;
  }
  async function choose() {
    const op = ++requestId, file = $('history-version').value;
    snapshot = null; comparison = null; disabled(true); $('history-page').replaceChildren(); $('history-content').replaceChildren();
    if (!file) return;
    status('履歴を読み込んでいます…');
    try {
      const response = await fetch(`/api/lecture/history?name=${encodeURIComponent(openedName)}&file=${encodeURIComponent(file)}`);
      const data = await response.json(); if (op !== requestId || !dialog.open) return;
      if (!response.ok) throw new Error(data.error || '履歴を読み込めません。');
      if (current().name !== openedName) return;
      snapshot = data; comparison = lectureChanges(data.lecture, current().lecture);
      const changed = comparison.pages.filter(item => item.fields.length || item.moved);
      for (const item of comparison.pages) {
        const option = document.createElement('option'); option.value = item.id;
        option.textContent = `${item.currentPage ?? '削除済み'} · ${plainText(item.current?.title ?? item.before.title)}${item.fields.length || item.moved ? '（変更あり）' : ''}`; $('history-page').append(option);
      }
      if (comparison.settings.length) { const option = document.createElement('option'); option.value = '@settings'; option.textContent = '講義全体の設定（変更あり）'; $('history-page').append(option); }
      const currentId = current().lecture.slides[current().index].id;
      $('history-page').value = currentId;
      status(`ページの変更 ${changed.length}件・講義全体の設定 ${comparison.settings.length}件。現在の編集内容（未保存の変更を含む）と比較しています。`);
      $('history-restore-all').disabled = !changed.length && !comparison.settings.length;
      drawPage();
    } catch (error) { if (op === requestId) status(error.message); }
  }
  async function open() {
    const state = current(); if (!state.lecture || state.busy) return;
    openedName = state.name; snapshot = null; comparison = null; disabled(true); $('history-version').replaceChildren(); $('history-page').replaceChildren(); $('history-content').replaceChildren();
    $('header-more').open = false; dialog.showModal(); status('保存履歴を読み込んでいます…');
    const op = ++requestId;
    try {
      const response = await fetch(`/api/lecture/history?name=${encodeURIComponent(openedName)}`);
      const result = await response.json(); if (op !== requestId || !dialog.open) return;
      if (!response.ok) throw new Error(result.error || '保存履歴を読み込めません。');
      for (const version of result.versions) {
        const option = document.createElement('option'); option.value = version.file;
        option.textContent = new Date(version.at).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hour12: false });
        $('history-version').append(option);
      }
      if (!result.versions.length) { status('保存履歴はまだありません。内容を変更して保存すると、保存前の版が残ります。'); return; }
      await choose();
    } catch (error) { if (op === requestId) status(error.message); }
  }
  function apply(all) {
    if (!snapshot || current().name !== openedName || current().busy) return;
    try { restore(snapshot, all ? null : $('history-page').value); dialog.close(); } catch (error) { status(error.message); }
  }
  menu.addEventListener('click', open); $('history-version').addEventListener('change', choose); $('history-page').addEventListener('change', drawPage);
  $('history-restore-page').addEventListener('click', () => apply(false)); $('history-restore-all').addEventListener('click', () => apply(true));
  for (const id of ['history-close', 'history-cancel']) $(id).addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { requestId++; snapshot = null; comparison = null; $('history-content').replaceChildren(); $('header-more').querySelector('summary').focus(); });
}
