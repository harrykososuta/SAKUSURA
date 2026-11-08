// どの画面からでも Ctrl+K（Macは ⌘K）で開く検索パレット。
// スライドを名前・演題番号・カテゴリ・フォルダーで探して再生・編集を開く／この画面の操作（書き出し・発表を始める・保存など）を呼ぶ／画面を移る。
// 操作は、画面にあるボタンを押すのと同じ（ボタンが無い・押せない状態のときは候補に出さない）。
import { CATEGORIES, plainText } from './core.js';
import { norm, rank, HOME_COMMAND } from './command-search.js';

const PAGE = location.pathname === '/' || location.pathname === '/player' ? 'player' : location.pathname === '/editor' ? 'editor' : 'other';
const enc = encodeURIComponent;

// この画面の操作：画面にあるボタンのID・候補に出す名前・検索用の言葉。
const PAGE_COMMANDS = {
  player: [
    ['start-presentation', '発表を始める', 'はっぴょう プレゼン 本番 zoom 外部モニター'],
    ['presenter', '発表者ビューを開く', 'はっぴょうしゃ 原稿 ノート presenter S'],
    ['fullscreen', '全画面プレゼン', 'ぜんがめん fullscreen F'],
    ['record', '録画モード', 'ろくが obs record R'],
    ['play', '再生 / 一時停止', 'さいせい play space'],
    ['restart', '最初から再生', 'さいしょ restart'],
    ['pdf', 'PDFを書き出す', 'pdf 印刷 配布資料'],
    ['thumbnail', 'サムネイルをJPGで保存', 'さむねいる jpg 画像'],
    ['export', '動画を書き出す', 'mp4 動画 render'],
    ['export-silent', '無音で動画を書き出す', 'mp4 無音 silent'],
    ['preview', '無音リハーサルの入 / 切', 'むおん りはーさる preview'],
  ],
  editor: [
    ['save', '保存する', 'ほぞん save ctrl+s'],
    ['undo', '元に戻す', 'もとにもどす undo'],
    ['redo', 'やり直す', 'やりなおす redo'],
    ['slide-insert', 'スライドを挿入', 'そうにゅう 他の講義 コピー insert'],
    ['tts-prepare', '音声を生成・更新', 'tts 音声 なれーしょん'],
    ['fit', '画面に合わせる', 'ずーむ fit'],
    ['audio-toggle', 'ナレーション欄の表示 / 非表示', 'なれーしょん 原稿'],
    ['download', 'JSONを控える', 'json ばっくあっぷ'],
  ],
  other: [],
};
const PAGES = [
  HOME_COMMAND,
  ['ライブラリ', '/library', 'らいぶらり 一覧 library フォルダー'],
  ['再生画面', '/player', 'さいせい player'],
  ['編集画面', '/editor', 'へんしゅう editor'],
  ['デザイン一覧', '/design', 'でざいん テンプレート design'],
  ['設定', '/settings', 'せってい 配色 ダーク settings'],
];

const usable = id => {
  const element = document.getElementById(id);
  return element && !element.disabled && !element.hidden && !element.closest('[hidden]') ? element : null;
};
const currentLecture = () => new URLSearchParams(location.search).get('lecture') || document.getElementById('lecture-select')?.value || '';

// 同じ種類の画面なら、画面の切り替え（未保存の確認などを含む）を使って開く。違う画面なら移る。
function openLecture(kind, name) {
  const select = document.getElementById('lecture-select');
  if (kind === PAGE && select && [...select.options].some(option => option.value === name)) {
    select.value = name; select.dispatchEvent(new Event('change', { bubbles: true })); return;
  }
  location.href = kind === 'editor' ? `/editor?lecture=${enc(name)}` : `/?lecture=${enc(name)}`;
}

let lectures = null, fetchedAt = 0, loadingLectures = null;
// 一覧の取得は0.5秒ほどかかる。同時に何度も取りに行かない。
function loadLectures() {
  if (lectures && Date.now() - fetchedAt < 30000) return Promise.resolve(lectures);
  loadingLectures ??= fetch('/api/lectures', { cache: 'no-store' }).then(response => response.json())
    .then(list => { lectures = list; fetchedAt = Date.now(); return list; }, () => { lectures ??= []; return lectures; })
    .finally(() => { loadingLectures = null; });
  return loadingLectures;
}

