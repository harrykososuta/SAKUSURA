// すべての画面の <head> で、type="module" を付けずに最初に読み込む。
// 1) 画面の部品の読み込みに失敗したとき、真っ白にせず、原因と対処（再起動・再読み込み）を表示する。
// 2) 起動中のサーバーが古いプログラムのままなら（別の作業でサーバーのファイルが更新されたなど）、上に知らせて再起動できるようにする。
// 収録・動画の書き出し・全画面の発表中・埋め込み表示（iframe）では、更新のお知らせを出さない（映り込みを防ぐ）。
(() => {
  const RETRY_KEY = `sakusura-reload:${location.pathname}`, DISMISS_KEY = 'sakusura-stale-dismissed';
  const params = new URLSearchParams(location.search);
  const embedded = window.top !== window;
  const quiet = () => embedded || params.get('record') === '1' || navigator.webdriver || !!document.fullscreenElement || document.body?.classList.contains('recording');
  const session = {
    get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { sessionStorage.setItem(key, value); } catch { /* 保存できない環境では毎回表示 */ } },
  };
  let box = null, failed = false;

  function panel(tone) {
    if (!box) {
      box = document.createElement('div');
      box.setAttribute('role', 'alert');
      box.style.cssText = 'position:fixed;left:50%;top:14px;translate:-50% 0;z-index:2147483000;display:flex;align-items:center;gap:12px;flex-wrap:wrap;max-width:min(92vw,880px);padding:12px 16px;border-radius:10px;font:500 14px/1.6 "Noto Sans JP","Yu Gothic UI","Meiryo",sans-serif;box-shadow:0 12px 40px #0000004d;';
      (document.body ?? document.documentElement).append(box);
    }
    box.style.background = tone === 'error' ? '#5b1d1d' : '#2a3142';
    box.style.color = '#fff';
    box.style.border = `1px solid ${tone === 'error' ? '#a33' : '#4a5570'}`;
    box.replaceChildren();
    return box;
  }
  function text(parent, value, strong = false) {
    const span = document.createElement(strong ? 'strong' : 'span');
    span.textContent = value; span.style.flex = '1 1 320px';
    parent.append(span); return span;
  }
  function action(parent, label, onClick, primary = false) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = label;
    button.style.cssText = `flex:none;padding:7px 14px;border-radius:7px;border:0;font:700 13px/1.4 inherit;cursor:pointer;background:${primary ? '#f0b44f' : '#ffffff26'};color:${primary ? '#1b1f29' : '#fff'};`;
    button.addEventListener('click', onClick);
    parent.append(button); return button;
  }

  async function status() {
    try { const response = await fetch('/api/code-status', { cache: 'no-store' }); return response.ok ? await response.json() : null; } catch { return null; }
  }
  async function restart(message) {
    message.textContent = 'スタジオを再起動しています…';
    box?.querySelectorAll('button').forEach(button => { button.disabled = true; button.style.opacity = '.5'; });
    try {
      const response = await fetch('/api/restart', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Editor': '1' }, body: '{}' });
      if (!response.ok) { message.textContent = (await response.json().catch(() => ({}))).error || '再起動できませんでした。起動したターミナルで npm start を実行してください。'; return; }
      const before = await fetch('/api/health').then(r => r.json()).catch(() => null);
      for (let attempt = 0; attempt < 80; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 400));
        const health = await fetch('/api/health', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
        if (health && health.pid !== before?.pid) { session.set(RETRY_KEY, '0'); location.reload(); return; }
      }
      message.textContent = '再起動に時間がかかっています。起動したターミナルを確認してください。';
    } catch { message.textContent = '再起動できませんでした。起動したターミナルで npm start を実行してください。'; }
  }
  // サーバーが古い場合の案内（再起動ボタン、またはターミナルでの手順）。
  function staleActions(parent, message, info) {
    if (info?.busy) { message.textContent += `（${info.busy.kind === 'tts' ? '音声を生成中' : '動画を書き出し中'}のため、終わってから再起動してください）`; return; }
    if (info?.restartable) action(parent, 'スタジオを再起動', () => restart(message), true);
    else message.textContent += ' 起動したターミナルで npm start を実行してください。';
  }

  // 読み込み失敗：見つからない部品の名前を、ブラウザの通信記録から拾う。
  const missingFiles = () => performance.getEntriesByType('resource')
    .filter(entry => entry.responseStatus >= 400 && /\/src\//.test(entry.name))
    .map(entry => decodeURIComponent(new URL(entry.name).pathname.split('/').pop()));
  async function showFailure(kind, detail) {
    if (failed) return;
    failed = true;
    const info = await status();
    const root = panel('error'), missing = missingFiles();
    const message = text(root, '');
    if (info?.stale) {
      message.textContent = `画面の部品を読み込めませんでした${missing.length ? `（${missing.join('、')}）` : ''}。スタジオのプログラムが更新されているので、再起動すると直ります。`;
      staleActions(root, message, info);
      action(root, '再読み込み', () => location.reload());
      return;
    }
    // 別の作業がファイルを書き換えている途中だと、部品の組み合わせが一時的に合わないことがある。少し待って自動で読み直す（3回まで）。
    const tries = Number(session.get(RETRY_KEY) ?? 0);
    message.textContent = kind === 'mismatch'
      ? '画面の部品の組み合わせが合いませんでした。別の作業でファイルを書き換えている途中の可能性があります。'
      : `画面の部品を読み込めませんでした${missing.length ? `（${missing.join('、')}）` : ''}。`;
    if (tries < 3) {
      session.set(RETRY_KEY, String(tries + 1));
      message.textContent += ` 5秒後に自動で読み直します（${tries + 1}/3）。`;
      setTimeout(() => location.reload(), 5000);
    } else {
      message.textContent += ' 自動の読み直しでも直りませんでした。スタジオを再起動してください。';
      if (info?.restartable && !info.busy) action(root, 'スタジオを再起動', () => restart(message), true);
    }
    action(root, '今すぐ再読み込み', () => location.reload());
    if (detail) root.title = String(detail).slice(0, 400);
  }
  // <script type="module"> の読み込み失敗（部品が見つからない）は要素の error、組み合わせの不一致は SyntaxError として届く。
  addEventListener('error', event => {
    const target = event.target;
    if (target && target !== window && target.tagName === 'SCRIPT') { void showFailure('missing', target.src); return; }
    if (event.error instanceof SyntaxError || /does not provide an export|Importing a module script failed|Failed to fetch dynamically imported module/.test(event.message ?? '')) void showFailure('mismatch', event.message);
  }, true);
  addEventListener('unhandledrejection', event => {
    if (/Failed to fetch dynamically imported module|Importing a module script failed|does not provide an export/.test(String(event.reason?.message ?? ''))) void showFailure('missing', event.reason.message);
  });
  // 正常に表示できたら、自動の読み直しの回数を戻す。
  addEventListener('load', () => setTimeout(() => { if (!failed) session.set(RETRY_KEY, '0'); }, 3000));

  // サーバーが古いままか：表示した直後・画面に戻ったとき・2分ごとに確かめる。「あとで」を押したら、このタブでは出さない。
  async function checkStale() {
    if (failed || quiet()) return;
    const info = await status();
    if (!info?.stale || failed || quiet()) { if (box && !failed) { box.remove(); box = null; } return; }
    if (session.get(DISMISS_KEY) === '1') return;
    const root = panel('info');
    const message = text(root, 'スタジオのプログラムが更新されています。再起動すると最新の状態で使えます。');
    staleActions(root, message, info);
    action(root, 'あとで', () => { session.set(DISMISS_KEY, '1'); box.remove(); box = null; });
  }
  addEventListener('load', () => setTimeout(checkStale, 1500));
  addEventListener('focus', () => void checkStale());
  setInterval(() => { if (document.visibilityState === 'visible') void checkStale(); }, 120000);
  window.sakusuraStudioStatus = { checkStale, showFailure };
})();
