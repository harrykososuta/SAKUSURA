// 発表者ビュー（/presenter）。再生画面で S を押すと別ウィンドウで開く。
// 表示中のスライド・次に出るもの・原稿・タイマーを出し、送り・レーザー・ペン・拡大・黒画面などの操作をスライド画面へ送る。
// 状態の持ち主はスライド画面（src/player.js）。この画面は受け取った状態を描くだけなので、閉じても発表は続けられる。
import { cueState, plainText } from './core.js';
import { renderSlide as drawSlide } from './slide-view.js';
import { applyMotion, settleTime } from './motion.js';
import { initSlideOverview } from './presentation-overview.js';
import { DEFAULT_VIEW, PEN_COLORS, clampView, stageTransform, strokePath, zoomAt } from './presentation-tools.js';
import { STALE_MS, channelName, clock, nextView, pace, plannedStart, plannedTotal, slideLength, stepProgress, toFrame, toSlide, sameFrame } from './presenter-link.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const channelId = params.get('channel') || '';
const pad = value => String(value).padStart(2, '0');
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const showError = message => { $('pv-error').hidden = !message; $('pv-error').textContent = message || ''; };
const storage = {
  get(key, fallback, session = false) { try { return JSON.parse((session ? sessionStorage : localStorage).getItem(key) ?? 'null') ?? fallback; } catch { return fallback; } },
  set(key, value, session = false) { try { (session ? sessionStorage : localStorage).setItem(key, JSON.stringify(value)); } catch { /* 保存できない環境では毎回初期値 */ } },
};

let payload = null, loadedLecture = '', loadedRev = -1, loading = null;
let state = null, lastMessage = 0, receivedAt = 0;
const sketches = new Map();