function lectureItems(list) {
  const current = currentLecture();
  return list.filter(item => !item.demo).map(item => {
    const number = /^\d+$/.test(item.number ?? '') ? String(item.number).padStart(2, '0') : item.number;
    const category = CATEGORIES[item.category]?.name ?? item.category ?? '';
    const primary = PAGE === 'editor' ? 'editor' : 'player';
    return {
      group: 'スライド', kind: 'lecture', name: item.name,
      label: `${number ? `#${number} ` : ''}${plainText(item.title)}`,
      sub: [category, `${item.slides}枚`, item.folderPath, item.name === current ? '表示中' : ''].filter(Boolean).join(' · '),
      keywords: `${item.name} ${item.number ? `#${item.number} ${number} 第${item.number}` : ''} ${category} ${item.folderPath ?? ''} ${item.description ?? ''}`,
      exact: item.number ? [norm(item.number), norm(number), norm(`#${item.number}`), norm(`#${number}`)] : [],
      run: () => openLecture(primary, item.name),
      alt: { label: primary === 'editor' ? '再生' : '編集', run: () => openLecture(primary === 'editor' ? 'player' : 'editor', item.name) },
      primaryLabel: primary === 'editor' ? '編集' : '再生',
    };
  });
}
function commandItems() {
  return PAGE_COMMANDS[PAGE].filter(([id]) => usable(id)).map(([id, label, keywords]) => ({ group: 'この画面の操作', kind: 'command', label, keywords, run: () => usable(id)?.click() }));
}
function pageItems() {
  const lecture = currentLecture();
  return [{ group: '画面を移る', kind: 'page', label: 'キー操作の一覧', keywords: 'ショートカット キー 操作 help ?', run: () => setTimeout(toggleHelp) }, ...PAGES.filter(([, href]) => !(href === '/player' && PAGE === 'player') && !(href === '/editor' && PAGE === 'editor'))
    .map(([label, href, keywords]) => ({ group: '画面を移る', kind: 'page', label, keywords, run: () => { location.href = lecture && ['/player', '/editor'].includes(href) ? `${href === '/player' ? '/' : href}?lecture=${enc(lecture)}` : href; } }))];
}

// パレット・検索ボタン・キー操作の一覧の見た目（最初に1回だけ読み込む）。
function loadStyles() {
  if (document.querySelector('link[href="/src/command-palette.css"]')) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/src/command-palette.css'; document.head.append(link);
}
function build() {
  loadStyles();
  const dialog = document.createElement('dialog'); dialog.className = 'cmdk'; dialog.setAttribute('aria-label', '検索パレット');
  dialog.innerHTML = `<div class="cmdk-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" placeholder="スライド名・演題番号（48 など）・操作を検索" aria-label="検索" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div><div class="cmdk-list" role="listbox"></div><div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> 選ぶ</span><span><kbd>Enter</kbd> 開く・実行</span><span><kbd>Shift</kbd>+<kbd>Enter</kbd> ${PAGE === 'editor' ? '再生' : '編集'}で開く</span><span class="cmdk-count"></span></div>`;
  document.body.append(dialog);
  return dialog;
}

