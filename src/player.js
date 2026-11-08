import { loadLectureOptions } from './lecture-picker.js';
import { initLectureBrowser } from './lecture-browser.js';
import { LecturePlayer, cueState, formatTime, plainText } from './core.js';
import { renderSlide as drawSlide } from './slide-view.js';
import { applyMotion, settleTime } from './motion.js';
import { hasHdCircuit, hdCircuitAmbient } from './hd-circuit-motion.js';
import { initPresentationPointer } from './presentation-pointer.js';
import { PEN_COLORS, initPresentationTools } from './presentation-tools.js';
import { initPresentationBar } from './presentation-bar.js';
import { initSlideOverview } from './presentation-overview.js';
import { initStartDialog } from './presentation-start.js';
import { PRESENTER_WINDOW, channelName, presenterUrl, toFrame, validCommand } from './presenter-link.js';

const $ = id => document.getElementById(id);
let player, payload, selectedLecture = new URLSearchParams(location.search).get('lecture') || '';
let renderedSlide = null, loadingLecture = 0, lectureRev = 0, audioComplete = false, exportJob = null, exportTimer = null;
// 動画の書き出し（tools/render.mjs）が1コマずつ撮るときは true。要点のフェードも時刻から描く。
let frames = false;
const media = new Audio();
const lectureBrowser = initLectureBrowser({ select: $('lecture-select'), currentLabel: '再生中' });
media.preload = 'auto';
const errors = message => { $('error').hidden = !message; $('error').textContent = message || ''; };
const tools = initPresentationTools({ shell: $('stage-shell'), stage: $('stage'), layer: $('sketch-layer'), presenting: () => presenting(), autoplaying: () => !!player?.active, onViewChange: () => { resize(); bar.sync(); placeRemoteLaser(); broadcast(); }, onStrokesChange: () => sendSketch() });
// 全画面への移行・F11・ズームでビューポートが変わるたびに再計算する。
// 親要素の以前の幅に依存せず、1920×1080を画面内の最大サイズで表示する。
const resize = () => {
  const shell = $('stage-shell');
  if (document.body.classList.contains('recording')) {
    const width = document.documentElement.clientWidth || window.innerWidth;
    const height = window.innerHeight;
    const scale = Math.min(width / 1920, height / 1080);
    shell.style.width = `${1920 * scale}px`;
    shell.style.height = `${1080 * scale}px`;
  } else if (window.matchMedia('(min-width:1101px) and (min-height:600px)').matches) {
    const canvas = document.querySelector('.player-canvas');
    const scale = Math.min(canvas.clientWidth / 1920, canvas.clientHeight / 1080);
    shell.style.width = `${1920 * scale}px`;
    shell.style.height = `${1080 * scale}px`;
  } else {
    shell.style.removeProperty('width');
    shell.style.removeProperty('height');
  }
  const bounds = shell.getBoundingClientRect();
  $('stage').style.transform = tools.transform(Math.min(bounds.width / 1920, bounds.height / 1080), bounds.width, bounds.height);
};
const scheduleResize = () => { resize(); requestAnimationFrame(resize); };
new ResizeObserver(resize).observe($('stage-shell'));
new ResizeObserver(resize).observe(document.querySelector('.player-canvas'));
window.addEventListener('resize', scheduleResize);
window.visualViewport?.addEventListener('resize', scheduleResize);
// 全画面プレゼン（F）中の → や クリックは発表用の手動送り（要点を1つずつ表示し、音声は流さない）。
// Space はこれまでどおり音声付きの自動再生（OBS収録の手順）。録画モード（R）も従来どおり。
let presentationFullscreen = false;
// 発表者ビュー（S）をつないでいる間は、スライドだけの表示（録画モードと同じ見た目）でも発表用の操作にする。
// Zoomなどでこのウィンドウを共有する場合は全画面にしないので、この扱いが必要。
const presenter = { id: Math.random().toString(36).slice(2, 10), channel: null, win: null, linked: false, ownsView: false, timer: 0 };
const presenting = () => (presentationFullscreen && !!document.fullscreenElement) || (presenter.linked && document.body.classList.contains('recording'));
const pointer = initPresentationPointer({ dot: $('laser-pointer'), presenting, autoplaying: () => !!player?.active, penActive: () => tools.pen, onActivity: () => bar.show() });
// 全画面中の操作は、キーと操作バーで同じ処理を使う。
const stepPresentation = direction => { errors(''); setCover(''); player?.step(direction); };
const presentationCommands = {
  prev: () => stepPresentation(-1),
  next: () => stepPresentation(1),
  play: () => togglePlay(),
  laser: () => { tools.setPen(false); pointer.toggleLaser(); },
  pen: () => { pointer.reset(); tools.togglePen(); },
  color: ({ color }) => tools.setColor(color),
  overview: () => { if (player?.active) player.pause(); bar.hide(); tools.resetZoom(); overview.toggle(); },
  undo: () => tools.undo(),
  clear: () => tools.clear(),
  zoom: () => tools.toggleZoom({ center: true }),
  presenter: () => void openPresenter(),
  exit: () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); else recording(false); },
};
const bar = initPresentationBar({
  bar: $('presentation-bar'),
  commands: presentationCommands,
  colors: PEN_COLORS,
  state: () => ({ laser: pointer.laser, pen: tools.pen, color: tools.color, zoomed: tools.view.z > 1, counter: player ? `${pad(player.index + 1)} / ${pad(player.lecture.slides.length)}` : '' }),
});
const overview = initSlideOverview({
  dialog: $('slide-overview'),
  slides: () => payload.lecture.slides.map(slide => plainText(slide.title)),
  currentIndex: () => player?.index ?? 0,
  drawThumbnail,
  onSelect: index => { errors(''); player?.presentSlide(index); },
  onClose: () => $('stage-shell').focus({ preventScroll: true }),
});
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) recording(true);
  else {
    pointer.reset();
    tools.reset();
    bar.hide();
    overview.close();
    if (presentationFullscreen) { presentationFullscreen = false; recording(presenter.linked && presenter.ownsView); }
  }
  scheduleResize();
  broadcast();
});