// ---- スライドの表示（Shadow DOMで再生画面と同じ描画。IDとCSSを本体から隔離） ----
const STAGE_MARKUP = '<section id="stage"><div class="slide-header"><span id="eyebrow"></span><strong id="brand"></strong></div><div id="slide-content"></div><footer class="slide-footer"><span id="lecture-title"></span><span id="slide-number"></span></footer><svg id="sketch-layer" viewBox="0 0 1920 1080" aria-hidden="true"></svg></section>';
function createView(screen, { zoomable = false } = {}) {
  const host = document.createElement('div'); host.className = 'pv-surface';
  screen.prepend(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<link rel="stylesheet" href="/src/style.css"><style>:host{position:absolute;inset:0;overflow:hidden;display:block}#stage{transition:none}</style>${STAGE_MARKUP}`;
  const view = { stage: shadow.getElementById('stage'), sketch: shadow.getElementById('sketch-layer'), index: -1, time: -1, rev: -1, slide: null, strokes: null };
  view.fit = () => {
    const width = screen.clientWidth, height = screen.clientHeight;
    view.stage.style.transform = zoomable ? stageTransform(zoom, width / 1920, width, height) : `scale(${width / 1920})`;
  };
  new ResizeObserver(view.fit).observe(screen);
  // CSSが読み込まれてから描き直す（画像の切り抜き位置などは寸法を使う）。
  shadow.querySelector('link').addEventListener('load', () => { view.index = -1; view.time = -1; }, { once: true });
  return view;
}

function paint(view, index, time, { settle = false } = {}) {
  const { lecture, images, audio } = payload, slide = lecture.slides[index];
  if (!slide) return;
  const duration = slideLength(slide, audio, state?.preview);
  const at = Math.min(duration, settle ? settleTime(lecture, slide, time, duration) : time);
  if (view.index === index && view.time === at && view.rev === loadedRev) return;
  if (view.index !== index || view.rev !== loadedRev) { drawSlide(view.stage, lecture, index, images); view.index = index; view.rev = loadedRev; view.slide = slide.id; view.strokes = null; }
  view.time = at;
  const visible = cueState(slide.cues, at);
  view.stage.querySelectorAll('[data-block]').forEach(element => element.classList.toggle('visible', visible.has(element.dataset.block)));
  applyMotion(view.stage, lecture, slide, at, duration);
}

// スライド画面の時計を待たずに、受け取った時刻から動きを自分で進める（スライド画面が隠れてコマ送りが止まっても、ここは最後まで動く）。
function displayTime() {
  if (!state) return 0;
  const passed = (performance.now() - receivedAt) / 1000;
  if (state.state === 'playing') return Math.min(state.duration, state.time + passed);
  if (state.state === 'paused' && state.settleTo > state.time) return Math.min(state.settleTo, state.time + passed);
  return state.time;
}

// ---- 拡大（スライド画面と同じ見え方にする） ----
let zoom = DEFAULT_VIEW, zoomHeldUntil = 0;
function setZoom(next, { send: notify = true } = {}) {
  zoom = clampView(next);
  currentView.fit();
  $('pv-zoom').setAttribute('aria-pressed', String(zoom.z > 1));
  $('pv-zoom-badge').hidden = zoom.z <= 1;
  $('pv-zoom-badge').textContent = `${zoom.z.toFixed(1)}×`;
  $('pv-current').classList.toggle('is-zoomed', zoom.z > 1);
  drawLaser();
  if (notify) { zoomHeldUntil = performance.now() + 500; send('view', { z: zoom.z, x: zoom.x, y: zoom.y }); }
}

const currentScreen = $('pv-current');
const currentView = createView(currentScreen, { zoomable: true });
const nextPreview = createView($('pv-next'));

// ---- ペンの線（スライド画面が持つ線を受け取って表示。描いている途中の線はここで先に描く） ----
function paintSketch() {
  const strokes = state ? sketches.get(state.slide) : null;
  if (currentView.strokes === strokes && currentView.slide === state?.slide) return;
  currentView.strokes = strokes;
  const ns = 'http://www.w3.org/2000/svg';
  currentView.sketch.replaceChildren(...(strokes ?? []).map(({ value, d }) => { const path = document.createElementNS(ns, 'path'); path.setAttribute('d', d); path.setAttribute('stroke', value); return path; }));
  if (drawing) currentView.sketch.append(drawing.path);
}

// ---- 道具：レーザーポインター・ペン・拡大 ----
let tool = 'none', penColor = PEN_COLORS[0].id, pointer = null, drawing = null, panning = null, panned = false;
const swatches = PEN_COLORS.map(({ id, label, value }, index) => {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'pv-swatch'; button.dataset.color = id;
  button.title = `ペンの色：${label}（${index + 1}）`; button.setAttribute('aria-label', `ペンの色：${label}`);
  button.style.setProperty('--swatch', value);
  button.addEventListener('click', () => setColor(id));
  return button;
});
$('pv-colors').append(...swatches);
function setColor(id) { penColor = id; swatches.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.color === id))); }
function setTool(next) {
  tool = tool === next ? 'none' : next;
  currentScreen.dataset.tool = tool;
  $('pv-laser-tool').setAttribute('aria-pressed', String(tool === 'laser'));
  $('pv-pen-tool').setAttribute('aria-pressed', String(tool === 'pen'));
  $('pv-colors').hidden = tool !== 'pen';
  if (tool !== 'laser') { send('laser', { u: null, v: null }); laserAt = null; drawLaser(); }
}
setColor(penColor);

const framePoint = event => {
  const rect = currentScreen.getBoundingClientRect();
  return { a: (event.clientX - rect.left) / rect.width, b: (event.clientY - rect.top) / rect.height };
};
const stagePoint = ({ a, b }) => { const { u, v } = toSlide(zoom, a, b); return { x: +(u * 1920).toFixed(1), y: +(v * 1080).toFixed(1) }; };
let laserAt = null, laserQueued = false;
function drawLaser() {
  const dot = $('pv-laser');
  if (!laserAt) { dot.hidden = true; return; }
  const { a, b } = toFrame(zoom, laserAt.u, laserAt.v);
  dot.hidden = false; dot.style.left = `${a * 100}%`; dot.style.top = `${b * 100}%`;
}
// 送るのは1コマに1回まで（マウスの細かな動きで通信を詰まらせない）。
let strokeBuffer = [];
function flush() {
  laserQueued = false;
  if (tool === 'laser') send('laser', laserAt ? { u: laserAt.u, v: laserAt.v } : { u: null, v: null });
  if (strokeBuffer.length) { send('stroke-move', { points: strokeBuffer }); strokeBuffer = []; }
}
const queue = () => { if (!laserQueued) { laserQueued = true; requestAnimationFrame(flush); } };