let dialog = null, input, list, results = [], active = 0, all = [];
function render() {
  const query = input.value;
  // 何も入力していないときは、この画面の操作・最近更新したスライド8件・画面の移動。
  const pool = query.trim() ? all : [...all.filter(item => item.kind === 'command'), ...all.filter(item => item.kind === 'lecture').slice(0, 8), ...all.filter(item => item.kind === 'page')];
  results = rank(pool, query).slice(0, 60);
  active = Math.min(active, Math.max(0, results.length - 1));
  list.replaceChildren();
  let group = '';
  results.forEach((item, index) => {
    if (item.group !== group) { group = item.group; const head = document.createElement('div'); head.className = 'cmdk-group'; head.textContent = query.trim() || item.kind !== 'lecture' ? group : '最近更新したスライド'; list.append(head); }
    const row = document.createElement('div');
    row.className = 'cmdk-item'; row.setAttribute('role', 'option'); row.dataset.index = String(index);
    row.setAttribute('aria-selected', String(index === active));
    const text = document.createElement('span'); text.className = 'cmdk-text';
    const label = document.createElement('strong'); label.textContent = item.label; text.append(label);
    if (item.sub) { const sub = document.createElement('small'); sub.textContent = item.sub; text.append(sub); }
    row.append(text);
    if (item.alt) {
      const actions = document.createElement('span'); actions.className = 'cmdk-actions';
      for (const [name, run] of [[item.primaryLabel, item.run], [item.alt.label, item.alt.run]]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = name;
        button.addEventListener('click', event => { event.stopPropagation(); close(); run(); });
        actions.append(button);
      }
      row.append(actions);
    }
    row.addEventListener('mousemove', () => { if (active !== index) { active = index; paintActive(); } });
    row.addEventListener('click', () => choose(index));
    list.append(row);
  });
  if (!lectures && loadingLectures) { const wait = document.createElement('p'); wait.className = 'cmdk-empty'; wait.textContent = 'スライドの一覧を読み込み中…'; list.append(wait); }
  else if (!results.length) { const empty = document.createElement('p'); empty.className = 'cmdk-empty'; empty.textContent = '見つかりません。言葉を減らすか、演題番号で探してください。'; list.append(empty); }
  dialog.querySelector('.cmdk-count').textContent = query.trim() ? `${results.length}件` : '';
}
function paintActive() {
  for (const row of list.querySelectorAll('.cmdk-item')) row.setAttribute('aria-selected', String(Number(row.dataset.index) === active));
  list.querySelector(`.cmdk-item[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
}
let pendingChoice = null;
function choose(index, alternate = false) {
  const item = results[index];
  // 一覧の読み込み中に Enter を押したら、読み込み後の検索結果で実行する。
  if (!item || (!lectures && loadingLectures && input.value.trim())) { if (loadingLectures) pendingChoice = { alternate }; return; }
  close();
  (alternate && item.alt ? item.alt.run : item.run)();
}
function close() { if (dialog?.open) dialog.close(); }
async function open() {
  if (document.body.classList.contains('recording') || document.fullscreenElement) return;
  if (!dialog) { dialog = build(); input = dialog.querySelector('input'); list = dialog.querySelector('.cmdk-list'); bindPalette(); }
  if (dialog.open) { close(); return; }
  input.value = ''; active = 0; pendingChoice = null;
  all = [...commandItems(), ...lectureItems(lectures ?? []), ...pageItems()];
  render();
  dialog.showModal(); input.focus();
  all = [...commandItems(), ...lectureItems(await loadLectures()), ...pageItems()];
  if (dialog.open) { render(); if (pendingChoice) { const { alternate } = pendingChoice; pendingChoice = null; choose(active, alternate); } }
}
function bindPalette() {
    input.addEventListener('input', () => { active = 0; render(); });
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); active = Math.min(results.length - 1, active + 1); paintActive(); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); active = Math.max(0, active - 1); paintActive(); }
      else if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); choose(active, event.shiftKey); }
      else if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); close(); }
    });
    // パレットの中のキー（Esc を含む）は、裏の画面のショートカット（Space で再生、Esc で選択解除など）に渡さない。
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
}

document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.code === 'KeyK') { event.preventDefault(); event.stopPropagation(); void open(); }
}, true);

// ---- ? キー：この画面のキー操作の一覧 ----
const COMMON_KEYS = [['Ctrl+K', 'スライドや操作を検索（検索パレット）'], ['?', 'この一覧を開く / 閉じる']];
const PAGE_KEYS = {
  player: [
    ['Space', '再生 / 一時停止（音声付き）'], ['← / →', '前 / 次のスライド'], ['F', '全画面プレゼン'], ['S', '発表者ビューを開く'], ['R', '録画モード（操作画面を隠す）'],
    ['→ ↓ PageDown Enter・クリック', '発表中：要点を1つずつ表示（音声なし）'], ['← ↑ PageUp Backspace・右クリック', '発表中：1つ戻す'],
    ['B / W', '発表中：黒画面 / 白画面'], ['L', '発表中：レーザーポインター'], ['P', '発表中：ペン（1〜5で色、Ctrl+Zで1本戻す、Eで全消去）'],
    ['Z・ホイール', '発表中：拡大 / 解除（拡大中はドラッグで移動）'], ['G', '発表中：スライド一覧'], ['Esc', '全画面・録画モードを終える'],
  ],
  editor: [
    ['Ctrl+S', '保存'], ['Ctrl+Z / Ctrl+Shift+Z（Ctrl+Y）', '元に戻す / やり直す'], ['ダブルクリック', '文字を直接編集（1行の欄は Enter、複数行は Ctrl+Enter で確定）'],
    ['矢印キー', '選んだ文字・画像・図形を1px動かす（Shift で8px）'], ['Delete / Backspace', '選んだ本文・画像・図形を削除'], ['Esc', '選択を外す・編集をやめる'], ['Ctrl+ホイール', 'スライドの表示を拡大 / 縮小'],
    ['↑ / ↓（左の一覧）', 'スライドを選ぶ（Shift で範囲選択）'], ['Ctrl+↑ / Ctrl+↓（左の一覧）', '選んだスライドを並べ替え'],
    ['Ctrl+C / X / V（左の一覧）', 'スライドをコピー / 切り取り / 貼り付け'], ['Ctrl+D（左の一覧）', 'スライドを複製'], ['Delete（左の一覧）', 'スライドを削除'],
  ],
  library: [['Delete', '選んだスライド・フォルダーをごみ箱へ'], ['Ctrl+クリック', 'フォルダーを複数選択'], ['ドラッグ', 'スライドやフォルダーを移動']],
  other: [],
};
const pageKind = () => PAGE !== 'other' ? PAGE : location.pathname === '/library' ? 'library' : 'other';
let help = null;
function toggleHelp() {
  if (document.body.classList.contains('recording') || document.fullscreenElement) return;
  if (!help) {
    if (!dialog) { dialog = build(); input = dialog.querySelector('input'); list = dialog.querySelector('.cmdk-list'); bindPalette(); }
    help = document.createElement('dialog'); help.className = 'cmdk cmdk-help'; help.setAttribute('aria-label', 'キー操作の一覧');
    const rows = [...PAGE_KEYS[pageKind()], ...COMMON_KEYS];
    help.innerHTML = '<div class="cmdk-search"><strong class="cmdk-help-title">キー操作の一覧</strong><kbd>Esc</kbd></div><div class="cmdk-list"><dl class="cmdk-keys"></dl></div><div class="cmdk-foot"><span>文字の入力中は、矢印などのキーは文字の操作に使われます。</span></div>';
    help.querySelector('.cmdk-keys').append(...rows.flatMap(([keys, label]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = keys; dd.textContent = label; return [dt, dd]; }));
    help.addEventListener('click', event => { if (event.target === help) help.close(); });
    help.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape' || event.key === '?') { event.preventDefault(); help.close(); } });
    document.body.append(help);
  }
  if (help.open) help.close(); else { close(); help.showModal(); }
}
const typing = target => target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
document.addEventListener('keydown', event => {
  if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || typing(event.target)) return;
  if (document.querySelector('dialog[open]:not(.cmdk-help)')) return;
  event.preventDefault(); toggleHelp();
});

// 上のメニューに「検索」ボタンを足す（キーを知らなくても使えるように）。
function addLauncher() {
  const nav = document.querySelector('.app-nav') ?? document.querySelector('.library-header nav, .design-header nav');
  if (!nav || nav.querySelector('.cmdk-launcher')) return;
  loadStyles();
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'cmdk-launcher'; button.title = 'スライドや操作を検索（Ctrl+K）';
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span>検索</span><kbd>Ctrl K</kbd>';
  button.addEventListener('click', () => void open());
  nav.append(button);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addLauncher); else addLauncher();
// 開いた瞬間に一覧が出るよう、画面の表示が落ち着いたら講義の一覧を先に読んでおく（収録・書き出し中は読まない）。
if (new URLSearchParams(location.search).get('record') !== '1') setTimeout(() => void loadLectures(), 2000);
window.sakusuraPalette = { open, close, toggleHelp };
