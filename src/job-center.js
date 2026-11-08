// 作業状況の通知欄：右上（設定ボタンの左）に、動画の書き出し・音声の生成の進み具合をまとめて出す。
// どの画面で始めた作業でも、ほかの画面から進み具合が見え、終わると右下に知らせる。サーバーの /api/jobs を読むだけ。
// 収録・書き出し（record=1）・全画面の発表中・埋め込み表示では動かさない。
import { plainText } from './core.js';
import { jobLine } from './job-format.js';

const params = new URLSearchParams(location.search);
const enabled = window.top === window && params.get('record') !== '1' && !navigator.webdriver;
const KIND = { render: '動画の書き出し', tts: '音声の生成' };
const enc = encodeURIComponent;
let jobs = [], titles = new Map(), baseline = null, timer = 0, button, panel, badge, toastBox;

async function loadTitles() {
  if (titles.size) return;
  try { for (const item of await (await fetch('/api/lectures', { cache: 'no-store' })).json()) titles.set(item.name, `${/^\d+$/.test(item.number ?? '') ? `#${String(item.number).padStart(2, '0')} ` : ''}${plainText(item.title)}`); } catch { /* 名前のまま出す */ }
}
const titleOf = name => titles.get(name) ?? name;

function toast(message, tone) {
  if (!toastBox) { toastBox = document.createElement('div'); toastBox.className = 'jobs-toasts'; toastBox.setAttribute('role', 'status'); document.body.append(toastBox); }
  const item = document.createElement('div'); item.className = `jobs-toast is-${tone}`; item.textContent = message;
  item.addEventListener('click', () => item.remove());
  toastBox.append(item);
  setTimeout(() => item.remove(), 9000);
}

function paintButton() {
  const running = jobs.filter(job => job.state === 'running').length;
  button.classList.toggle('is-running', running > 0);
  badge.hidden = !running; badge.textContent = String(running);
  button.title = running ? `作業中 ${running}件（クリックで進み具合）` : '作業状況（動画の書き出し・音声の生成）';
}
function paintPanel() {
  if (panel.hidden) return;
  const list = panel.querySelector('.jobs-list');
  list.replaceChildren();
  if (!jobs.length) { const empty = document.createElement('p'); empty.className = 'jobs-empty'; empty.textContent = 'このスタジオを起動してから、動画の書き出し・音声の生成はまだありません。'; list.append(empty); return; }
  for (const job of jobs) {
    const row = document.createElement('div'); row.className = `jobs-item is-${job.state}`;
    const head = document.createElement('div'); head.className = 'jobs-head';
    const kind = document.createElement('span'); kind.className = 'jobs-kind'; kind.textContent = `${KIND[job.kind] ?? job.kind}${job.silent ? '（無音）' : ''}`;
    const name = document.createElement('strong'); name.textContent = titleOf(job.name);
    head.append(kind, name);
    const line = document.createElement('p'); line.className = 'jobs-line'; line.textContent = jobLine(job);
    row.append(head, line);
    if (job.state === 'running' && job.count) { const bar = document.createElement('div'); bar.className = 'jobs-bar'; bar.style.setProperty('--progress', `${Math.min(100, job.completed / job.count * 100)}%`); row.append(bar); }
    const actions = document.createElement('div'); actions.className = 'jobs-actions';
    const link = (label, href) => { const a = document.createElement('a'); a.href = href; a.textContent = label; actions.append(a); };
    link('再生画面', `/?lecture=${enc(job.name)}`);
    link('編集画面', `/editor?lecture=${enc(job.name)}`);
    if (job.kind === 'render' && job.state === 'completed') {
      const open = document.createElement('button'); open.type = 'button'; open.textContent = '書き出し先を開く';
      open.addEventListener('click', () => fetch('/api/exports/open', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Editor': '1' }, body: '{}' }).catch(() => {}));
      actions.append(open);
    }
    row.append(actions);
    list.append(row);
  }
}

async function poll() {
  clearTimeout(timer);
  if (document.visibilityState === 'visible') {
    try {
      const result = await (await fetch('/api/jobs', { cache: 'no-store' })).json();
      const previous = baseline;
      jobs = result.jobs ?? [];
      // 前回は動いていた作業、または前回の確認の後に始まって終わった作業が終わったら、右下に知らせる（画面を開いた直後の1回目は知らせない）。
      const finishedNow = job => previous.get(job.id) === 'running' || (!previous.has(job.id) && job.finishedAt && (result.now ?? Date.now()) - job.finishedAt < 60000);
      if (previous) for (const job of jobs) if (job.state !== 'running' && finishedNow(job)) {
        await loadTitles();
        toast(`${KIND[job.kind] ?? '作業'}が${job.state === 'completed' ? '完了しました' : 'できませんでした'}：${titleOf(job.name)}`, job.state === 'completed' ? 'done' : 'failed');
      }
      baseline = new Map(jobs.map(job => [job.id, job.state]));
      paintButton(); paintPanel();
    } catch { /* 再起動中などは次回 */ }
  }
  const busy = jobs.some(job => job.state === 'running') || !panel.hidden;
  timer = setTimeout(poll, busy ? 3000 : 20000);
}

function build() {
  const anchor = document.querySelector('.settings-link');
  const header = anchor?.parentElement ?? document.querySelector('header');
  if (!header) return false;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/src/job-center.css'; document.head.append(link);
  const wrap = document.createElement('div'); wrap.className = 'jobs-center';
  button = document.createElement('button'); button.type = 'button'; button.className = 'jobs-button'; button.setAttribute('aria-label', '作業状況'); button.setAttribute('aria-expanded', 'false');
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></svg><span class="jobs-badge" hidden></span>';
  badge = button.querySelector('.jobs-badge');
  panel = document.createElement('section'); panel.className = 'jobs-panel'; panel.hidden = true; panel.setAttribute('aria-label', '作業状況');
  panel.innerHTML = '<div class="jobs-title"><strong>作業状況</strong><small>動画の書き出し・音声の生成</small></div><div class="jobs-list"></div>';
  wrap.append(button, panel);
  if (anchor) header.insertBefore(wrap, anchor); else header.append(wrap);
  const toggle = async open => {
    panel.hidden = !open; button.setAttribute('aria-expanded', String(open));
    if (open) { void poll(); await loadTitles(); paintPanel(); }
  };
  button.addEventListener('click', () => void toggle(panel.hidden));
  document.addEventListener('click', event => { if (!panel.hidden && !wrap.contains(event.target)) void toggle(false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) { void toggle(false); button.focus(); } });
  return true;
}

if (enabled) {
  const start = () => { if (build()) { void poll(); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void poll(); }); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}