// 右の一覧と操作バーの目次：講義を読み込むたびに作り直す。長さは無音リハーサルなら予定尺、それ以外は音声の長さ。
let autoSilent = false;
const slideSeconds = (slide, preview) => preview ? slide.plannedSeconds : (payload.audio[slide.id]?.duration ?? slide.plannedSeconds);
const pad = value => String(value).padStart(2, '0');
// Shadow DOMで再生画面と同じスライドを縮小表示する（ID・CSSを本体から隔離）。倍率は親の --thumb-scale で変えられる。
function drawThumbnail(thumb, index) {
  const shadow = thumb.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<link rel="stylesheet" href="/src/style.css"><section id="stage" style="transform:scale(var(--thumb-scale,.05))"><div class="slide-header"><span id="eyebrow"></span><strong id="brand"></strong></div><div id="slide-content"></div><footer class="slide-footer"><span id="lecture-title"></span><span id="slide-number"></span></footer></section>';
  const surface = shadow.getElementById('stage'), { lecture, images } = payload;
  const draw = () => { drawSlide(surface, lecture, index, images); surface.querySelectorAll('[data-block]').forEach(e => e.classList.add('visible')); };
  draw(); shadow.querySelector('link').addEventListener('load', draw, { once: true });
}
function buildNavigator() {
  const { lecture } = payload, preview = $('preview').checked;
  overview.invalidate();
  $('slide-total').textContent = `${lecture.slides.length}枚`;
  $('chapters').replaceChildren(); $('slide-list').replaceChildren();
  lecture.slides.forEach((slide, i) => {
    const title = plainText(slide.title), seconds = slideSeconds(slide, preview);
    const chapter = document.createElement('button'); chapter.className = 'chapter'; chapter.tabIndex = -1; chapter.title = `${pad(i + 1)} ${title}`;
    chapter.style.setProperty('--weight', String(Math.max(1, seconds)));
    chapter.addEventListener('click', () => player?.jump(i));
    $('chapters').append(chapter);
    const item = document.createElement('li');
    const button = document.createElement('button'); button.className = 'slide-entry'; button.setAttribute('aria-label', `${i + 1}枚目 ${title}`);
    const number = document.createElement('span'); number.className = 'entry-number'; number.textContent = pad(i + 1);
    const thumb = document.createElement('span'); thumb.className = 'entry-thumb'; thumb.setAttribute('aria-hidden', 'true');
    drawThumbnail(thumb, i);
    const text = document.createElement('span'); text.className = 'entry-text';
    const name = document.createElement('span'); name.className = 'entry-title'; name.textContent = title;
    const meta = document.createElement('span'); meta.className = 'entry-meta';
    const missing = !preview && !payload.audio[slide.id]?.ready;
    meta.classList.toggle('is-missing', missing); meta.textContent = `${formatTime(seconds)}${missing ? '・音声未生成' : ''}`;
    text.append(name, meta); button.append(number, thumb, text);
    button.addEventListener('click', () => player?.jump(i));
    item.append(button); $('slide-list').append(item);
  });
}
// 表示中のスライドが一覧の外にあれば、一覧の中だけをスクロールして見せる（ページ全体は動かさない）。
function revealEntry(entry) {
  const list = $('slide-list'), top = entry.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop, bottom = top + entry.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top - 8;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 8;
}

