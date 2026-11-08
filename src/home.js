import { plainText } from './core.js';
import { jobLine } from './job-format.js';

const $ = id => document.getElementById(id);
const LABELS = { images: '画像待ち', audio: '音声待ち', validation: '検証待ち', ready: '完成', exported: '書き出し済み' };
const DOTS = { images: '#c79763', audio: '#9387bb', validation: '#779bbb', ready: '#729c81', exported: '#6a9e98' };
// カードの補足：待ち状態は次の作業、完了側は使い道を示す。
const HINTS = { images: ['画像の用意が必要', '画像はそろっています'], audio: ['音声の生成が必要', '音声はそろっています'], validation: ['Harness検証が必要', '検証は済んでいます'], ready: ['書き出しできます', 'まだありません'], exported: ['MP4を書き出し済み', 'まだありません'] };
const WAITING = ['images', 'audio', 'validation'];
const ATTENTION = new Set(['failed', 'unknown', 'launch-unknown', 'refused']);
let snapshot, selected = null, limit = 5, timer, busy = false, jobs = [];
const el = (tag, className, content) => { const node = document.createElement(tag); if (className) node.className = className; if (content !== undefined) node.textContent = content; return node; };
const link = (label, href, className) => { const node = el('a', className, label); node.href = href; return node; };
const lectureUrl = item => item.format === 'html' ? `/html-slides?name=${encodeURIComponent(item.name)}` : `/editor?lecture=${encodeURIComponent(item.name)}`;
const dateText = value => new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const ICONS = { check: '<path d="m6 12 4 4 8-8"/><rect x="3" y="3" width="18" height="18" rx="5"/>', inbox: '<path d="M4 4h16l2 15H2L4 4Z"/><path d="M3 13h5l2 3h4l2-3h5M12 5v5m-3-3 3 3 3-3"/>', slides: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8M12 18v4M7 9h10M7 13h6"/>' };
function empty(title, description, icon = 'check') {
  const box = el('div', 'empty-state'), badge = el(icon === 'inbox' ? 'img' : 'span', icon === 'inbox' ? 'inbox-mascot' : 'empty-icon');
  if (icon === 'inbox') {
    box.classList.add('with-mascot');
    badge.src = '/home-assets/saku-receive.webp'; badge.alt = 'ファイルを受け取るマスコットのサク'; badge.width = 112; badge.height = 136;
  } else badge.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>`;
  const copy = el('div'); copy.append(el('strong', '', title), el('p', '', description)); box.append(badge, copy); return box;
}
function row(item, mode) {
  const node = el('div', `lecture-row ${mode === 'status' ? 'status-row' : ''}`);
  node.append(el('span', 'lecture-symbol', item.number ? `#${String(item.number).padStart(2, '0')}` : item.format === 'html' ? 'HTML' : 'SLIDE'));
  const copy = el('div', 'lecture-detail'); const title = link(plainText(item.title), lectureUrl(item), 'lecture-title'); title.title = plainText(item.title); copy.append(title);
  let meta = `${item.slides}枚 · ${dateText(item.updatedAt)} 更新`;
  if (mode === 'imported') meta = `${item.share.author || '送り主未設定'} · ${dateText(item.share.importedAt)} 取り込み${item.share.revision ? ` · v${item.share.revision}` : ''}`;
  if (mode === 'status') {
    const manual = item.manualDone ? `手動で完了（自動判定：${item.manualDone.statuses.map(status => LABELS[status]).join('・')}）` : '';
    const detail = item.inspectionWarning ? 'ファイルの確認が必要です' : manual && ['ready', 'exported'].includes(selected) ? manual : ['ready', 'exported'].includes(selected) ? `${dateText(item.updatedAt)} 更新` : [item.missingImages ? `画像 ${item.missingImages}点未準備` : '', item.pendingAudio ? `音声 ${item.pendingAudio}枚未準備` : '', selected === 'validation' ? '検証結果の確認が必要です' : '', item.format === 'html' ? 'HTMLスライド' : ''].filter(Boolean).join(' · ');
    meta = `${item.slides}枚${detail ? ` · ${detail}` : ''}`;
  }
  const metaLine = el('div', 'lecture-meta-line'); metaLine.append(el('p', 'lecture-meta', meta));
  if (mode !== 'status' && item.statuses?.length) {
    // 最近の講義にも、次に必要な作業を小さく添える（タイトルの幅は削らない）。
    const chips = el('span', 'row-chips'), shown = item.statuses.includes('ready') ? item.statuses : item.statuses.filter(status => status !== 'exported');
    for (const status of shown) { const chip = el('span', `row-chip${WAITING.includes(status) ? ' is-waiting' : ''}`), dot = el('i', 'status-dot'); dot.style.setProperty('--dot', DOTS[status]); chip.append(dot, document.createTextNode(LABELS[status])); chips.append(chip); }
    metaLine.append(chips);
  }
  copy.append(metaLine); node.append(copy);
  if (mode === 'status' && WAITING.includes(selected)) node.append(actionButton('完了にする', '自動判定の待ち状態を残したまま、この講義を完了として扱います。あとで講義を編集すると自動判定に戻ります。', () => post('/api/home/mark', { name: item.name, done: true })));
  if (mode === 'status' && item.manualDone && ['ready', 'exported'].includes(selected)) node.append(actionButton('戻す', '手動の完了を取り消して、自動判定に戻します。', () => post('/api/home/mark', { name: item.name, done: false })));
  const go = el('span', 'row-go', item.format === 'html' ? '開く' : '編集'); go.setAttribute('aria-hidden', 'true'); go.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 16 16"><path d="m6 4 4 4-4 4"/></svg>');
  node.append(go); return node;
}
function paintStatuses() {
  const filters = $('status-filters');
  for (const [key, label] of Object.entries(LABELS)) {
    let button = filters.querySelector(`[data-status="${key}"]`);
    if (!button) {
      button = el('button', 'status-filter'); button.type = 'button'; button.dataset.status = key; button.setAttribute('aria-controls', 'status-details');
      button.classList.add(WAITING.includes(key) ? 'is-waiting-group' : 'is-done-group'); button.style.setProperty('--dot', DOTS[key]);
      const top = el('span', 'status-caption'), dot = el('i', 'status-dot'), chevron = el('span', 'status-chevron'); chevron.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';
      top.append(dot, el('span', 'status-name', label), chevron);
      const number = el('span', 'status-number'); number.append(el('strong'), el('span', 'status-unit', '件'));
      button.append(top, number, el('span', 'status-toggle-label'));
      button.addEventListener('click', () => { selected = selected === key ? null : key; limit = 5; paintStatuses(); }); filters.append(button);
    }
    const opened = key === selected, count = snapshot.counts[key] ?? 0;
    button.setAttribute('aria-pressed', String(opened)); button.setAttribute('aria-expanded', String(opened));
    button.setAttribute('aria-label', `${label} ${count}件、一覧を${opened ? '閉じる' : '表示'}`);
    button.querySelector('strong').textContent = count;
    button.classList.toggle('is-zero', !count);
    button.querySelector('.status-toggle-label').textContent = opened ? '一覧を閉じる' : HINTS[key][count ? 0 : 1];
  }
  const total = snapshot.lectures.length, ready = snapshot.counts.ready ?? 0, waiting = snapshot.lectures.filter(item => item.statuses.some(status => WAITING.includes(status))).length, rate = total ? Math.round(ready / total * 100) : 0;
  $('status-summary').textContent = total ? `${total}講義のうち ${ready}件が完成（${rate}%）。対応が必要な講義は ${waiting}件です。` : '講義はまだありません。';
  $('ready-bar').style.width = `${rate}%`;
  $('status-details').hidden = !selected;
  if (!selected) { $('status-mark-all').hidden = true; $('status-list').replaceChildren(); $('status-list').setAttribute('aria-busy', 'false'); $('show-more').hidden = true; return; }
  const items = snapshot.lectures.filter(item => item.statuses.includes(selected));
  $('status-mark-all').hidden = !WAITING.includes(selected) || !items.length;
  $('status-mark-all').textContent = `${items.length}件をすべて完了にする`;
  $('status-list-title').textContent = `${LABELS[selected]}の講義`;
  $('status-visible-count').textContent = `${Math.min(items.length, limit)} / ${items.length}件を表示`;
  $('status-list').replaceChildren(...(items.length ? items.slice(0, limit).map(item => row(item, 'status')) : [empty('この状態の講義はありません', 'ほかの状態を選んで、制作の進み具合を確認できます。', 'slides')]));
  $('status-list').setAttribute('aria-busy', 'false'); $('show-more').hidden = items.length <= limit;
  if (items.length > limit) $('show-more').textContent = `さらに ${Math.min(10, items.length - limit)}件を表示`;
}
function paintUsage(usage, error) {
  const box = $('tts-usage'); box.replaceChildren(); box.setAttribute('aria-busy', 'false');
  if (!usage?.current) { box.append(empty('利用回数を確認できません', error || '記録ファイルを確認して、更新してください。')); return; }
  const current = usage.current, ended = current.exhausted || current.remaining === 0;
  const head = el('div', `usage-main${ended ? ' is-ended' : ''}`);
  if (!ended) head.append(el('span', 'usage-today', '今日'));
  if (ended) head.append(el('strong', '', '本日分は終了'));
  else { const count = el('strong', '', current.count); count.append(el('span', '', ` / ${current.limit ?? '上限未設定'}${current.limit ? ' 回' : ''}`)); head.append(count); }
  head.append(el('span', 'remaining', ended ? `${current.count}回を記録` : current.remaining === null ? '今日の利用回数' : `あと ${current.remaining} 回`)); box.append(head);
  const bar = el('div', `usage-bar${ended ? ' is-ended' : ''}`), fill = el('span'); fill.style.width = `${ended ? 100 : current.limit ? Math.min(100, current.count / current.limit * 100) : 0}%`; bar.append(fill); box.append(bar);
  box.append(el('p', 'usage-reset', `次のリセット ${dateText(usage.resetAt)}（このPCの時刻）`), el('p', 'model-name', current.model));
  const about = el('details', 'usage-about'); about.append(el('summary', '', '集計について'), el('p', 'usage-caption', '太平洋時間 0:00 に更新。この機能の導入後に SAKUSURA 経由で使った回数だけを数えます。ほかで同じキーを使う場合、実際の残り回数は少なくなります。')); box.append(about);
  if (usage.models.length > 1) box.append(el('p', 'model-name', usage.models.filter(item => item.model !== current.model).map(item => `${item.model}: ${item.count}回${item.exhausted ? '（本日分終了）' : ''}`).join(' / ')));
}
function paintJobs() {
  if (!snapshot) return;
  const active = [...jobs.filter(job => job.state === 'running'), ...snapshot.imageJobs].filter(job => snapshot.lectures.some(item => item.name === job.name));
  const attention = active.filter(job => ATTENTION.has(job.state) || ATTENTION.has(job.phase)).length;
  $('jobs-count').textContent = active.length ? attention ? `要確認 ${attention} / ${active.length} 件` : `${active.length} 件` : '待機中';
  $('jobs-count').classList.toggle('is-attention', attention > 0);
  const box = $('active-jobs'); box.setAttribute('aria-busy', 'false'); box.replaceChildren();
  if (!active.length) { box.append(empty('いま進行中の作業はありません', '音声や動画の生成を始めると、ここに進み具合が表示されます。')); return; }
  for (const job of active) {
    const needsCheck = ATTENTION.has(job.state) || ATTENTION.has(job.phase);
    const item = snapshot.lectures.find(item => item.name === job.name), node = el('div', `job-row${needsCheck ? ' is-attention' : ''}`), head = el('div', 'job-top');
    const image = job.kind === 'images';
    head.append(el('span', 'job-kind', image ? '画像生成' : job.kind === 'render' ? '動画の書き出し' : '音声生成'), el('span', `job-state${needsCheck ? ' is-attention' : ''}`, job.state === 'failed' ? '要確認' : job.state === 'unknown' ? '起動確認が必要' : needsCheck ? '要確認' : '進行中'));
    node.append(head, link(plainText(item.title), lectureUrl(item)), el('p', '', image ? ({ 'creating-run': '依頼を登録しています', 'starting-worker': '担当の起動待ちです', running: '担当が制作中です。完了数はここでは取得できません。', 'launch-unknown': '起動状態を確認してください', refused: '依頼が開始されていません', failed: '画像生成を確認してください' }[job.phase] ?? '状態を確認してください') : jobLine(job)));
    if (!image && job.count > 0) { const bar = el('div', 'job-progress'), fill = el('span'); fill.style.width = `${Math.min(100, Math.max(0, job.completed / job.count * 100))}%`; bar.append(fill); node.append(bar); }
    if (needsCheck) {
      const actions = el('div', 'job-actions'); actions.append(link('講義を開いて確認', lectureUrl(item), 'job-action'));
      if (image) actions.append(actionButton('確認済みにする', 'この画像作業の表示を消します。同じ依頼で状態が変わったり、新しい依頼を出したりすると再び表示されます。', () => post('/api/home/job-check', { name: job.name }), 'row-action job-check'));
      node.append(actions);
    }
    box.append(node);
  }
}
// 手動の印（docs/HOME.md「手動で完了・確認済み」）。保存したら状態を読み直す。
async function post(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Editor': '1' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || '記録を保存できませんでした。');
}
async function act(button, run) {
  button.disabled = true;
  try { await run(); $('home-error').hidden = true; } catch (error) { $('home-error').textContent = error.message; $('home-error').hidden = false; }
  await waitIdle(); await refresh({ full: true }); button.disabled = false;
}
const waitIdle = () => new Promise(done => { const check = () => busy ? setTimeout(check, 100) : done(); check(); });
const actionButton = (label, title, run, className = 'row-action') => { const button = el('button', className, label); button.type = 'button'; button.title = title; button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); act(button, run); }); return button; };
async function read(url) { const response = await fetch(url, { cache: 'no-store' }); if (!response.ok) throw new Error('制作状況を取得できません。サーバーの接続を確認し、更新してください。'); return response.json(); }
function paintSnapshot(data) {
  snapshot = data;
  if (data.counts) {
    paintStatuses();
  }
  paintUsage(snapshot.usage, snapshot.usageError);
  $('lecture-total').textContent = `全${snapshot.lectures.length}講義${snapshot.excludedDemos ? `（デモ${snapshot.excludedDemos}件を除く）` : ''}`;
  $('recent-grid').classList.toggle('is-inbox-empty', !snapshot.imported.length);
  $('recent-list').replaceChildren(...(snapshot.recent.length ? snapshot.recent.map(item => row(item, 'recent')) : [empty('最初の講義を、ここから', 'ライブラリに講義が増えると、最近編集した順に表示されます。', 'slides')]));
  $('imported-list').replaceChildren(...(snapshot.imported.length ? snapshot.imported.map(item => row(item, 'imported')) : [empty('受け取った講義が、ここに届きます', '共有された講義を取り込むと、送り主と取り込み日時を確認できます。', 'inbox')]));
  paintJobs();
}
async function refresh({ full = false } = {}) {
  if (busy || document.hidden) return;
  busy = true; clearTimeout(timer); $('refresh').disabled = true;
  try {
    // 初回のWAV検証中も最近の講義・利用枠・作業状況へすぐアクセスできる。
    if (!snapshot) {
      const [overview, initialJobs] = await Promise.all([read('/api/home?view=overview'), read('/api/jobs')]);
      jobs = initialJobs.jobs; paintSnapshot(overview); $('sync-status').textContent = '講義の画像・音声を確認中…';
    }
    const [homeResult, jobsResult] = await Promise.allSettled([full || !snapshot ? read('/api/home') : Promise.resolve(null), read('/api/jobs')]);
    if (homeResult.status === 'rejected') throw homeResult.reason;
    if (homeResult.value) paintSnapshot(homeResult.value);
    if (jobsResult.status === 'rejected') throw jobsResult.reason;
    jobs = jobsResult.value.jobs; paintJobs(); $('home-error').hidden = true;
    $('sync-status').textContent = `${new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' }).format(new Date())} 更新`;
  } catch (error) { $('home-error').textContent = error.message; $('home-error').hidden = false; $('sync-status').textContent = snapshot ? '更新できません · 前回の内容を表示' : '接続を確認してください'; }
  finally { busy = false; $('refresh').disabled = false; timer = setTimeout(() => refresh({ full: true }), jobs.some(job => job.state === 'running') || snapshot?.imageJobs.length ? 5000 : 30000); }
}
$('refresh').addEventListener('click', () => refresh({ full: true }));
$('show-more').addEventListener('click', () => { limit += 10; paintStatuses(); });
$('status-mark-all').addEventListener('click', () => {
  const button = $('status-mark-all'), items = snapshot.lectures.filter(item => item.statuses.includes(selected));
  if (!items.length || !confirm(`「${LABELS[selected]}」の${items.length}件を、すべて完了にしますか？
（あとで講義を編集すると、その講義は自動判定に戻ります。完成の一覧から1件ずつ戻せます）`)) return;
  act(button, async () => { for (const item of items) await post('/api/home/mark', { name: item.name, done: true }); });
});
function closeStatuses() {
  const previous = selected; selected = null; paintStatuses();
  if (previous) $('status-filters').querySelector(`[data-status="${previous}"]`).focus({ preventScroll: true });
}
$('status-close').addEventListener('click', closeStatuses);
$('status-details').addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeStatuses(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh({ full: true }); else clearTimeout(timer); });
refresh({ full: true });