currentScreen.addEventListener('pointermove', event => {
  pointer = framePoint(event);
  if (tool === 'laser') {
    const { u, v } = toSlide(zoom, pointer.a, pointer.b);
    laserAt = u >= 0 && u <= 1 && v >= 0 && v <= 1 ? { u, v } : null;
    drawLaser(); queue();
  } else if (drawing) {
    for (const item of event.getCoalescedEvents?.() ?? [event]) { const point = stagePoint(framePoint(item)); drawing.points.push(point); strokeBuffer.push(point); }
    drawing.path.setAttribute('d', strokePath(drawing.points)); queue();
  } else if (panning) {
    const dx = event.clientX - panning.x, dy = event.clientY - panning.y;
    if (!panned && Math.abs(dx) + Math.abs(dy) < 5) return;
    panned = true;
    setZoom({ ...panning.view, x: panning.view.x + dx / panning.width, y: panning.view.y + dy / panning.height });
  }
});
currentScreen.addEventListener('pointerleave', () => {
  pointer = null;
  if (tool === 'laser') { laserAt = null; drawLaser(); queue(); }
});
currentScreen.addEventListener('pointerdown', event => {
  panned = false;
  if (event.button !== 0) return;
  if (tool === 'pen') {
    const point = stagePoint(framePoint(event));
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke', PEN_COLORS.find(item => item.id === penColor).value);
    path.setAttribute('d', strokePath([point]));
    drawing = { points: [point], path };
    currentView.sketch.append(path);
    send('stroke-start', { point, color: penColor });
    currentScreen.setPointerCapture(event.pointerId);
  } else if (tool === 'none' && zoom.z > 1) {
    const rect = currentScreen.getBoundingClientRect();
    panning = { x: event.clientX, y: event.clientY, view: zoom, width: rect.width, height: rect.height };
    currentScreen.setPointerCapture(event.pointerId);
  }
});
const endPointer = () => {
  if (drawing) { flush(); send('stroke-end'); drawing = null; }
  panning = null;
};
currentScreen.addEventListener('pointerup', endPointer);
currentScreen.addEventListener('pointercancel', endPointer);
currentScreen.addEventListener('dragstart', event => event.preventDefault());
// 道具を使っていないときのクリックは次へ、右クリックは前へ（スライド画面と同じ）。
currentScreen.addEventListener('click', () => { if (tool === 'none' && !panned) send('next'); panned = false; });
currentScreen.addEventListener('contextmenu', event => { event.preventDefault(); if (tool === 'none') send('prev'); });
currentScreen.addEventListener('wheel', event => {
  event.preventDefault();
  const { a, b } = framePoint(event), delta = event.deltaY * (event.deltaMode ? 16 : 1), z = zoom.z * Math.exp(-delta * .0015);
  setZoom(zoomAt(zoom, clamp(a, 0, 1), clamp(b, 0, 1), z < 1.02 ? 1 : z));
}, { passive: false });
function toggleZoom() {
  const { a, b } = pointer ?? { a: .5, b: .5 };
  setZoom(zoom.z > 1 ? DEFAULT_VIEW : zoomAt(zoom, clamp(a, 0, 1), clamp(b, 0, 1), 2));
}

// ---- タイマー（この画面だけのストップウォッチ。最初に送ったときに自動で始まる） ----
const timerKey = `sakusura-presenter-timer:${channelId}`;
const timer = storage.get(timerKey, { running: false, startedAt: 0, accumulated: 0, slideStart: 0, slideIndex: -1 }, true);
const elapsed = () => timer.accumulated + (timer.running ? (Date.now() - timer.startedAt) / 1000 : 0);
const saveTimer = () => storage.set(timerKey, timer, true);
function startTimer() { if (timer.running) return; timer.running = true; timer.startedAt = Date.now(); saveTimer(); paintTimer(); }
function toggleTimer() {
  if (timer.running) { timer.accumulated = elapsed(); timer.running = false; }
  else { timer.running = true; timer.startedAt = Date.now(); }
  saveTimer(); paintTimer();
}
function resetTimer() { finishRun(); Object.assign(timer, { running: false, startedAt: 0, accumulated: 0, slideStart: 0 }); saveTimer(); paintTimer(); }