function renderSlide(p) {
  if (renderedSlide === p.slide) return;
  renderedSlide = p.slide;
  drawSlide($('stage'), p.lecture, p.index, payload?.images);
  tools.slideChanged(p.slide.id);
  $('narration').textContent = p.slide.narration || 'ナレーションなし';
  $('narration-slide').textContent = `${pad(p.index + 1)} / ${pad(p.lecture.slides.length)}`;
  $('slide-counter').textContent = `${pad(p.index + 1)} / ${pad(p.lecture.slides.length)}`;
  $('slide-title').textContent = plainText(p.slide.title);
  $('seek').max = p.duration;
  [...$('slide-list').querySelectorAll('.slide-entry')].forEach((entry, i) => {
    entry.setAttribute('aria-current', String(i === p.index));
    if (i === p.index) revealEntry(entry);
  });
}

function render(p) {
  renderSlide(p);
  bar.sync();
  const visible = cueState(p.slide.cues, p.time);
  document.querySelectorAll('[data-block]').forEach(element => element.classList.toggle('visible', visible.has(element.dataset.block)));
  applyMotion($('stage'), p.lecture, p.slide, p.time, p.duration, { frames });
  $('seek').value = p.time;
  $('slide-time').textContent = `${formatTime(p.time)} / ${formatTime(p.duration)}`;
  $('total-time').textContent = `全体 ${formatTime(p.elapsed)} / ${formatTime(p.total)}`;
  $('film-fill').style.width = `${Math.min(100, p.elapsed / p.total * 100)}%`;
  [...$('chapters').children].forEach((chapter, i) => {
    chapter.style.setProperty('--fill', `${i < p.index ? 100 : i > p.index ? 0 : Math.min(100, p.time / p.duration * 100)}%`);
    chapter.classList.toggle('is-current', i === p.index);
  });
  const label = p.active ? '一時停止' : p.state === 'ended' ? 'もう一度再生' : p.state === 'paused' ? '再開' : '再生';
  $('play-label').textContent = label; $('play').dataset.mode = p.active ? 'pause' : 'play';
  $('prev').disabled = p.index === 0;
  $('next').disabled = p.index === p.lecture.slides.length - 1;
  const states = { ready: '再生待ち', loading: '音声読み込み中', playing: '再生中', paused: '一時停止', gap: '次のスライドへ', ended: '講義の再生が完了しました。OBSの録画を停止してください。', error: '再生を停止しました' };
  $('status').textContent = `${p.preview ? '無音リハーサル / ' : ''}${states[p.state]}`;
  document.body.dataset.state = p.state;
  document.body.dataset.slide = p.slide.id;
  broadcast();
}

