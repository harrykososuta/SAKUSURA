// 「発表を始める」の選択画面。発表の形（外部モニター・Zoomなどで共有・1画面・通し練習）を選ぶと、
// 全画面・発表者ビュー・ウィンドウの配置までを src/player.js が整える。ここは選択画面の表示と案内だけを受け持つ。
export const START_MODES = ['monitor', 'share', 'mirror', 'rehearsal'];

// 2台目の画面の検出（Chromeの screen.isExtended）。対応していないブラウザでは「わからない」として扱う。
export const extendedDisplay = () => typeof window !== 'undefined' && 'isExtended' in window.screen ? window.screen.isExtended : null;

export function initStartDialog({ dialog, onChoose }) {
  const notice = dialog.querySelector('[data-start-notice]');
  const fromStart = dialog.querySelector('[data-start-first]');
  const options = [...dialog.querySelectorAll('[data-start]')];
  let busy = false;

  const say = (message, tone = 'info') => { notice.hidden = !message; notice.textContent = message || ''; notice.dataset.tone = tone; };
  // 2台目の画面があれば「外部モニター」をおすすめにし、なければその旨を添える。
  function refresh() {
    const extended = extendedDisplay();
    for (const option of options) option.classList.remove('is-recommended');
    const monitor = dialog.querySelector('[data-start="monitor"]');
    monitor.querySelector('[data-start-state]').textContent = extended === true ? '2台目の画面を検出しました' : extended === false ? '2台目の画面が見つかりません' : '';
    monitor.dataset.available = String(extended !== false);
    if (extended) monitor.classList.add('is-recommended');
  }
  async function choose(mode) {
    if (busy) return;
    busy = true; say('');
    try { await onChoose(mode, { fromStart: fromStart.checked, say, close }); }
    finally { busy = false; }
  }
  function open() { if (dialog.open) return; refresh(); say(''); dialog.showModal(); (dialog.querySelector('.is-recommended') ?? options[0]).focus(); }
  function close() { if (dialog.open) dialog.close(); }

  for (const option of options) option.addEventListener('click', () => void choose(option.dataset.start));
  dialog.addEventListener('click', event => { if (event.target === dialog || event.target.closest('[data-start-close]')) close(); });
  // 1〜4 のキーでも選べる。
  dialog.addEventListener('keydown', event => {
    const match = event.code.match(/^(?:Digit|Numpad)([1-4])$/);
    if (match && !event.ctrlKey && !event.altKey && !event.metaKey) { event.preventDefault(); void choose(START_MODES[match[1] - 1]); }
  });
  window.screen.addEventListener?.('change', () => { if (dialog.open) refresh(); });
  return { open, close };
}