// ---- リハーサルの記録：タイマーが動いている間、スライドごとにかかった時間を数え、前回と比べる ----
// 記録はこのPCのブラウザに講義ごとに残す（前回・前々回）。リセット・発表者ビューを閉じたとき・「今回を記録する」で確定する（30秒未満・1枚だけは残さない）。
const runKey = `sakusura-presenter-run:${channelId}`;
let run = storage.get(runKey, { lecture: '', slides: {} }, true), lastTick = Date.now();
const recordKey = name => `sakusura-rehearsal:${name}`;
const records = name => storage.get(recordKey(name), { last: null, previous: null });
const runTotal = () => Object.values(run.slides).reduce((sum, value) => sum + value, 0);
function trackRun() {
  const now = Date.now(), passed = (now - lastTick) / 1000;
  lastTick = now;
  if (!timer.running || !state || !payload || passed > 5) return;
  if (run.lecture !== loadedLecture) run = { lecture: loadedLecture, slides: {} };
  run.slides[state.slide] = (run.slides[state.slide] ?? 0) + passed;
  storage.set(runKey, run, true);
}
function finishRun() {
  if (run.lecture && runTotal() >= 30 && Object.keys(run.slides).length >= 2) {
    const saved = records(run.lecture);
    storage.set(recordKey(run.lecture), { previous: saved.last, last: { at: Date.now(), total: runTotal(), slides: Object.fromEntries(Object.entries(run.slides).map(([id, value]) => [id, Math.round(value)])) } });
  }
  run = { lecture: loadedLecture, slides: {} }; storage.set(runKey, run, true);
}
function paintRecords() {
  if (!payload) return;
  const { lecture, audio } = payload, saved = records(loadedLecture), body = $('pv-records-body');
  const date = at => at ? new Date(at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  $('pv-records-note').textContent = saved.last ? `前回：${date(saved.last.at)}（${clock(saved.last.total)}）${saved.previous ? `　前々回：${date(saved.previous.at)}（${clock(saved.previous.total)}）` : ''}` : 'まだ記録はありません。タイマーを動かして通しで進めると記録されます。';
  const cell = (row, text, className = '') => { const td = document.createElement('td'); td.textContent = text; if (className) td.className = className; row.append(td); };
  body.replaceChildren(...lecture.slides.map((slide, index) => {
    const row = document.createElement('tr'), plan = slideLength(slide, audio, state?.preview), now = run.slides[slide.id], last = saved.last?.slides[slide.id];
    if (index === state?.index) row.className = 'is-current';
    cell(row, pad(index + 1)); cell(row, plainText(slide.title), 'pv-records-title'); cell(row, clock(plan));
    cell(row, last === undefined ? '—' : clock(last), last > plan * 1.3 ? 'is-over' : '');
    cell(row, now === undefined ? '—' : clock(now), now > plan * 1.3 ? 'is-over' : '');
    return row;
  }));
  const total = document.createElement('tr'); total.className = 'pv-records-total';
  cell(total, ''); cell(total, '合計'); cell(total, clock(plannedTotal(lecture, audio, state?.preview))); cell(total, saved.last ? clock(saved.last.total) : '—'); cell(total, runTotal() ? clock(runTotal()) : '—');
  body.append(total);
}
const toggleRecords = open => { $('pv-records').hidden = !open; if (open) paintRecords(); };

function paintTimer() {
  const now = elapsed();
  $('pv-elapsed').textContent = clock(now);
  $('pv-elapsed').classList.toggle('is-paused', !timer.running);
  $('pv-timer-toggle').textContent = timer.running ? '一時停止' : now ? '再開' : '開始';
  $('pv-clock').textContent = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  if (!payload || !state) return;
  const { lecture, audio } = payload, slide = lecture.slides[state.index];
  $('pv-slide-time').textContent = clock(now - timer.slideStart);
  const previous = slide ? records(loadedLecture).last?.slides[slide.id] : undefined;
  $('pv-slide-plan').textContent = slide ? ` / 目安 ${clock(slideLength(slide, audio, state.preview))}${previous !== undefined ? ` / 前回 ${clock(previous)}` : ''}` : '';
  const planned = plannedStart(lecture, audio, state.preview, state.index) + Math.min(state.time, state.duration);
  const result = now ? pace(now, planned) : { kind: 'idle', seconds: 0 };
  $('pv-pace').dataset.kind = result.kind;
  $('pv-pace').textContent = result.kind === 'idle' ? '送ると開始' : result.kind === 'on' ? '予定どおり' : `予定より ${clock(result.seconds)} ${result.kind === 'behind' ? '遅れ' : '早い'}`;
}

// ---- 状態の表示 ----
function paintAll() {
  if (!payload || !state) return;
  const { lecture } = payload, slide = lecture.slides[state.index];
  if (!slide) return;
  paint(currentView, state.index, displayTime());
  paintSketch();
  const next = nextView(lecture, state.index, state.time);
  $('pv-end').hidden = next.kind !== 'end';
  if (next.kind !== 'end') paint(nextPreview, next.index, next.time, { settle: true });
  const following = lecture.slides[next.index], upcoming = stepProgress(slide, next.time);
  $('pv-next-label').textContent = next.kind === 'step' ? `次：このスライドの続き（要点 ${upcoming.shown} / ${upcoming.total}）`
    : next.kind === 'slide' ? `次：${pad(next.index + 1)} ${plainText(following.title)}` : '次：なし（最後）';
  const progress = stepProgress(slide, state.time);
  $('pv-steps').textContent = progress.total > 1 ? `要点 ${progress.shown} / ${progress.total}` : '';
  $('pv-counter').textContent = `${pad(state.index + 1)} / ${pad(lecture.slides.length)}`;
  $('pv-title').textContent = plainText(slide.title);
  $('pv-prev').disabled = state.index === 0 && progress.shown <= 1;
  $('pv-next-button').disabled = next.kind === 'end';
  $('pv-cover').hidden = !state.cover;
  $('pv-cover').dataset.cover = state.cover || '';
  $('pv-black').setAttribute('aria-pressed', String(state.cover === 'black'));
  $('pv-white').setAttribute('aria-pressed', String(state.cover === 'white'));
  $('pv-play-label').textContent = state.active ? '停止' : state.preview ? '自動再生' : '音声再生';
  $('pv-play').setAttribute('aria-pressed', String(!!state.active));
  // スライド画面で拡大・解除した場合も合わせる（ここで操作した直後は、行き違いで戻らないよう少し待つ）。
  if (state.view && performance.now() > zoomHeldUntil && !panning && (state.view.z !== zoom.z || state.view.x !== zoom.x || state.view.y !== zoom.y)) setZoom(state.view, { send: false });
  const mode = $('pv-mode');
  // スライド画面が隠れていて、このウィンドウと位置・大きさが同じなら、同じウィンドウのタブ（か真裏のウィンドウ）になっている。
  const behind = !!state.hidden && sameFrame(state.frame, { x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight });
  $('pv-tab-alert').hidden = !behind;
  mode.classList.toggle('is-warning', !!state.hidden);
  mode.textContent = behind ? '⚠ スライド画面がこの裏にあります' : state.hidden ? '⚠ スライド画面が隠れています' : state.fullscreen ? 'スライド画面：全画面' : state.audience ? 'スライド画面：ウィンドウ（共有用）' : 'スライド画面：通常表示';
  mode.title = state.hidden ? 'スライド画面が最小化されているか、ほかのウィンドウで完全に覆われています。Chromeが描画を止めるので、Zoomなどの共有の映像も止まります。スライド画面を一部でも見える位置に置いてください。'
    : state.fullscreen || state.audience ? '' : 'スライド画面で F（全画面）か R（スライドだけの表示）を押すと発表用の表示になります';
}

// ---- 原稿：スクロールせずに全文が見えるよう、枠に入る最大の文字サイズにする ----
const NOTE_MIN = 13, NOTE_MAX_CHOICES = [18, 20, 22, 24, 28, 32, 36, 42, 48];
let noteMaxIndex = Math.max(0, NOTE_MAX_CHOICES.indexOf(storage.get('sakusura-presenter-font', 28)));
if (!NOTE_MAX_CHOICES.includes(storage.get('sakusura-presenter-font', 28))) noteMaxIndex = 4;
function fitNotes() {
  const box = $('pv-notes'), max = NOTE_MAX_CHOICES[noteMaxIndex];
  box.style.fontSize = `${max}px`;
  if (box.scrollHeight <= box.clientHeight + 1) return;
  let low = NOTE_MIN, high = max;
  while (high - low > .5) {
    const middle = (low + high) / 2;
    box.style.fontSize = `${middle}px`;
    if (box.scrollHeight <= box.clientHeight + 1) low = middle; else high = middle;
  }
  box.style.fontSize = `${low}px`;
}
const changeFont = delta => { noteMaxIndex = clamp(noteMaxIndex + delta, 0, NOTE_MAX_CHOICES.length - 1); storage.set('sakusura-presenter-font', NOTE_MAX_CHOICES[noteMaxIndex]); fitNotes(); };
function paintNotes() {
  const slide = payload?.lecture.slides[state?.index ?? -1];
  const text = slide?.narration?.trim();
  $('pv-notes').textContent = text || '（このスライドの原稿はありません）';
  $('pv-notes').classList.toggle('is-empty', !text);
  $('pv-notes').scrollTop = 0;
  fitNotes();
}
new ResizeObserver(() => fitNotes()).observe($('pv-notes'));
document.fonts?.ready.then(fitNotes);

// ---- 左右の幅（スライドと原稿）をドラッグで変える ----
const SIDE_KEY = 'sakusura-presenter-side';
const setSide = width => {
  const main = $('pv-main'), limit = main.clientWidth * .62;
  if (!width) { main.style.removeProperty('--pv-side'); storage.set(SIDE_KEY, 0); return; }
  const value = Math.round(clamp(width, 280, limit));
  main.style.setProperty('--pv-side', `${value}px`); storage.set(SIDE_KEY, value);
};
if (storage.get(SIDE_KEY, 0)) setSide(storage.get(SIDE_KEY, 0));
$('pv-splitter').addEventListener('pointerdown', event => {
  const splitter = $('pv-splitter'); splitter.setPointerCapture(event.pointerId); splitter.classList.add('is-dragging');
  const move = e => setSide($('pv-main').getBoundingClientRect().right - e.clientX - 20);
  const up = () => { splitter.classList.remove('is-dragging'); splitter.removeEventListener('pointermove', move); };
  splitter.addEventListener('pointermove', move); splitter.addEventListener('pointerup', up, { once: true });
});
$('pv-splitter').addEventListener('dblclick', () => setSide(0));
$('pv-splitter').addEventListener('keydown', event => {
  const delta = { ArrowLeft: 32, ArrowRight: -32 }[event.code];
  if (!delta) return;
  event.preventDefault(); event.stopPropagation();
  setSide(document.querySelector('.pv-side').getBoundingClientRect().width + delta);
});

// ---- スライド画面との通信 ----
const channel = channelId && 'BroadcastChannel' in window ? new BroadcastChannel(channelName(channelId)) : null;
function send(name, extra = {}) {
  if (!channel) return;
  if (['prev', 'next', 'goto'].includes(name)) startTimer();
  channel.postMessage({ type: 'command', name, ...extra });
}

async function loadLecture(name, rev) {
  const response = await fetch(`/api/lecture?name=${encodeURIComponent(name)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('スライドを読み込めません。スライド画面を開き直してください。');
  payload = await response.json();
  loadedLecture = name; loadedRev = rev;
  currentView.index = nextPreview.index = -1;
  overview.invalidate();
  document.title = `発表者ビュー | ${payload.lecture.title}`;
  $('pv-planned').textContent = clock(plannedTotal(payload.lecture, payload.audio, state?.preview));
  paintNotes();
}

// ---- 「発表を始める」で選んだ形の案内（閉じるまで出す） ----
let startMode = params.get('mode') || 'auto', tipClosed = false;
function paintTip() {
  const title = payload ? plainText(payload.lecture.title) : '';
  const tips = {
    monitor: state?.fullscreen ? 'スライドを外部モニターに全画面で表示しています。終えるときは、発表者ビューを閉じるか、スライド画面で Esc を押します。'
      : 'スライド画面（左のウィンドウ）を外部モニターへドラッグし、スライド画面で F を押して全画面にしてください。',
    share: `画面共有では「ウィンドウ」から「スライド画面 | ${title}」を選んでください。この発表者ビューは参加者に見えません。スライド画面は隠さずに置いてください。`,
    rehearsal: '通し練習：タイマーは0からです。→ やクリックで進めると計測が始まり、上に予定との差が出ます。',
  };
  const text = tips[startMode];
  $('pv-tip').hidden = tipClosed || !text;
  $('pv-tip-text').textContent = text ?? '';
}
$('pv-tip-close').addEventListener('click', () => { tipClosed = true; paintTip(); });
if (params.get('reset') === '1') resetTimer();

async function receive(message) {
  if (message?.type === 'mode') { startMode = message.mode; tipClosed = false; if (message.reset) resetTimer(); paintTip(); return; }
  if (message?.type === 'sketch') { sketches.set(message.slide, message.strokes); paintSketch(); return; }
  if (message?.type !== 'state') return;
  lastMessage = Date.now(); receivedAt = performance.now();
  const previous = state;
  state = message;
  if (message.lecture !== loadedLecture || message.rev !== loadedRev) {
    if (!loading) loading = loadLecture(message.lecture, message.rev).then(() => showError('')).catch(error => showError(error.message)).finally(() => { loading = null; });
    await loading;
    if (!payload) return;
  }
  if (!previous || previous.index !== state.index || previous.lecture !== state.lecture) {
    if (timer.slideIndex !== state.index) { timer.slideStart = elapsed(); timer.slideIndex = state.index; saveTimer(); }
    paintNotes();
  }
  if (previous && previous.preview !== state.preview) $('pv-planned').textContent = clock(plannedTotal(payload.lecture, payload.audio, state.preview));
  // スライド画面側で送った・自動再生した場合もタイマーを始める。
  if (previous && (previous.index !== state.index || previous.time !== state.time) && !timer.running && !elapsed()) startTimer();
  paintAll(); paintTimer(); paintLink(); paintTip();
}

function paintLink() {
  const link = $('pv-link');
  if (!channel) { link.dataset.state = 'off'; link.textContent = '未接続'; return; }
  const fresh = lastMessage && Date.now() - lastMessage < STALE_MS;
  link.dataset.state = fresh ? 'on' : lastMessage ? 'lost' : 'waiting';
  link.textContent = fresh ? '接続中' : lastMessage ? '接続が切れました' : '接続を待っています…';
  link.title = fresh ? '' : 'スライド画面（再生）を開いたまま、S を押すと発表者ビューをつなぎ直せます';
}

const overview = initSlideOverview({
  dialog: $('slide-overview'),
  slides: () => payload?.lecture.slides.map(slide => plainText(slide.title)) ?? [],
  currentIndex: () => state?.index ?? 0,
  drawThumbnail(thumb, index) {
    const shadow = thumb.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<link rel="stylesheet" href="/src/style.css"><section id="stage" style="transform:scale(var(--thumb-scale,.05))"><div class="slide-header"><span id="eyebrow"></span><strong id="brand"></strong></div><div id="slide-content"></div><footer class="slide-footer"><span id="lecture-title"></span><span id="slide-number"></span></footer></section>';
    const surface = shadow.getElementById('stage');
    const draw = () => { drawSlide(surface, payload.lecture, index, payload.images); surface.querySelectorAll('[data-block]').forEach(element => element.classList.add('visible')); };
    draw(); shadow.querySelector('link').addEventListener('load', draw, { once: true });
  },
  onSelect: index => send('goto', { index }),
  onClose: () => {},
});

// ---- 操作 ----
const guide = open => { $('pv-guide').hidden = !open; $('pv-help').setAttribute('aria-expanded', String(open)); };
$('pv-prev').addEventListener('click', () => send('prev'));
$('pv-next-button').addEventListener('click', () => send('next'));
$('pv-laser-tool').addEventListener('click', () => setTool('laser'));
$('pv-pen-tool').addEventListener('click', () => setTool('pen'));
$('pv-undo').addEventListener('click', () => send('undo'));
$('pv-clear').addEventListener('click', () => send('clear'));
$('pv-zoom').addEventListener('click', () => { pointer = null; toggleZoom(); });
$('pv-overview').addEventListener('click', () => { if (payload) overview.open(); });
$('pv-black').addEventListener('click', () => send('blackout'));
$('pv-white').addEventListener('click', () => send('whiteout'));
$('pv-play').addEventListener('click', () => send('play'));
$('pv-timer-toggle').addEventListener('click', toggleTimer);
$('pv-timer-reset').addEventListener('click', resetTimer);
$('pv-font-up').addEventListener('click', () => changeFont(1));
$('pv-font-down').addEventListener('click', () => changeFont(-1));
$('pv-help').addEventListener('click', () => guide($('pv-guide').hidden));
$('pv-guide-close').addEventListener('click', () => guide(false));
// マウスで押したボタンはフォーカスを外し、続けて Space・矢印で送れるようにする。
document.addEventListener('click', event => { const button = event.target.closest('button'); if (button && event.detail > 0) button.blur(); });

document.addEventListener('keydown', event => {
  if ($('slide-overview').open) return;
  if (event.key === 'Escape') { if (!$('pv-guide').hidden) guide(false); else if (tool !== 'none') setTool(tool); else if (zoom.z > 1) setZoom(DEFAULT_VIEW); return; }
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') { event.preventDefault(); send('undo'); return; }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target === $('pv-notes') && ['ArrowUp', 'ArrowDown'].includes(event.code)) return;
  if (event.target.tagName === 'BUTTON' && ['Space', 'Enter', 'NumpadEnter'].includes(event.code)) return;
  const keys = { ArrowRight: 'next', ArrowDown: 'next', PageDown: 'next', Space: 'next', Enter: 'next', NumpadEnter: 'next', ArrowLeft: 'prev', ArrowUp: 'prev', PageUp: 'prev', Backspace: 'prev', KeyB: 'blackout', Period: 'blackout', KeyW: 'whiteout', Comma: 'whiteout' };
  if (keys[event.code]) { event.preventDefault(); if (!event.repeat || ['next', 'prev'].includes(keys[event.code])) send(keys[event.code]); return; }
  if (event.repeat) return;
  const color = tool === 'pen' && event.code.match(/^(?:Digit|Numpad)([1-5])$/);
  if (color) { event.preventDefault(); setColor(PEN_COLORS[color[1] - 1].id); return; }
  const actions = {
    KeyL: () => setTool('laser'), KeyP: () => setTool('pen'), KeyE: () => send('clear'), KeyZ: toggleZoom,
    KeyG: () => { if (payload) overview.open(); }, KeyT: toggleTimer,
    Equal: () => changeFont(1), NumpadAdd: () => changeFont(1), Semicolon: () => changeFont(1), Minus: () => changeFont(-1), NumpadSubtract: () => changeFont(-1),
    Slash: () => guide($('pv-guide').hidden),
  };
  if (actions[event.code]) { event.preventDefault(); actions[event.code](); }
});

function frame() { if (payload && state) { paint(currentView, state.index, displayTime()); } requestAnimationFrame(frame); }
requestAnimationFrame(frame);
setInterval(() => { trackRun(); paintTimer(); paintLink(); if (!$('pv-records').hidden) paintRecords(); }, 500);
$('pv-records-button').addEventListener('click', () => toggleRecords($('pv-records').hidden));
$('pv-records-close').addEventListener('click', () => toggleRecords(false));
$('pv-records-save').addEventListener('click', () => { finishRun(); paintRecords(); });
paintTimer(); paintLink();

if (!channel) {
  showError(channelId ? 'このブラウザでは発表者ビューを使えません。ChromeかEdgeで開いてください。' : '発表者ビューは、再生画面で S キー（または「発表者ビュー」ボタン）を押して開きます。');
} else {
  channel.addEventListener('message', event => { void receive(event.data); });
  channel.postMessage({ type: 'hello' });
  // スライド画面が隠れてChromeに止められても動きと送信が続くよう、0.1秒ごとに合図を送る（src/player.js の pulse）。
  setInterval(() => { if (document.visibilityState === 'visible') channel.postMessage({ type: 'pulse' }); }, 100);
  addEventListener('pagehide', () => { finishRun(); channel.postMessage({ type: 'command', name: 'laser', u: null, v: null }); channel.postMessage({ type: 'bye' }); });
  // 初めて開いたときだけ、使い方を出す。
  if (!storage.get('sakusura-presenter-guided', false)) { guide(true); storage.set('sakusura-presenter-guided', true); }
}
