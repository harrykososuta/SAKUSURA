// ツールの表示設定。講義データには含めず、このブラウザの localStorage に保存する。
const $ = id => document.getElementById(id);
const KEY = 'sakusura-ui-settings';
const VIEW_KEYS = ['sakusura-editor-slides-width', 'sakusura-editor-right-width', 'sakusura-library-expanded', 'sakusura-editor-audio-collapsed'];
export const THEMES = [
  { id: 'navy', name: 'ネイビー', note: '標準', colors: ['#263b60', '#547bb7', '#edf2f9'] },
  { id: 'teal', name: 'ティール', colors: ['#1f5a5e', '#3f9590', '#e6f3f2'] },
  { id: 'green', name: 'グリーン', colors: ['#2f5b3a', '#5a9a68', '#ebf4ec'] },
  { id: 'purple', name: 'パープル', colors: ['#3f3270', '#7b6cc2', '#f0edfa'] },
  { id: 'wine', name: 'ワイン', colors: ['#6b2f45', '#b56a85', '#f8ecf0'] },
  { id: 'graphite', name: 'グラファイト', colors: ['#2f3640', '#6b7686', '#eef0f3'] },
];
export const MODES = [
  { id: 'light', name: 'ライト', note: '明るい背景' },
  { id: 'dark', name: 'ダーク', note: '暗い背景' },
  { id: 'system', name: 'システムに合わせる', note: 'Windowsの設定に連動' },
];
const DEFAULTS = { mode: 'light', theme: 'navy', snap: true, librarySort: 'updated', libraryDensity: 'normal', uiFont: 'standard', uiScale: '1' };
export function readSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEFAULTS }; }
}
// 設定画面以外（ライブラリの表示切り替えなど）からも同じ設定に保存する。保存できなければ false。
export function saveSettings(patch) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...readSettings(), ...patch })); return true; } catch { return false; }
}
function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  if (!saveSettings(patch)) { showStatus('このブラウザでは設定を保存できません。', true); return next; }
  window.applyUiTheme?.();
  showStatus('設定を保存しました。開いている他の画面にも反映されます。');
  return next;
}
function showStatus(message, error = false) { $('settings-status').textContent = message; $('settings-status').classList.toggle('is-error', error); }

if ($('theme-options')) {
  const settings = readSettings();
  // 左のカテゴリで表示する設定を切り替える。URLの #appearance などで直接開ける。
  const panes = [...document.querySelectorAll('[data-pane]')].map(pane => pane.dataset.pane);
  const showPane = () => {
    const id = panes.includes(location.hash.slice(1)) ? location.hash.slice(1) : panes[0];
    for (const pane of document.querySelectorAll('[data-pane]')) pane.hidden = pane.dataset.pane !== id;
    for (const link of document.querySelectorAll('[data-pane-link]')) { if (link.dataset.paneLink === id) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }
  };
  window.addEventListener('hashchange', () => { showStatus(''); showPane(); });
  showPane();
  for (const mode of MODES) {
    const label = document.createElement('label'); label.className = `mode-option mode-${mode.id}`;
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'mode'; input.value = mode.id; input.checked = settings.mode === mode.id;
    input.addEventListener('change', () => writeSettings({ mode: mode.id }));
    const preview = document.createElement('span'); preview.className = 'mode-preview'; preview.setAttribute('aria-hidden', 'true');
    preview.append(document.createElement('i'), document.createElement('b'));
    const name = document.createElement('strong'); name.textContent = mode.name;
    const note = document.createElement('small'); note.textContent = mode.note;
    label.append(input, preview, name, note); $('mode-options').append(label);
  }
  for (const theme of THEMES) {
    const label = document.createElement('label'); label.className = 'theme-option';
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'theme'; input.value = theme.id; input.checked = settings.theme === theme.id;
    input.addEventListener('change', () => writeSettings({ theme: theme.id }));
    const swatch = document.createElement('span'); swatch.className = 'theme-swatch';
    for (const color of theme.colors) { const chip = document.createElement('span'); chip.style.background = color; swatch.append(chip); }
    const name = document.createElement('strong'); name.textContent = theme.name;
    label.append(input, swatch, name);
    if (theme.note) { const note = document.createElement('small'); note.textContent = theme.note; label.append(note); }
    $('theme-options').append(label);
  }
  for (const [id, key] of [['ui-font', 'uiFont'], ['ui-scale', 'uiScale']]) {
    $(id).value = String(settings[key]);
    if (!$(id).value) $(id).value = String(DEFAULTS[key]);
    $(id).addEventListener('change', event => writeSettings({ [key]: event.target.value }));
  }
  $('snap-default').checked = settings.snap;
  $('snap-default').addEventListener('change', event => writeSettings({ snap: event.target.checked }));
  let collapsed = false; try { collapsed = localStorage.getItem('sakusura-editor-audio-collapsed') === '1'; } catch {}
  $('audio-collapsed').checked = collapsed;
  $('audio-collapsed').addEventListener('change', event => {
    try { localStorage.setItem('sakusura-editor-audio-collapsed', event.target.checked ? '1' : ''); showStatus('設定を保存しました。開いている他の画面にも反映されます。'); }
    catch { showStatus('このブラウザでは設定を保存できません。', true); }
  });
  $('library-sort').value = settings.librarySort;
  $('library-sort').addEventListener('change', event => writeSettings({ librarySort: event.target.value }));
  $('library-density').value = settings.libraryDensity;
  $('library-density').addEventListener('change', event => writeSettings({ libraryDensity: event.target.value }));
  $('reset-view').addEventListener('click', () => {
    try { for (const key of VIEW_KEYS) localStorage.removeItem(key); } catch {}
    $('audio-collapsed').checked = false;
    showStatus('スライド一覧・右パネルの幅、フォルダーの開閉、原稿欄の開閉を初期状態に戻しました。');
  });
  $('reset-all').addEventListener('click', () => {
    try { localStorage.removeItem(KEY); for (const key of VIEW_KEYS) localStorage.removeItem(key); } catch {}
    location.reload();
  });
}