async function loadLecture(name) {
  const operation = ++loadingLecture;
  player?.dispose(); player = null;
  errors('');
  try {
    const response = await fetch(`/api/lecture?name=${encodeURIComponent(name)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('講義を読み込めません。lecture.jsonと起動ターミナルを確認してください。');
    const result = await response.json();
    if (operation !== loadingLecture) return;
    payload = result;
    selectedLecture = name;
    lectureRev++;
    $('library-link').href = `/library?lecture=${encodeURIComponent(name)}`;
    $('edit-link').href = `/editor?lecture=${encodeURIComponent(name)}`;
    renderedSlide = null;
    // 音声が1枚もない講義は、そのままでは再生できないので無音リハーサルで開く。音声のある講義へ移ったら戻す。
    const anyAudio = Object.values(payload.audio).some(item => item.ready);
    if (!anyAudio && !$('preview').checked) { $('preview').checked = true; autoSilent = true; }
    else if (anyAudio && autoSilent) { $('preview').checked = false; autoSilent = false; }
    buildNavigator();
    const ready = Object.values(payload.audio).filter(item => item.ready).length;
    audioComplete = ready === payload.lecture.slides.length;
    void trackExport(name);
    $('readiness').textContent = `音声準備 ${ready} / ${payload.lecture.slides.length}枚。${ready < payload.lecture.slides.length ? '未生成のスライドは無音リハーサルで確認できます。' : 'すべての音声を確認しました。'}`;
    player = new LecturePlayer({ ...payload, media, preview: $('preview').checked, settle: (slide, at, duration) => settleTime(payload.lecture, slide, at, duration), onChange: render, onError: error => errors(error.message) });
    const url = new URL(location.href); url.searchParams.set('lecture', name); history.replaceState(null, '', url);
    document.title = windowTitle();
  } catch (error) { errors(error.message); $('status').textContent = '読み込みに失敗しました'; }
}

async function togglePlay() { errors(''); pointer.hideCursor(); bar.hide(); if (!player) return; if (player.active) player.pause(); else await player.play(); }
// スライドだけの表示の間は、ウィンドウ名を「スライド画面」にする（Zoomなどの共有で、ウィンドウの一覧から選びやすくする）。
const windowTitle = () => payload ? `${document.body.classList.contains('recording') ? 'スライド画面 | ' : ''}${payload.lecture.title} | HTMLスライド収録` : document.title;
function recording(value = !document.body.classList.contains('recording')) {
  document.body.classList.toggle('recording', value);
  document.title = windowTitle();
  if (value) $('stage-shell').focus({ preventScroll: true });
  scheduleResize();
}
async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else {
      presentationFullscreen = true;
      player?.pause();
      recording(true);
      // 発表者ビューを開いていて2画面なら、発表者ビューのない画面（外部モニター）で全画面にする。
      const details = presenter.linked ? await screenDetails() : null;
      const target = details ? audienceScreen(details) : null;
      await document.documentElement.requestFullscreen(target ? { screen: target } : undefined);
    }
    scheduleResize();
  } catch {
    presentationFullscreen = false;
    recording(presenter.linked);
    errors('全画面表示を開始できません。F11でChromeを全画面にし、Rで録画モードにしてください。');
  }
}
// ---- 発表者ビュー（S）：別ウィンドウに原稿・次のスライド・タイマーを出す。状態はこの画面が持ち、BroadcastChannelで送る ----
// 黒画面・白画面（B / W）。スライドの拡大やペンの線には触れず、上に重ねるだけ。
let cover = '';
function setCover(value) {
  const next = value === cover ? '' : value;
  if (next === cover) return;
  cover = next;
  $('stage-cover').hidden = !cover; $('stage-cover').dataset.cover = cover;
  broadcast();
}
// settleTo（動きが終わる時刻）も送るので、発表者ビューはこの画面のコマ送りを待たずに自分で動きを再生できる。
// hidden はこの画面が隠れているか（最小化・ほかのウィンドウで完全に覆われた状態）。隠れるとChromeが描画を止める。
let lastBroadcast = 0;
function broadcast() {
  if (!presenter.channel || !player) return;
  lastBroadcast = Date.now();
  presenter.channel.postMessage({
    type: 'state', lecture: selectedLecture, rev: lectureRev, index: player.index, slide: player.slide.id, time: player.time, settleTo: player.settleTo, duration: player.duration,
    state: player.state, active: player.active, preview: player.preview, cover, view: tools.view,
    fullscreen: !!document.fullscreenElement, audience: document.body.classList.contains('recording'), hidden: document.hidden,
    // 発表者ビューが「同じウィンドウのタブになっている」かを見分けられるよう、このウィンドウの位置と大きさも送る。
    frame: { x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight },
  });
}
// ペンの線（このスライドの分）を発表者ビューへ。線が変わったときだけ送る。
function sendSketch() {
  if (!presenter.channel || !player) return;
  presenter.channel.postMessage({ type: 'sketch', slide: player.slide.id, strokes: tools.strokes });
}
// 発表者ビューのスライドの上で動かしたレーザーポインター。拡大中も同じ図の位置を指す。
let remoteLaser = null;
function placeRemoteLaser() {
  const dot = $('remote-laser');
  if (!remoteLaser) { dot.hidden = true; return; }
  const { a, b } = toFrame(tools.view, remoteLaser.u, remoteLaser.v);
  dot.hidden = a < 0 || a > 1 || b < 0 || b > 1;
  dot.style.left = `${a * 100}%`; dot.style.top = `${b * 100}%`;
}
const presenterCommands = {
  prev: () => stepPresentation(-1),
  next: () => stepPresentation(1),
  goto: ({ index }) => { errors(''); setCover(''); tools.resetZoom(); player?.presentSlide(index); },
  play: () => void togglePlay(),
  blackout: () => setCover('black'),
  whiteout: () => setCover('white'),
  laser: ({ u, v }) => { remoteLaser = u === null ? null : { u, v }; placeRemoteLaser(); },
  'stroke-start': ({ point, color }) => tools.beginStroke(point, color),
  'stroke-move': ({ points }) => tools.extendStroke(points),
  'stroke-end': () => tools.endStroke(),
  undo: () => tools.undo(),
  clear: () => tools.clear(),
  view: ({ z, x, y }) => tools.applyView({ z, x, y }),
};
function linkPresenter() {
  if (!presenter.linked) {
    presenter.linked = true;
    player?.pause();
    // 発表用の表示（スライドだけ）にする。すでに全画面ならそのまま。
    if (!document.body.classList.contains('recording')) { presenter.ownsView = true; recording(true); }
  }
  broadcast();
}
function unlinkPresenter() {
  if (!presenter.linked) return;
  presenter.linked = false; presenter.win = null;
  clearInterval(presenter.timer); presenter.timer = 0;
  if (presenter.ownsView && !document.fullscreenElement) recording(false);
  presenter.ownsView = false;
  pointer.reset(); tools.reset(); bar.hide(); setCover(''); remoteLaser = null; placeRemoteLaser();
}
function presenterChannel() {
  if (presenter.channel) return presenter.channel;
  presenter.channel = new BroadcastChannel(channelName(presenter.id));
  presenter.channel.addEventListener('message', ({ data }) => {
    if (data?.type === 'hello') { linkPresenter(); sendSketch(); }
    // 発表者ビューは表示中、0.1秒ごとに合図を送る。この画面が隠れてChromeがコマ送り（requestAnimationFrame）を止めても、
    // 合図で時計を進めるので、動きの終わり・自動再生のページ送り・状態の送信が止まらない。
    else if (data?.type === 'pulse') { if (document.hidden && player) { player.tick(performance.now()); if (Date.now() - lastBroadcast > 400) broadcast(); } }
    else if (data?.type === 'bye') setTimeout(() => { if (!presenter.win || presenter.win.closed) unlinkPresenter(); }, 300);
    else if (presenter.linked && validCommand(data, payload?.lecture.slides.length ?? 0)) presenterCommands[data.name](data);
  });
  return presenter.channel;
}
// 複数の画面があり、Chromeの「ウィンドウの管理」が許可済みなら、画面の一覧を得る（許可がなければ null）。
async function screenDetails({ ask = false } = {}) {
  if (!window.screen.isExtended || !('getScreenDetails' in window)) return null;
  try {
    const status = await navigator.permissions.query({ name: 'window-management' });
    if (status.state === 'denied' || (status.state === 'prompt' && !ask)) return null;
    return await window.getScreenDetails();
  } catch { return null; }
}
const screenAt = (screens, x, y) => screens.find(s => x >= s.left && x < s.left + s.width && y >= s.top && y < s.top + s.height);
// スライドを出す画面：発表者ビューがある画面とは別の画面（なければ、いまこのウィンドウがない画面）。
function audienceScreen(details) {
  const win = presenter.win && !presenter.win.closed ? presenter.win : null;
  const own = win ? screenAt(details.screens, win.screenX + win.outerWidth / 2, win.screenY + win.outerHeight / 2) : details.currentScreen;
  return details.screens.find(s => s !== own && !s.isPrimary) ?? details.screens.find(s => s !== own) ?? null;
}
// mode：auto（S キー。2画面で許可済みなら外部モニターに全画面）／monitor（外部モニター）／share（Zoomなどで共有。発表者ビューを右に寄せ、
// スライド画面が隠れないようにする）／rehearsal（通し練習。発表者ビューを大きく）。reset はタイマーを0に戻す。
function presenterPlacement(mode, area) {
  const availWidth = area.availWidth ?? area.width, availHeight = area.availHeight ?? area.height;
  const availLeft = area.availLeft ?? area.left ?? 0, availTop = area.availTop ?? area.top ?? 0;
  if (mode === 'share') { const width = Math.min(availWidth, Math.max(900, Math.round(availWidth * .5))); return { width, height: availHeight, left: availLeft + availWidth - width, top: availTop }; }
  if (mode === 'rehearsal' || mode === 'monitor') return { width: availWidth, height: availHeight, left: availLeft, top: availTop };
  const width = Math.min(1440, availWidth), height = Math.min(900, availHeight);
  return { width, height, left: availLeft + Math.max(0, (availWidth - width) / 2), top: availTop + Math.max(0, (availHeight - height) / 2) };
}
async function openPresenter({ mode = 'auto', reset = false } = {}) {
  if (!player) return false;
  if (!('BroadcastChannel' in window)) { errors('このブラウザでは発表者ビューを使えません。ChromeかEdgeで開いてください。'); return false; }
  errors('');
  presenterChannel();
  const details = ['auto', 'monitor'].includes(mode) ? await screenDetails() : null;
  const here = details?.currentScreen;
  const target = details ? audienceScreen(details) : null;
  // 2画面で許可済み：スライドを外部モニターに全画面で出し、発表者ビューは手元の画面に開く（PowerPointと同じ振り分け）。
  if (target && !document.fullscreenElement) {
    presentationFullscreen = true; player.pause(); recording(true);
    try { await document.documentElement.requestFullscreen({ screen: target }); } catch { presentationFullscreen = false; }
  }
  // 外部モニターに自動で全画面にできなかったときは、スライド画面を手で移せるよう、発表者ビューを右側に置く。
  const place = presenterPlacement(mode === 'monitor' && !document.fullscreenElement ? 'share' : mode, here ?? window.screen);
  const open = presenter.win && !presenter.win.closed;
  if (open) {
    // 開いている発表者ビューは、選んだ発表の形に合わせて置き直す。
    try { presenter.win.moveTo(Math.round(place.left), Math.round(place.top)); presenter.win.resizeTo(Math.round(place.width), Math.round(place.height)); } catch { /* 移動できない環境ではそのまま */ }
    presenter.channel.postMessage({ type: 'mode', mode, reset });
    presenter.win.focus();
    return true;
  }
  presenter.win = window.open(`${presenterUrl(selectedLecture, presenter.id)}&mode=${mode}${reset ? '&reset=1' : ''}`, PRESENTER_WINDOW, `popup,width=${Math.round(place.width)},height=${Math.round(place.height)},left=${Math.round(place.left)},top=${Math.round(place.top)}`);
  if (!presenter.win) { errors('発表者ビューのウィンドウを開けませんでした。アドレスバー右端のポップアップのブロックを「許可」にして、もう一度お試しください。'); return false; }
  clearInterval(presenter.timer);
  // 閉じたことを確かめる・状態を定期的に送る（発表者ビューが接続の切れを判断できるように）。
  presenter.timer = setInterval(() => { if (presenter.win?.closed) unlinkPresenter(); else broadcast(); }, 1000);
  // 2画面なのにまだ許可していなければ、次回から自動で振り分けられるよう許可を求める。
  if (window.screen.isExtended && !details && mode === 'auto') void screenDetails({ ask: true });
  return true;
}
addEventListener('pagehide', () => { presenter.win?.close(); });

// ---- 「発表を始める」：発表の形を選ぶと、全画面・発表者ビュー・配置までを整える ----
async function windowPermission() {
  try { return (await navigator.permissions.query({ name: 'window-management' })).state; } catch { return 'unsupported'; }
}
const startDialog = initStartDialog({
  dialog: $('start-dialog'),
  async onChoose(mode, { fromStart, say, close }) {
    if (!player) return;
    if (mode === 'monitor') {
      if (window.screen.isExtended === false) { say('2台目の画面が見つかりません。外部モニターをつなぎ、Windowsの Win + P で「拡張」を選んでから、もう一度選んでください。', 'warn'); return; }
      // Chromeの「ウィンドウの管理」を初めて許可するときは、許可の確認で操作の続きが切れるので、許可後にもう一度押してもらう。
      if (await windowPermission() === 'prompt') {
        say('Chromeの確認で「許可」を選んでください。許可すると、スライドを外部モニターに自動で全画面表示できます。');
        await screenDetails({ ask: true });
        const state = await windowPermission();
        if (state === 'granted') { say('許可されました。もう一度「外部モニター・プロジェクター」を選ぶと始まります。'); return; }
        say('許可されなかったため、スライド画面は手で外部モニターへ移してください（移したら F で全画面）。続けるには、もう一度選んでください。', 'warn');
        return;
      }
    }
    if (fromStart) { errors(''); setCover(''); player.presentSlide(0); } else player.pause();
    close();
    if (mode === 'mirror') { if (!document.fullscreenElement) await fullscreen(); return; }
    await openPresenter({ mode, reset: true });
  },
});
$('start-presentation').addEventListener('click', () => startDialog.open());

$('play').addEventListener('click', togglePlay);
$('prev').addEventListener('click', () => player && player.jump(player.index - 1));
$('next').addEventListener('click', () => player && player.jump(player.index + 1));
$('restart').addEventListener('click', () => { errors(''); player?.load(0); });
$('seek').addEventListener('input', event => player?.seek(event.target.value));
$('record').addEventListener('click', () => recording());
$('fullscreen').addEventListener('click', fullscreen);
$('stage-shell').addEventListener('click', () => { if (presenting() && !tools.takeClick()) stepPresentation(1); });
$('stage-shell').addEventListener('contextmenu', event => { if (presenting()) { event.preventDefault(); stepPresentation(-1); } });
$('presenter').addEventListener('click', () => void openPresenter());
$('lecture-select').addEventListener('change', event => { lectureBrowser.sync(); void loadLecture(event.target.value); });
// マウスで押したボタンはフォーカスを外し、続けて Space で再生・停止できるようにする（キーボード操作のフォーカスは残す）。
document.addEventListener('click', event => { const button = event.target.closest('.player-controls button, .slide-entry'); if (button && event.detail > 0) button.blur(); });

// 動画の書き出し（npm run render と同じ処理）。サーバー側で実行するので、待つ間もこの画面やPCを使える。
async function studioPost(path) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Editor': '1' }, body: '{}' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || '操作に失敗しました。起動ターミナルを確認してください。');
  return result;
}
function showExport() {
  const job = exportJob, running = job?.state === 'running';
  $('export').disabled = running || !audioComplete;
  $('export').textContent = running ? '書き出し中…' : '動画を書き出す';
  $('export-menu-label').textContent = running ? '書き出し中…' : '書き出し';
  $('export-menu').classList.toggle('is-busy', running);
  $('export').title = audioComplete ? 'npm run render と同じ処理で MP4 を書き出します' : '全スライドの音声を生成すると書き出せます';
  // 音声がそろっていない（TTSのAPIキー未登録など）ときは、無音での書き出しを選べる。
  $('export-silent').hidden = audioComplete; $('export-silent').disabled = running;
  $('open-exports').hidden = job?.state !== 'completed';
  $('export-status').textContent = !job ? ''
    : running ? `動画を書き出し中 ${Math.floor(job.completed / job.count * 100)}%（${job.step}）。画面を閉じても続きます`
    : job.state === 'completed' ? `書き出し完了${job.silent ? '（無音）' : ''}：${job.output}（${formatTime(job.seconds)}）${job.warnings.length ? ' ※画像生成待ちの枠を含みます' : ''}`
    : '動画を書き出せませんでした';
  if (job?.state === 'failed') errors(`動画を書き出せませんでした：${job.error}`);
}
async function trackExport(name) {
  clearTimeout(exportTimer);
  try {
    const response = await fetch(`/api/render/job?name=${encodeURIComponent(name)}`, { cache: 'no-store' });
    const { job } = await response.json();
    if (name !== selectedLecture) return;
    exportJob = job; showExport();
    if (job?.state === 'running') exportTimer = setTimeout(() => trackExport(name), 2000);
  } catch { showExport(); }
}
async function startExport(silent) {
  errors(''); $('export').disabled = true; $('export-silent').disabled = true;
  const name = selectedLecture;
  try { exportJob = await studioPost(`/api/render/start?name=${encodeURIComponent(name)}${silent ? '&silent=1' : ''}`); showExport(); exportTimer = setTimeout(() => trackExport(name), 1000); }
  catch (error) { errors(error.message); showExport(); }
}
$('export').addEventListener('click', () => startExport(false));
$('export-silent').addEventListener('click', () => startExport(true));
// サムネイル（1枚目）を動画と同じ見た目の 1920×1080 JPG で保存する。撮影はサーバー側の画面を出さないブラウザで行う。
$('thumbnail').addEventListener('click', async () => {
  errors(''); $('thumbnail').disabled = true; $('thumbnail').textContent = 'サムネイルを作成中…';
  const name = selectedLecture;
  try {
    const response = await fetch(`/api/thumbnail?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Editor': '1' }, body: '{}' });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'サムネイルを作成できませんでした。');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = `${name}_thumbnail.jpg`; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (error) { errors(error.message); }
  finally { $('thumbnail').disabled = false; $('thumbnail').textContent = 'サムネイルをJPGで保存'; }
});
// 講義全体を、要点をすべて表示した状態で1スライド1ページのPDFにして保存する。作成はサーバー側の画面を出さないブラウザで行う。
$('pdf').addEventListener('click', async () => {
  errors(''); $('pdf').disabled = true; $('pdf').textContent = 'PDFを作成中…';
  const name = selectedLecture;
  try {
    const response = await fetch(`/api/pdf?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Editor': '1' }, body: '{}' });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'PDFを作成できませんでした。');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = `${name}.pdf`; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (error) { errors(error.message); }
  finally { $('pdf').disabled = false; $('pdf').textContent = 'PDFを書き出す'; }
});
// 書き出しメニュー：項目を選ぶ・外側をクリック・Escで閉じる。
for (const item of $('export-menu').querySelectorAll('[role=menuitem]')) item.addEventListener('click', () => { $('export-menu').open = false; });
document.addEventListener('click', event => { if ($('export-menu').open && !$('export-menu').contains(event.target)) $('export-menu').open = false; });
$('open-exports').addEventListener('click', () => studioPost('/api/exports/open').catch(error => errors(error.message)));
$('preview').addEventListener('change', () => { autoSilent = false; void loadLecture(selectedLecture); });
document.addEventListener('keydown', event => {
  // スライドを選ぶ画面を開いている間は、矢印・Space・Enter をその画面の操作だけに使う。
  if ($('lecture-browser').open || $('slide-overview').open || $('start-dialog').open) return;
  if (event.key === 'Escape' && $('export-menu').open) { $('export-menu').open = false; $('export-menu').querySelector('summary').focus(); return; }
  if (event.key === 'Escape') { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); recording(false); return; }
  // Tabで操作バーのボタンを選んでいるときの Enter・Space は、そのボタンを押す操作にする。
  if (event.target.closest?.('#presentation-bar') && ['Enter', 'NumpadEnter', 'Space'].includes(event.code)) return;
  if (presenting() && (event.ctrlKey || event.metaKey) && event.code === 'KeyZ') { event.preventDefault(); presentationCommands.undo(); return; }
  if (event.ctrlKey || event.metaKey || event.altKey || ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
  // 発表中：→ ↓ PageDown Enter で次へ、← ↑ PageUp Backspace で戻る（プレゼン用リモコンは PageDown / PageUp を送る）。
  const presentationKeys = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, Enter: 1, NumpadEnter: 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1, Backspace: -1 };
  if (presenting() && presentationKeys[event.code]) { event.preventDefault(); stepPresentation(presentationKeys[event.code]); return; }
  if (event.repeat) return;
  if (presenting() && event.code === 'KeyL') { event.preventDefault(); presentationCommands.laser(); bar.sync(); return; }
  if (presenting() && event.code === 'KeyP') { event.preventDefault(); presentationCommands.pen(); bar.sync(); return; }
  if (presenting() && event.code === 'KeyE') { event.preventDefault(); presentationCommands.clear(); return; }
  if (presenting() && event.code === 'KeyG') { event.preventDefault(); presentationCommands.overview(); return; }
  // B・W（PowerPointと同じ）：スライド画面を黒・白にする / 戻す。プレゼン用リモコンの「.」「,」も同じ。
  if (presenting() && ['KeyB', 'Period'].includes(event.code)) { event.preventDefault(); setCover('black'); return; }
  if (presenting() && ['KeyW', 'Comma'].includes(event.code)) { event.preventDefault(); setCover('white'); return; }
  if (event.code === 'KeyS') { event.preventDefault(); void openPresenter(); return; }
  const penColorKey = presenting() && tools.pen && event.code.match(/^(?:Digit|Numpad)([1-5])$/);
  if (penColorKey) { event.preventDefault(); presentationCommands.color({ color: PEN_COLORS[penColorKey[1] - 1].id }); bar.sync(); return; }
  // キーの Z はマウスの位置を中心に拡大する（操作バーのボタンは画面の中央）。
  if (presenting() && event.code === 'KeyZ') { event.preventDefault(); tools.toggleZoom(); return; }
  if (event.target.tagName === 'BUTTON' && event.code === 'Space') return;
  if (['Space', 'ArrowLeft', 'ArrowRight', 'KeyR', 'KeyF'].includes(event.code)) event.preventDefault();
  if (event.code === 'Space') void togglePlay();
  if (event.code === 'ArrowLeft' && player) void player.jump(player.index - 1);
  if (event.code === 'ArrowRight' && player) void player.jump(player.index + 1);
  if (event.code === 'KeyR') recording();
  if (event.code === 'KeyF') void fullscreen();
});
// 画面を離れた場合は同期ずれを防ぐため停止。録画はブラウザを前面にして行います。
// 発表者ビューをつないでいる間は止めない（発表者ビューの合図で進むので、ずれない）。
document.addEventListener('visibilitychange', () => { if (document.hidden && player?.active && !presenter.linked) player.pause(); broadcast(); });
// 血液透析の回路図は、再生前・再生後・全画面の発表中も流れを止めない。一時停止中と書き出し中は再生位置どおりに止める。
const recordedRun = new URLSearchParams(location.search).get('record') === '1';
function ambientFlow(now) {
  if (!player || frames || recordedRun || !hasHdCircuit(player.slide)) return;
  const content = $('stage').querySelector('#slide-content'), seconds = now / 1000;
  if (player.state === 'ready' && player.time === 0) hdCircuitAmbient(content, player.slide, seconds, { idle: true });
  else if (player.state === 'ended') hdCircuitAmbient(content, player.slide, seconds);
  else if (player.state === 'paused' && document.fullscreenElement) hdCircuitAmbient(content, player.slide, seconds, { time: player.time });
}
function frame(now) { player?.tick(now); ambientFlow(now); requestAnimationFrame(frame); }
requestAnimationFrame(frame);

window.addEventListener('focus', () => { void loadLectureOptions($('lecture-select')).catch(() => {}); void lectureBrowser.refresh(); });

// QAと制作時のタイミング調整用。APIキーや生成APIはブラウザへ渡しません。
window.slideStudio = { get player() { return player; }, get payload() { return payload; }, loadLecture, recording, media, get frames() { return frames; }, set frames(value) { frames = value; } };
try {
  const lectures = await loadLectureOptions($('lecture-select'));
  // 指定がない・見つからないときは、最近更新した講義（一覧の先頭）を開く。
  if (!lectures.some(item => item.name === selectedLecture)) selectedLecture = lectures[0]?.name || 'demo';
  $('lecture-select').value = selectedLecture; lectureBrowser.sync();
  if (new URLSearchParams(location.search).get('record') === '1') recording(true);
  await loadLecture(selectedLecture);
} catch (error) { errors(error.message); }
